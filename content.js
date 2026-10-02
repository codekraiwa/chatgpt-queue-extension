(() => {
  "use strict";

  const CFG = {
    settleMs: 2200,
    fallbackCheckMs: 2000,
    headerCheckMs: 3000,
    minSendGapMs: 3500,
    uploadTimeoutMs: 30000,
    uploadSettleMs: 1000,
    maxImagesPerItem: 10,
    maxImageSizeMB: 25
  };

  const STATE_KEY = "cq_extension_state_v1";
  const SETTINGS_KEY = "cq_extension_settings_v1";
  const DB_NAME = "ChatGPTQueueExtensionDB";
  const DB_VERSION = 1;
  const STORE = "images";

  let state = loadState();
  let settings = loadSettings();
  let dbPromise = null;
  let panel = null, input = null, listEl = null, statusEl = null, draftEl = null, filePicker = null, headerButton = null;
  let draftImages = [];
  let sending = false;
  let lastSentAt = 0;
  let generationState = "idle";
  let generationEndedAt = 0;
  let completionSignature = "";
  let batchActive = false;
  let batchCompleted = 0;
  let awaitingFinalResponse = false;
  let composerObserver = null;
  let lastKnownTitle = document.title;

  function defaults() { return { queue: [], paused: false, lastFinishedAt: 0, doneUnread: false, activeQueueItemId: null }; }
  function defaultSettings() { return { notifyWhenFinished:true, notifyOnlyWhenInactive:false, showStatusInTab:true, showStatusFavicon:true, playSound:true, soundEngineVersion:2 }; }

  function loadState() {
    try { return { ...defaults(), ...(JSON.parse(localStorage.getItem(STATE_KEY) || "{}")) }; }
    catch { return defaults(); }
  }
  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const merged = { ...defaultSettings(), ...stored };

      // v2 sound migration: completion beep is enabled once by default.
      if (stored.soundEngineVersion !== 2) {
        merged.playSound = true;
        merged.soundEngineVersion = 2;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      }

      return merged;
    } catch {
      return { ...defaultSettings(), playSound:true, soundEngineVersion:2 };
    }
  }
  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    render();
    renderBrowserTabTitle();
    renderStatusFavicon();
    reportStatus();
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    renderSettings();
    renderBrowserTabTitle();
    renderStatusFavicon();
  }

  function applyGlobalSettings(globalSettings = {}) {
    const keys = ["notifyWhenFinished", "notifyOnlyWhenInactive", "playSound"];
    let changed = false;
    for (const key of keys) {
      if (typeof globalSettings[key] === "boolean" && settings[key] !== globalSettings[key]) {
        settings[key] = globalSettings[key];
        changed = true;
      }
    }
    if (changed) saveSettings();
  }

  function loadGlobalSettings() {
    try {
      chrome.runtime.sendMessage({ type:"CQ_GET_GLOBAL_SETTINGS" }, res => {
        if (chrome.runtime.lastError) return;
        if (res?.settings) applyGlobalSettings(res.settings);
      });
    } catch {}
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:"id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE,"readwrite").objectStore(STORE).put(record);
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
  }
  async function dbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE,"readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE,"readwrite").objectStore(STORE).delete(id);
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const makeId = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // ============================================================
  // BROWSER TAB STATUS
  // ============================================================

  let nativeChatTitle = stripQueueTitle(document.title || "ChatGPT");
  let applyingTitle = false;
  let titleObserver = null;

  let originalFaviconHref = null;
  let statusFaviconLink = null;
  let faviconAnimationTimer = null;
  let faviconFrame = 0;

  function stripQueueTitle(title) {
    return String(title || "ChatGPT")
      .replace(/^(?:🔄|⏳|📥|⏸|😴|✅)\s*(?:Working|Finishing|Queue\s*\d*|Paused|Idle|\d{1,2}:\d{2})?\s*[·\-–—:]?\s*/i, "")
      .replace(/\s*[-–—]\s*ChatGPT.*$/i, "")
      .replace(/^ChatGPT\s*[-–—:]\s*/i, "")
      .trim() || "Untitled chat";
  }

  function chatLabel() {
    return nativeChatTitle || stripQueueTitle(document.title);
  }

  function isPageActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  }

  function captureOriginalFavicon() {
    if (originalFaviconHref) return;
    const current =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');
    originalFaviconHref = current?.href || "/favicon.ico";
  }

  function ensureStatusFaviconLink() {
    captureOriginalFavicon();

    if (statusFaviconLink && statusFaviconLink.isConnected) {
      return statusFaviconLink;
    }

    statusFaviconLink = document.getElementById("cq-status-favicon");

    if (!statusFaviconLink) {
      statusFaviconLink = document.createElement("link");
      statusFaviconLink.id = "cq-status-favicon";
      statusFaviconLink.rel = "icon";
      statusFaviconLink.type = "image/png";
      document.head.appendChild(statusFaviconLink);
    }

    return statusFaviconLink;
  }

  function faviconState() {
    if (state.paused) return "paused";
    if (generationState === "working") return "working";
    if (state.queue.length > 0) return "queued";
    if (state.doneUnread) return "done";
    return "native";
  }

  function drawFavicon(stateName, frame = 0) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, 32, 32);

    // dark circular base so the icon stays readable on both light/dark browser themes
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#202020";
    ctx.fill();

    if (stateName === "working") {
      // Animated amber spinner
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#f0b84b";
      const start = (frame % 8) * (Math.PI / 4);
      ctx.beginPath();
      ctx.arc(16, 16, 9, start, start + Math.PI * 1.2);
      ctx.stroke();
    } else if (stateName === "finishing") {
      // Amber hourglass-ish mark
      ctx.strokeStyle = "#f0b84b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, 9); ctx.lineTo(22, 9);
      ctx.moveTo(10, 23); ctx.lineTo(22, 23);
      ctx.moveTo(11, 10); ctx.lineTo(21, 22);
      ctx.moveTo(21, 10); ctx.lineTo(11, 22);
      ctx.stroke();
    } else if (stateName === "queued") {
      // Blue queue bars + count
      ctx.fillStyle = "#72a7ff";
      ctx.fillRect(8, 9, 16, 3);
      ctx.fillRect(8, 15, 16, 3);
      ctx.fillRect(8, 21, 10, 3);

      const n = Math.min(9, Number(state.queue.length || 0));
      if (n > 0) {
        ctx.beginPath();
        ctx.arc(24, 23, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#72a7ff";
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.font = "bold 8px -apple-system,Segoe UI,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n), 24, 23.5);
      }
    } else if (stateName === "paused") {
      // Red pause
      ctx.fillStyle = "#ff7878";
      ctx.fillRect(10, 8, 4, 16);
      ctx.fillRect(18, 8, 4, 16);
    } else if (stateName === "done") {
      // Green check
      ctx.strokeStyle = "#33c481";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(8, 16);
      ctx.lineTo(14, 22);
      ctx.lineTo(24, 10);
      ctx.stroke();
    } else {
      // Idle / sleep: gray Z
      ctx.fillStyle = "#a0a0a0";
      ctx.font = "bold 16px -apple-system,Segoe UI,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Z", 16, 16);
    }

    return canvas.toDataURL("image/png");
  }

  function stopFaviconAnimation() {
    if (faviconAnimationTimer) {
      clearInterval(faviconAnimationTimer);
      faviconAnimationTimer = null;
    }
  }

  function renderStatusFavicon() {
    captureOriginalFavicon();

    if (!settings.showStatusFavicon) {
      stopFaviconAnimation();
      const link = ensureStatusFaviconLink();
      link.href = originalFaviconHref || "/favicon.ico";
      return;
    }

    const stateName = faviconState();
    const link = ensureStatusFaviconLink();

    stopFaviconAnimation();

    // Once a completed tab has been acknowledged and is idle,
    // restore ChatGPT's normal favicon instead of showing an idle badge.
    if (stateName === "native") {
      link.href = originalFaviconHref || "/favicon.ico";
      return;
    }

    if (stateName === "working") {
      faviconFrame = 0;
      link.href = drawFavicon("working", faviconFrame);

      faviconAnimationTimer = setInterval(() => {
        if (faviconState() !== "working") {
          stopFaviconAnimation();
          renderStatusFavicon();
          return;
        }

        faviconFrame = (faviconFrame + 1) % 8;
        const current = ensureStatusFaviconLink();
        current.href = drawFavicon("working", faviconFrame);
      }, 450);

      return;
    }

    link.href = drawFavicon(stateName, 0);
  }

  function desiredTabPrefix() {
    // Keep ChatGPT's native chat title readable at all times.
    // Status is conveyed by a compact leading symbol only.
    if (state.paused) return "⏸";
    if (generationState === "working") return "🔄";
    if (state.queue.length > 0) return "📥";
    if (state.doneUnread) return "✅";
    return "";
  }

  function renderBrowserTabTitle() {
    // Recover ChatGPT's latest native title first if it changed.
    const stripped = stripQueueTitle(document.title);
    if (
      stripped &&
      stripped !== "Untitled chat" &&
      stripped !== nativeChatTitle
    ) {
      nativeChatTitle = stripped;
    }

    if (!settings.showStatusInTab) {
      if (document.title !== nativeChatTitle) {
        applyingTitle = true;
        document.title = nativeChatTitle;
        queueMicrotask(() => applyingTitle = false);
      }
      renderStatusFavicon();
      return;
    }

    const prefix = desiredTabPrefix();
    const desired = prefix ? `${prefix} · ${nativeChatTitle}` : nativeChatTitle;

    if (document.title !== desired) {
      applyingTitle = true;
      document.title = desired;
      queueMicrotask(() => applyingTitle = false);
    }
  }

  function startTitleGuard() {
    if (titleObserver) titleObserver.disconnect();

    let titleEl = document.querySelector("title");

    if (!titleEl) {
      titleEl = document.createElement("title");
      document.head.appendChild(titleEl);
    }

    titleObserver = new MutationObserver(() => {
      if (applyingTitle) return;

      const stripped = stripQueueTitle(document.title);

      if (
        stripped &&
        stripped !== "Untitled chat" &&
        stripped !== nativeChatTitle
      ) {
        nativeChatTitle = stripped;
      }

      renderBrowserTabTitle();
    });

    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    });

    renderBrowserTabTitle();
  }

  function startFaviconGuard() {
    const head = document.head;
    if (!head) return;

    const observer = new MutationObserver(() => {
      if (!settings.showStatusFavicon) return;
      const current = document.getElementById("cq-status-favicon");
      if (!current || !current.isConnected) {
        statusFaviconLink = null;
        renderStatusFavicon();
      }
    });

    observer.observe(head, { childList: true });
  }

  function markDone() {
    state.lastFinishedAt = Date.now();
    state.doneUnread = true;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    renderBrowserTabTitle();
    updateHeaderButton();
  }

  function markDoneSeen() {
    if (!state.doneUnread) {
      renderBrowserTabTitle();
      return;
    }

    state.doneUnread = false;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    renderBrowserTabTitle();
    updateHeaderButton();
    reportStatus();
  }

  // When the user actually comes back to a completed tab,
  // remove extension status decoration and restore the normal ChatGPT tab appearance.
  window.addEventListener("focus", () => {
    if (generationState === "idle" && !state.queue.length) {
      markDoneSeen();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      generationState === "idle" &&
      !state.queue.length
    ) {
      markDoneSeen();
    }
  });

  function isQueueUiElement(el) {
    return !!(el && el.closest && el.closest("#cq-extension-panel"));
  }

  function getComposer() {
    const selectors = [
      "#prompt-textarea",
      '[contenteditable="true"][data-virtualkeyboard="true"]',
      'textarea[placeholder*="Message"]'
    ];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isQueueUiElement(el)) return el;
      }
    }

    // Never fall back to the extension's own queue textarea. If ChatGPT
    // changes its composer markup, failing safely is better than overwriting
    // whatever the user is currently typing in Prompt Queue.
    return [...document.querySelectorAll("textarea")].find(el => !isQueueUiElement(el)) || null;
  }

  function captureQueueEditorFocus() {
    const active = document.activeElement;
    if (!active || !panel || !panel.contains(active)) return null;

    const snapshot = { element: active };
    if (typeof active.selectionStart === "number") {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
    }
    return snapshot;
  }

  function restoreQueueEditorFocus(snapshot) {
    const el = snapshot?.element;
    if (!el || !el.isConnected || !panel?.contains(el)) return;

    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
    if (typeof snapshot.selectionStart === "number" && typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd); } catch {}
    }
  }
  function getSendButton() {
    return document.getElementById("composer-submit-button")
      || document.querySelector('button[data-testid="send-button"]')
      || document.querySelector('button[aria-label="Send prompt"]')
      || document.querySelector('button[aria-label^="Send"]');
  }
  function getStopButton() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid="stop-response-button"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop response"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label^="Stop"]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null && !el.disabled) return el;
    }
    return null;
  }
  function isGenerating() {
    if (getStopButton()) return true;
    const stream = document.querySelector('[data-is-streaming="true"],[data-streaming="true"]');
    return !!(stream && stream.offsetParent !== null);
  }

  function latestAssistantSignature() {
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const last = messages[messages.length - 1];
    if (!last) return "no-assistant";

    const text = (last.innerText || last.textContent || "").trim();
    const tail = text.slice(-160);
    const childCount = last.querySelectorAll("*").length;
    return `${text.length}:${childCount}:${tail}`;
  }
  function currentStatus() {
    if (state.paused) return "paused";
    if (sending) return "sending";
    if (generationState === "working") return "working";
    if (state.queue.length) return "queued";
    if (state.doneUnread) return "done";
    return "idle";
  }
  function reportStatus() {
    try {
      chrome.runtime.sendMessage({ type:"CQ_STATUS", title:chatLabel(), queueCount:state.queue.length, status:currentStatus(), paused:state.paused, lastFinishedAt:state.lastFinishedAt||0, doneUnread:!!state.doneUnread });
    } catch {}
  }
  function notify(title, message, force=false) {
    // Sound is handled by an extension offscreen document so it also works
    // when the ChatGPT tab is in the background.
    if (settings.playSound) {
      try { chrome.runtime.sendMessage({ type:"CQ_BEEP" }); } catch {}
    }

    if (!settings.notifyWhenFinished && !force) return;
    if (!force && settings.notifyOnlyWhenInactive && isPageActive()) return;
    try { chrome.runtime.sendMessage({ type:"CQ_NOTIFY", title, message }); } catch {}
  }

  function setComposerText(text, focusSnapshot = null) {
    const composer = getComposer();
    if (!composer || isQueueUiElement(composer)) throw new Error("ChatGPT composer not found");

    // ChatGPT sometimes needs its composer focused for React to accept the
    // programmatic input. Focus it only synchronously, then immediately return
    // focus/caret to the Queue editor so background auto-send never steals
    // the user's typing destination.
    try { composer.focus({ preventScroll: true }); } catch { try { composer.focus(); } catch {} }

    if (composer.isContentEditable) {
      composer.innerHTML = "";
      text.split("\n").forEach((line, i) => {
        if (i) composer.appendChild(document.createElement("br"));
        composer.appendChild(document.createTextNode(line));
      });
      composer.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:text }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
      if (setter) setter.call(composer,text); else composer.value = text;
      composer.dispatchEvent(new Event("input",{bubbles:true}));
      composer.dispatchEvent(new Event("change",{bubbles:true}));
    }

    restoreQueueEditorFocus(focusSnapshot);
  }

  function getFileInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(x => !isQueueUiElement(x));
    return inputs.find(x => (x.accept||"").includes("image") || (x.accept||"").includes("*/*")) || inputs[0] || null;
  }
  function attachmentCount() {
    const composer = getComposer(); if (!composer) return 0;
    const root = composer.closest("form") || composer.parentElement?.parentElement?.parentElement; if (!root) return 0;
    const nodes = root.querySelectorAll('img[src^="blob:"],img[src^="data:"],[data-testid*="attachment"],[aria-label*="Remove attachment"],[aria-label*="Remove image"],[aria-label*="Remove file"]');
    const set = new Set();
    nodes.forEach(node => { if (node.offsetParent !== null) set.add(node.tagName === "IMG" ? node.src : node); });
    return set.size;
  }
  async function uploadImages(records) {
    if (!records.length) return;
    const fileInput = getFileInput(); if (!fileInput) throw new Error("ChatGPT image input not found");
    const before = attachmentCount(), dt = new DataTransfer();
    for (const r of records) dt.items.add(new File([r.blob], r.name, { type:r.type || "image/png" }));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("input",{bubbles:true}));
    fileInput.dispatchEvent(new Event("change",{bubbles:true}));
    const expected = before + records.length, start = Date.now();
    while (Date.now() - start < CFG.uploadTimeoutMs) {
      if (attachmentCount() >= expected) { await sleep(CFG.uploadSettleMs); return; }
      await sleep(400);
    }
    throw new Error("Timed out waiting for image attachment");
  }

  async function sendItem(item) {
    if (sending) return false;
    const focusSnapshot = captureQueueEditorFocus();
    sending = true; render(); reportStatus();
    try {
      const records = [];
      for (const meta of item.images || []) {
        const r = await dbGet(meta.id); if (!r) throw new Error(`Missing image: ${meta.name}`); records.push(r);
      }
      if (records.length) {
        await uploadImages(records);
        restoreQueueEditorFocus(focusSnapshot);
      }
      if (item.text?.trim()) setComposerText(item.text, focusSnapshot);
      await sleep(500);
      restoreQueueEditorFocus(focusSnapshot);
      let send = getSendButton(), start = Date.now();
      while ((!send || send.disabled) && Date.now() - start < 10000) {
        await sleep(300);
        restoreQueueEditorFocus(focusSnapshot);
        send = getSendButton();
      }
      if (!send || send.disabled) throw new Error("ChatGPT Send button unavailable");
      send.click();
      restoreQueueEditorFocus(focusSnapshot);
      queueMicrotask(() => restoreQueueEditorFocus(focusSnapshot));
      setTimeout(() => restoreQueueEditorFocus(focusSnapshot), 60);
      lastSentAt = Date.now();
      return true;
    } catch (err) {
      state.paused = true; saveState(); notify(`Queue paused — ${chatLabel()}`, err.message || "Queue send failed", true); return false;
    } finally {
      restoreQueueEditorFocus(focusSnapshot);
      sending = false; render(); reportStatus();
    }
  }

  async function maybeRunQueue() {
    if (state.paused || sending || !state.queue.length) return;
    if (state.activeQueueItemId) return;
    if (generationState === "working" || isGenerating()) return;
    if (Date.now() - lastSentAt < CFG.minSendGapMs) return;

    if (!batchActive) { batchActive = true; batchCompleted = 0; }

    // FIFO lock: always run the oldest pending item and keep its ID locked
    // until the corresponding assistant response is confirmed complete.
    const item = state.queue[0];
    state.activeQueueItemId = item.id;
    saveState();

    const ok = await sendItem(item);
    if (!ok) {
      state.activeQueueItemId = null;
      saveState();
      return;
    }

    // Do NOT shift here. The active item stays at queue[0] while ChatGPT
    // is answering, preventing another queue item from jumping ahead.
    awaitingFinalResponse = state.queue.length === 1;
    saveState();
  }

  async function completeActiveQueueItem() {
    const activeId = state.activeQueueItemId;
    if (!activeId) return null;

    const index = state.queue.findIndex(item => item.id === activeId);
    if (index < 0) {
      state.activeQueueItemId = null;
      saveState();
      return null;
    }

    const [item] = state.queue.splice(index, 1);
    state.activeQueueItemId = null;
    batchCompleted++;
    awaitingFinalResponse = false;
    saveState();

    for (const img of item.images || []) {
      try { await dbDelete(img.id); } catch {}
    }

    return item;
  }

  async function onResponseFinished() {
    const completedItem = await completeActiveQueueItem();

    if (completedItem) {
      if (!state.queue.length) {
        markDone();
        batchActive = false;
        const completedCount = batchCompleted;
        batchCompleted = 0;
        reportStatus();
        notify(
          `Queue complete — ${chatLabel()}`,
          `All ${completedCount} queued task${completedCount === 1 ? "" : "s"} completed · 0 remaining.`
        );
        return;
      }

      const remaining = state.queue.length;
      notify(
        `Queue progress — ${chatLabel()}`,
        `${batchCompleted} completed · ${remaining} queue${remaining === 1 ? "" : "s"} remaining · continuing.`
      );
      maybeRunQueue();
      return;
    }

    // A normal/manual ChatGPT response finished while pending queue items exist.
    // Nothing is dequeued because no queue item was locked to this response.
    if (state.queue.length) {
      const remaining = state.queue.length;
      notify(
        `Response finished — ${chatLabel()}`,
        `${remaining} queue${remaining === 1 ? "" : "s"} remaining · queue starting.`
      );
      maybeRunQueue();
      return;
    }

    markDone();
    reportStatus();
    notify(`ChatGPT finished — ${chatLabel()}`, "Response completed · no queue remaining.");
  }

  function updateGenerationState() {
    const busy = isGenerating();

    if (busy) {
      generationEndedAt = 0;
      completionSignature = "";

      if (generationState !== "working") {
        generationState = "working";
        if (state.doneUnread) {
          state.doneUnread = false;
          localStorage.setItem(STATE_KEY, JSON.stringify(state));
        }
        renderBrowserTabTitle();
        renderStatusFavicon();
        reportStatus();
      }
      return;
    }

    if (generationState === "working") {
      // ChatGPT can remove the Stop button slightly before the final assistant
      // DOM has finished rendering. Keep the tab in Working internally until
      // the latest assistant message has remained unchanged for settleMs.
      // This prevents the next queued prompt from being sent into that gap.
      const now = Date.now();
      const signature = latestAssistantSignature();

      if (!generationEndedAt || signature !== completionSignature) {
        generationEndedAt = now;
        completionSignature = signature;
        return;
      }

      if (now - generationEndedAt < CFG.settleMs) return;

      generationState = "idle";
      generationEndedAt = 0;
      completionSignature = "";
      onResponseFinished();
      renderBrowserTabTitle();
      renderStatusFavicon();
      reportStatus();
    }
  }

  function attachComposerObserver() {
    composerObserver?.disconnect();
    const composer = getComposer(); if (!composer) return;
    const root = composer.closest("form") || composer.parentElement?.parentElement?.parentElement || composer.parentElement; if (!root) return;
    composerObserver = new MutationObserver(() => {
      updateGenerationState();
      if (generationState === "idle" && state.queue.length) maybeRunQueue();
    });
    composerObserver.observe(root, { subtree:true, childList:true, attributes:true, attributeFilter:["disabled","aria-label","data-testid","data-streaming","data-is-streaming"] });
  }

  setInterval(() => {
    updateGenerationState();
    if (generationState === "idle" && state.queue.length) maybeRunQueue();
    if (document.title !== lastKnownTitle) {
      lastKnownTitle = document.title;
      const stripped = stripQueueTitle(document.title);
      if (stripped && stripped !== "Untitled chat" && stripped !== nativeChatTitle) nativeChatTitle = stripped;
      renderBrowserTabTitle();
      renderStatusFavicon();
      reportStatus();
    }
    if (!composerObserver || !getComposer()) attachComposerObserver();
  }, CFG.fallbackCheckMs);

  function buttonCss(primary=false) {
    return `appearance:none!important;border:1px solid ${primary?"#707070":"#444"}!important;background:${primary?"#444":"#242424"}!important;color:#f5f5f5!important;padding:7px 11px!important;border-radius:8px!important;cursor:pointer!important;font:inherit!important;`;
  }

  function makeToggle(key,label) {
    const row = document.createElement("button"); row.type="button"; row.dataset.setting=key;
    Object.assign(row.style,{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",border:"none",background:"transparent",color:"#f2f2f2",padding:"7px 5px",borderRadius:"7px",cursor:"pointer",font:"inherit"});
    const txt=document.createElement("span"); txt.textContent=label;
    const sw=document.createElement("span"); sw.className="cq-switch"; Object.assign(sw.style,{position:"relative",width:"38px",height:"22px",borderRadius:"999px",flex:"0 0 auto"});
    const knob=document.createElement("span"); knob.className="cq-knob"; Object.assign(knob.style,{position:"absolute",top:"3px",width:"16px",height:"16px",borderRadius:"50%",background:"#fff",transition:"left .15s ease"});
    sw.appendChild(knob); row.append(txt,sw); row.onclick=()=>{settings[key]=!settings[key];saveSettings();}; return row;
  }
  function renderSettings() {
    if (!panel) return;
    panel.querySelectorAll("[data-setting]").forEach(row=>{const on=!!settings[row.dataset.setting],sw=row.querySelector(".cq-switch"),knob=row.querySelector(".cq-knob");sw.style.background=on?"#10a37f":"#333";sw.style.border=`1px solid ${on?"#10a37f":"#555"}`;knob.style.left=on?"19px":"3px";});
  }

  function createPanel() {
    if (panel) return;
    panel=document.createElement("div"); panel.id="cq-extension-panel";
    Object.assign(panel.style,{position:"fixed",top:"54px",right:"18px",width:"390px",maxWidth:"calc(100vw - 28px)",maxHeight:"calc(100vh - 72px)",overflowY:"auto",zIndex:"2147483647",background:"#171717",color:"#f5f5f5",border:"1px solid #3f3f3f",borderRadius:"14px",boxShadow:"0 14px 45px rgba(0,0,0,.45)",padding:"14px",fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',fontSize:"14px",display:"none"});
    panel.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><strong>Prompt Queue</strong><button id="cq-close" style="${buttonCss()}">×</button></div>
      <textarea id="cq-input" placeholder="Prompt to queue..." style="box-sizing:border-box!important;width:100%!important;height:88px!important;resize:vertical!important;background:#242424!important;color:#f5f5f5!important;border:1px solid #454545!important;border-radius:10px!important;padding:10px!important;outline:none!important;font:inherit!important;"></textarea>
      <div id="cq-drop" style="margin-top:9px;border:1px dashed #555;border-radius:9px;padding:12px;text-align:center;cursor:pointer;color:#aaa;background:#202020">Add / paste / drop images</div>
      <input id="cq-file" type="file" accept="image/*" multiple style="display:none!important">
      <div id="cq-draft" style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px"><button id="cq-add" style="${buttonCss(true)}">Add</button><button id="cq-pause" style="${buttonCss()}">Pause</button><button id="cq-clear" style="${buttonCss()}">Clear</button><button id="cq-run" style="${buttonCss()}">Run Next</button></div>
      <div id="cq-status" style="margin-top:11px;color:#aaa;font-size:12px"></div>
      <div id="cq-list" style="margin-top:9px;max-height:220px;overflow:auto"></div>
      <div style="margin-top:13px;padding-top:12px;border-top:1px solid #333"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><strong>Notifications</strong><button id="cq-test" style="${buttonCss()}">Test</button></div><div id="cq-settings"></div></div>`;
    document.body.appendChild(panel);
    input=panel.querySelector("#cq-input"); listEl=panel.querySelector("#cq-list"); statusEl=panel.querySelector("#cq-status"); draftEl=panel.querySelector("#cq-draft"); filePicker=panel.querySelector("#cq-file");
    panel.querySelector("#cq-settings").append(makeToggle("notifyWhenFinished","Notify when finished"),makeToggle("notifyOnlyWhenInactive","Only when tab isn't active"),makeToggle("showStatusInTab","Show status in tab title"),makeToggle("showStatusFavicon","Show status favicon"),makeToggle("playSound","Play short sound"));
    panel.querySelector("#cq-close").onclick=hidePanel;
    panel.querySelector("#cq-add").onclick=addDraftToQueue;
    panel.querySelector("#cq-pause").onclick=()=>{state.paused=!state.paused;saveState();};
    panel.querySelector("#cq-clear").onclick=clearQueue;
    panel.querySelector("#cq-run").onclick=()=>{state.paused=false;generationState="idle";lastSentAt=0;saveState();maybeRunQueue();};
    panel.querySelector("#cq-test").onclick=()=>notify(`ChatGPT test — ${chatLabel()}`,"Notifications are working.",true);
    const drop=panel.querySelector("#cq-drop"); drop.onclick=()=>filePicker.click();
    filePicker.onchange=async e=>{await addFiles(e.target.files);filePicker.value="";};
    drop.ondragover=e=>e.preventDefault(); drop.ondrop=async e=>{e.preventDefault();await addFiles(e.dataTransfer.files);};
    panel.addEventListener("paste",async e=>{const imgs=[...e.clipboardData.files].filter(f=>f.type.startsWith("image/"));if(!imgs.length)return;e.preventDefault();await addFiles(imgs);});
    input.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();addDraftToQueue();}});
    renderSettings(); render();
  }

  async function addFiles(files) {
    const imgs=[...files].filter(f=>f.type.startsWith("image/")), room=CFG.maxImagesPerItem-draftImages.length;
    for(const f of imgs.slice(0,room)){
      if(f.size>CFG.maxImageSizeMB*1024*1024){alert(`${f.name} is larger than ${CFG.maxImageSizeMB} MB.`);continue;}
      const id=makeId("img"), rec={id,name:f.name||`image-${Date.now()}.png`,type:f.type||"image/png",size:f.size,blob:f};
      await dbPut(rec); draftImages.push({id:rec.id,name:rec.name,type:rec.type,size:rec.size});
    }
    renderDraft();
  }
  async function renderDraft(){
    if(!draftEl)return;draftEl.innerHTML="";
    for(const meta of draftImages){
      const rec=await dbGet(meta.id);if(!rec)continue;const url=URL.createObjectURL(rec.blob),box=document.createElement("div");Object.assign(box.style,{width:"64px",height:"64px",position:"relative",borderRadius:"8px",overflow:"hidden",border:"1px solid #444"});
      const img=document.createElement("img");img.src=url;Object.assign(img.style,{width:"100%",height:"100%",objectFit:"cover"});img.onload=()=>URL.revokeObjectURL(url);
      const x=document.createElement("button");x.textContent="×";Object.assign(x.style,{position:"absolute",top:"3px",right:"3px",width:"21px",height:"21px",border:"none",borderRadius:"50%",background:"rgba(0,0,0,.75)",color:"#fff",cursor:"pointer"});x.onclick=async ev=>{ev.stopPropagation();draftImages=draftImages.filter(i=>i.id!==meta.id);try{await dbDelete(meta.id);}catch{}renderDraft();};box.append(img,x);draftEl.appendChild(box);
    }
  }
  async function addDraftToQueue(){
    const text=input.value.trim();if(!text&&!draftImages.length)return;
    state.queue.push({id:makeId("q"),text,images:draftImages.map(x=>({...x})),addedAt:Date.now()});input.value="";draftImages=[];state.paused=false;saveState();renderDraft();if(generationState==="idle")maybeRunQueue();
  }
  async function clearQueue(){
    for(const item of state.queue)for(const img of item.images||[])try{await dbDelete(img.id);}catch{}
    state.queue=[];state.activeQueueItemId=null;batchActive=false;batchCompleted=0;awaitingFinalResponse=false;saveState();
  }
  async function removeQueueItem(index){const item=state.queue[index];if(!item)return;if(item.id===state.activeQueueItemId)return;for(const img of item.images||[])try{await dbDelete(img.id);}catch{}state.queue.splice(index,1);saveState();}
  function moveQueueItem(index,dir){const target=index+dir;if(target<0||target>=state.queue.length)return;const current=state.queue[index],other=state.queue[target];if(current?.id===state.activeQueueItemId||other?.id===state.activeQueueItemId)return;[state.queue[index],state.queue[target]]=[state.queue[target],state.queue[index]];saveState();}

  function render(){
    if(!panel)return;statusEl.textContent=`${state.paused?"Paused":"Active"} · ${currentStatus()} · ${state.queue.length} queued`;panel.querySelector("#cq-pause").textContent=state.paused?"Resume":"Pause";listEl.innerHTML="";
    state.queue.forEach((item,i)=>{const row=document.createElement("div");Object.assign(row.style,{display:"flex",gap:"8px",padding:"9px 0",borderTop:"1px solid #303030"});const body=document.createElement("div");body.style.flex="1";body.style.minWidth="0";const title=document.createElement("div");title.style.whiteSpace="nowrap";title.style.overflow="hidden";title.style.textOverflow="ellipsis";title.textContent=`${i+1}. ${item.id===state.activeQueueItemId?"▶ Running · ":""}${item.text||"(images only)"}`;body.appendChild(title);if(item.images?.length){const meta=document.createElement("div");meta.style.cssText="font-size:11px;color:#999;margin-top:3px";meta.textContent=`Image × ${item.images.length}`;body.appendChild(meta);}const controls=document.createElement("div");controls.style.display="flex";controls.style.gap="3px";controls.innerHTML=`<button style="${buttonCss()}">↑</button><button style="${buttonCss()}">↓</button><button style="${buttonCss()}">×</button>`;const bs=controls.querySelectorAll("button");const locked=item.id===state.activeQueueItemId;bs.forEach(b=>{b.disabled=locked;b.style.opacity=locked?".35":"1";});bs[0].onclick=()=>moveQueueItem(i,-1);bs[1].onclick=()=>moveQueueItem(i,1);bs[2].onclick=()=>removeQueueItem(i);row.append(body,controls);listEl.appendChild(row);});
    renderSettings();updateHeaderButton();
  }

  // Robust header injection: Share -> More/menu -> right-side header cluster
  function cqVisible(el){
    if(!el||!el.isConnected)return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0;
  }

  function cqFindHeaderRoot(){
    const sels=['header','[data-testid*="header"]','[class*="header"]'];
    for(const s of sels){
      for(const n of document.querySelectorAll(s)){
        const r=n.getBoundingClientRect();
        if(cqVisible(n)&&r.top<=80&&r.height>=24&&r.height<=140)return n;
      }
    }
    return null;
  }

  function cqFindHeaderAnchor(){
    const sels=[
      'button[aria-label="Share"]',
      'button[aria-label^="Share"]',
      'button[data-testid*="share"]',
      'button[aria-label="More"]',
      'button[aria-label^="More"]',
      'button[aria-label*="More options"]',
      'button[aria-label*="More actions"]',
      'button[data-testid*="more"]',
      'button[data-testid*="menu"]'
    ];
    for(const s of sels){
      for(const n of document.querySelectorAll(s)){
        const r=n.getBoundingClientRect();
        if(cqVisible(n)&&r.top<=100&&r.right>=window.innerWidth*.5)return n;
      }
    }

    const header=cqFindHeaderRoot();
    if(header){
      const buttons=[...header.querySelectorAll("button")]
        .filter(b=>{
          if(!cqVisible(b))return false;
          const r=b.getBoundingClientRect();
          return r.top<=100&&r.right>=window.innerWidth*.5;
        })
        .sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right);
      if(buttons.length)return buttons[0];
    }
    return null;
  }

  function cqFindActionContainer(anchor){
    if(!anchor)return null;
    let n=anchor.parentElement;
    for(let i=0;i<5&&n;i++,n=n.parentElement){
      const r=n.getBoundingClientRect();
      const bc=n.querySelectorAll("button").length;
      if(cqVisible(n)&&bc>=1&&bc<=12&&r.height>=24&&r.height<=80&&r.width<=560)return n;
    }
    return anchor.parentElement;
  }

  function ensureHeaderButton(){
    const existing=document.getElementById("cq-extension-header");
    if(existing&&existing.isConnected){
      headerButton=existing;
      updateHeaderButton();
      return true;
    }

    headerButton=null;
    const anchor=cqFindHeaderAnchor();
    if(!anchor)return false;

    const container=cqFindActionContainer(anchor);
    if(!container)return false;

    headerButton=document.createElement("button");
    headerButton.id="cq-extension-header";
    headerButton.type="button";
    headerButton.setAttribute("aria-label","ChatGPT Queue");
    headerButton.title="ChatGPT Queue";
