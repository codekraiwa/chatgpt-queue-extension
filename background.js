const tabState = new Map();
const notificationToTab = new Map();

const GLOBAL_SETTINGS_DEFAULTS = {
  notifyWhenFinished: true,
  notifyOnlyWhenInactive: true,
  playSound: true
};

async function getGlobalSettings() {
  const stored = await chrome.storage.sync.get("cqGlobalSettings");
  return { ...GLOBAL_SETTINGS_DEFAULTS, ...(stored.cqGlobalSettings || {}) };
}

async function setGlobalSettings(patch) {
  const next = { ...(await getGlobalSettings()), ...(patch || {}) };
  await chrome.storage.sync.set({ cqGlobalSettings: next });
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "CQ_GLOBAL_SETTINGS_CHANGED", settings: next })));
  return next;
}

function getNotificationPermissionLevel() {
  return new Promise(resolve => {
    try {
      chrome.notifications.getPermissionLevel(level => {
        if (chrome.runtime.lastError) {
          resolve({ level: "unknown", error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ level: level || "unknown", error: "" });
      });
    } catch (err) {
      resolve({ level: "unknown", error: String(err?.message || err) });
    }
  });
}

async function createSystemNotification(id, title, message) {
  const permission = await getNotificationPermissionLevel();
  if (permission.level !== "granted") {
    return { ok: false, permission: permission.level, error: permission.error || `Notification permission is ${permission.level}.` };
  }

  return new Promise(resolve => {
    try {
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon128.png"),
        title: title || "ChatGPT Queue",
        message: message || "Task completed.",
        expandedMessage: message || "Task completed.",
        priority: 2,
        requireInteraction: true,
        silent: false
      }, notificationId => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, permission: permission.level, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: !!notificationId, notificationId, permission: permission.level, error: notificationId ? "" : "Chrome did not create a notification." });
      });
    } catch (err) {
      resolve({ ok: false, permission: permission.level, error: String(err?.message || err) });
    }
  });
}

async function drawAttentionForTab(tabId) {
  try {
    if (tabId != null) {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) {
        const win = await chrome.windows.get(tab.windowId);
        if (!win.focused) await chrome.windows.update(tab.windowId, { drawAttention: true });
        return;
      }
    }
    const win = await chrome.windows.getLastFocused();
    if (win?.id != null && !win.focused) await chrome.windows.update(win.id, { drawAttention: true });
  } catch {}
}

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

  if (msg.type === "CQ_GET_GLOBAL_SETTINGS") {
    getGlobalSettings().then(settings => sendResponse?.({ ok: true, settings }));
    return true;
  }

  if (msg.type === "CQ_SET_GLOBAL_SETTINGS") {
    setGlobalSettings(msg.settings || {}).then(settings => sendResponse?.({ ok: true, settings }));
    return true;
  }

  if (msg.type === "CQ_TEST_NOTIFICATION") {
    const id = `cq-test-${Date.now()}`;
    createSystemNotification(id, "ChatGPT Queue", "Notifications are working.")
      .then(async result => {
        if (result.ok) await drawAttentionForTab(null);
        sendResponse?.(result);
      });
    return true;
  }

  if (msg.type === "CQ_GET_NOTIFICATION_STATUS") {
    getNotificationPermissionLevel().then(result => sendResponse?.({ ok: true, ...result }));
    return true;
  }

  if (msg.type === "CQ_TEST_SOUND") {
    playCompletionBeep();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "CQ_NOTIFY" && tabId != null) {
    const id = `cq-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    notificationToTab.set(id, tabId);
    createSystemNotification(id, msg.title || "ChatGPT Queue", msg.message || "Task completed.")
      .then(async result => {
        if (!result.ok) notificationToTab.delete(id);
        else await drawAttentionForTab(tabId);
        sendResponse?.(result);
      });
    return true;
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
