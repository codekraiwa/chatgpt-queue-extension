const tabState = new Map();
const notificationToTab = new Map();

function notificationTabId(notificationId) {
  const mapped = notificationToTab.get(notificationId);
  if (Number.isInteger(mapped)) return mapped;
  const match = /^cq-(\d+)-/.exec(String(notificationId || ""));
  return match ? Number(match[1]) : null;
}

const GLOBAL_SETTINGS_DEFAULTS = {
  notifyWhenFinished: true,
  notifyOnlyWhenInactive: false,
  playSound: true,
  soundPreset: 'alert',
  soundVolume: 100,
  soundRepeats: 1,
  loudSoundVersion: 2,
  activeNotifyVersion: 1,
  strongAttention: true
};

async function getGlobalSettings() {
  const stored = await chrome.storage.sync.get('cqGlobalSettings');
  const current = stored.cqGlobalSettings || {};
  const merged = { ...GLOBAL_SETTINGS_DEFAULTS, ...current };

  // One-time loud-sound migration for existing installs that still carry
  // the older quiet defaults. Users can change these again afterwards.
  if (current.loudSoundVersion !== 2) {
    merged.soundPreset = 'alert';
    merged.soundVolume = 100;
    merged.soundRepeats = 1;
    merged.loudSoundVersion = 2;
  }

  // v1.8.3: notifications are shown even when the ChatGPT tab is active by default.
  if (current.activeNotifyVersion !== 1) {
    merged.notifyOnlyWhenInactive = false;
    merged.activeNotifyVersion = 1;
  }

  if (JSON.stringify(merged) !== JSON.stringify(current)) {
    await chrome.storage.sync.set({ cqGlobalSettings: merged });
  }

  return merged;
}

async function setGlobalSettings(patch) {
  const next = { ...(await getGlobalSettings()), ...(patch || {}) };
  await chrome.storage.sync.set({ cqGlobalSettings: next });
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'CQ_GLOBAL_SETTINGS_CHANGED', settings: next })));
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
        title: title || "Prompt & Leave, ChatGPT Queue",
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

async function drawAttentionForTab(tabId, strong = false) {
  try {
    if (tabId != null) {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) {
        const win = await chrome.windows.get(tab.windowId);
        if (!win.focused) {
          await chrome.windows.update(tab.windowId, { drawAttention: true });
          if (strong) {
            await new Promise(r => setTimeout(r, 900));
            await chrome.windows.update(tab.windowId, { drawAttention: true });
          }
        }
        return;
      }
    }
    const win = await chrome.windows.getLastFocused();
    if (win?.id != null && !win.focused) {
      await chrome.windows.update(win.id, { drawAttention: true });
      if (strong) {
        await new Promise(r => setTimeout(r, 900));
        await chrome.windows.update(win.id, { drawAttention: true });
      }
    }
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
    getGlobalSettings().then(settings => playCompletionBeep(settings));
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
    createSystemNotification(id, "Prompt & Leave, ChatGPT Queue", "Notifications are working.")
      .then(async result => {
        if (result.ok) {
          const settings = await getGlobalSettings();
          await drawAttentionForTab(null, settings.strongAttention);
          if (settings.playSound) await playCompletionBeep(settings);
        }
        sendResponse?.(result);
      });
    return true;
  }

  if (msg.type === "CQ_GET_NOTIFICATION_STATUS") {
    getNotificationPermissionLevel().then(result => sendResponse?.({ ok: true, ...result }));
    return true;
  }

  if (msg.type === "CQ_TEST_SOUND") {
    getGlobalSettings().then(async settings => {
      await playCompletionBeep(settings);
      sendResponse?.({ ok: true });
    });
    return true;
  }

  if (msg.type === "CQ_NOTIFY" && tabId != null) {
    const id = `cq-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    notificationToTab.set(id, tabId);
    createSystemNotification(id, msg.title || "Prompt & Leave, ChatGPT Queue", msg.message || "Task completed.")
      .then(async result => {
        if (!result.ok) notificationToTab.delete(id);
        else {
          const settings = await getGlobalSettings();
          await drawAttentionForTab(tabId, settings.strongAttention);
        }
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

async function getVisibleNotificationIds() {
  return new Promise(resolve => {
    try {
      chrome.notifications.getAll(items => {
        if (chrome.runtime.lastError) return resolve([]);
        resolve(Object.keys(items || {}));
      });
    } catch {
      resolve([]);
    }
  });
}

async function clearNotificationsForTab(tabId, acknowledge = true) {
  if (tabId == null) return;

  // The MV3 service worker can be suspended, which clears in-memory Maps.
  // Recover ownership from the notification id itself so multiple queued
  // completions still clear and route correctly after a worker restart.
  const visibleIds = await getVisibleNotificationIds();
  const ids = new Set(visibleIds.filter(id => notificationTabId(id) === tabId));

  for (const [notificationId, mappedTabId] of notificationToTab.entries()) {
    if (mappedTabId === tabId) ids.add(notificationId);
  }

  await Promise.allSettled([...ids].map(async notificationId => {
    notificationToTab.delete(notificationId);
    await chrome.notifications.clear(notificationId);
  }));

  if (acknowledge) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "CQ_COMMAND", command: "ackDone" });
    } catch {}
  }
}

chrome.notifications.onClicked.addListener(id => {
  const tabId = notificationTabId(id);
  if (tabId == null) return;

  chrome.tabs.get(tabId, tab => {
    if (chrome.runtime.lastError || !tab) {
      notificationToTab.delete(id);
      chrome.notifications.clear(id);
      return;
    }

    chrome.windows.update(tab.windowId, { focused: true }, () => {
      chrome.tabs.update(tabId, { active: true }, () => {
        clearNotificationsForTab(tabId, true);
      });
    });
  });
});

chrome.notifications.onClosed.addListener(id => {
  notificationToTab.delete(id);
});

chrome.tabs.onActivated.addListener(activeInfo => {
  clearNotificationsForTab(activeInfo.tabId, true);
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, tabs => {
    const tab = tabs[0];
    if (tab?.id != null) clearNotificationsForTab(tab.id, true);
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  clearNotificationsForTab(tabId, false);
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
      justification: "Play the Prompt & Leave, ChatGPT Queue completion beep."
    });
  } catch (err) {
    // createDocument throws if another worker created it in the meantime.
    if (!String(err?.message || err).toLowerCase().includes("single offscreen")) {
      console.warn("Prompt & Leave, ChatGPT Queue: offscreen audio setup failed", err);
    }
  }
}

async function playCompletionBeep(settings = {}) {
  try {
    await ensureOffscreenAudioDocument();
    await chrome.runtime.sendMessage({
      type: "CQ_OFFSCREEN_BEEP",
      preset: settings.soundPreset || 'alert',
      volume: Number(settings.soundVolume ?? 100),
      repeats: Math.max(1, Math.min(5, Number(settings.soundRepeats || 2)))
    });
  } catch (err) {
    console.warn("Prompt & Leave, ChatGPT Queue: completion beep failed", err);
  }
}