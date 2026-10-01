const tabState = new Map();
const notificationToTab = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? msg.tabId;

  if (msg.type === "CQ_STATUS" && tabId != null) {
    tabState.set(tabId, {
      tabId,
      title: msg.title || sender.tab?.title || "ChatGPT",
      url: sender.tab?.url || "",
      queueCount: msg.queueCount || 0,
      status: msg.status || "idle",
      paused: !!msg.paused,
      lastFinishedAt: Number(msg.lastFinishedAt || 0),
      doneUnread: !!msg.doneUnread,
      updatedAt: Date.now()
    });
    updateBadge();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "CQ_BEEP") {
    playCompletionBeep();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "CQ_NOTIFY" && tabId != null) {
    const id = `cq-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    notificationToTab.set(id, tabId);
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icon128.png",
      title: msg.title || "ChatGPT Queue",
      message: msg.message || "Task completed."
    });
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "CQ_GET_TABS") {
    chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] }, tabs => {
      const rows = tabs.map(tab => {
        const cached = tabState.get(tab.id) || {};
        return {
          tabId: tab.id,
          title: cached.title || tab.title || "ChatGPT",
          url: tab.url || "",
          active: !!tab.active,
          queueCount: cached.queueCount || 0,
          status: cached.status || "unknown",
          paused: !!cached.paused,
          updatedAt: cached.updatedAt || 0
        };
      });
      sendResponse({ ok: true, tabs: rows });
    });
    return true;
  }

  if (msg.type === "CQ_FOCUS_TAB" && msg.tabId != null) {
    chrome.tabs.get(msg.tabId, tab => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse?.({ ok: false });
        return;
      }
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        chrome.tabs.update(msg.tabId, { active: true }, () => sendResponse?.({ ok: true }));
      });
    });
    return true;
  }

  if (msg.type === "CQ_COMMAND" && msg.tabId != null) {
    chrome.tabs.sendMessage(msg.tabId, { type: "CQ_COMMAND", command: msg.command }, response => {
      sendResponse?.(response || { ok: !chrome.runtime.lastError });
    });
    return true;
  }
});

chrome.notifications.onClicked.addListener(id => {
  const tabId = notificationToTab.get(id);
  if (tabId == null) return;
  chrome.tabs.get(tabId, tab => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.windows.update(tab.windowId, { focused: true }, () => {
      chrome.tabs.update(tabId, { active: true });
    });
  });
  notificationToTab.delete(id);
  chrome.notifications.clear(id);
});

chrome.tabs.onRemoved.addListener(tabId => {
  tabState.delete(tabId);
  updateBadge();
});

async function updateBadge() {
  let total = 0;
  for (const s of tabState.values()) total += Number(s.queueCount || 0);
  await chrome.action.setBadgeText({ text: total ? String(total) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#10a37f" });
}


async function ensureOffscreenAudioDocument() {
  const url = chrome.runtime.getURL("offscreen.html");

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts.length) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play the ChatGPT Queue completion beep."
    });
  } catch (err) {
    // createDocument throws if another worker created it in the meantime.
    if (!String(err?.message || err).toLowerCase().includes("single offscreen")) {
      console.warn("ChatGPT Queue: offscreen audio setup failed", err);
    }
  }
}

async function playCompletionBeep() {
  try {
    await ensureOffscreenAudioDocument();
    await chrome.runtime.sendMessage({ type: "CQ_OFFSCREEN_BEEP" });
  } catch (err) {
    console.warn("ChatGPT Queue: completion beep failed", err);
  }
}
