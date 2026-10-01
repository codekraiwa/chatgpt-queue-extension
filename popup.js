const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");
const refreshBtn = document.getElementById("refresh");
const settingsBtn = document.getElementById("settings-btn");
const tabsView = document.getElementById("tabs-view");
const settingsView = document.getElementById("settings-view");
const pageTitle = document.getElementById("page-title");
const backBtn = document.getElementById("back-btn");
const settingNotify = document.getElementById("setting-notify");
const settingInactive = document.getElementById("setting-inactive");
const settingSound = document.getElementById("setting-sound");
const testNotificationBtn = document.getElementById("test-notification");
const testSoundBtn = document.getElementById("test-sound");
const settingsStatus = document.getElementById("settings-status");

async function loadGlobalSettings() {
  const [res, notificationStatus] = await Promise.all([
    chrome.runtime.sendMessage({ type: "CQ_GET_GLOBAL_SETTINGS" }),
    chrome.runtime.sendMessage({ type: "CQ_GET_NOTIFICATION_STATUS" })
  ]);
  const gs = res?.settings || {};
  settingNotify.checked = gs.notifyWhenFinished !== false;
  settingInactive.checked = gs.notifyOnlyWhenInactive !== false;
  settingSound.checked = gs.playSound !== false;

  if (notificationStatus?.level && notificationStatus.level !== "granted") {
    settingsStatus.textContent = `Chrome notification permission: ${notificationStatus.level}. Check macOS System Settings → Notifications → Google Chrome.`;
    settingsStatus.classList.add("warning");
  } else {
    settingsStatus.classList.remove("warning");
  }
}

async function saveGlobalSettings() {
  settingsStatus.textContent = "Saving…";
  const res = await chrome.runtime.sendMessage({
    type: "CQ_SET_GLOBAL_SETTINGS",
    settings: {
      notifyWhenFinished: settingNotify.checked,
      notifyOnlyWhenInactive: settingInactive.checked,
      playSound: settingSound.checked
    }
  });
  settingsStatus.textContent = res?.ok ? "Saved" : "Could not save settings";
  setTimeout(() => { if (settingsStatus.textContent === "Saved") settingsStatus.textContent = ""; }, 1200);
}

[settingNotify, settingInactive, settingSound].forEach(el => el.addEventListener("change", saveGlobalSettings));

testNotificationBtn.onclick = async () => {
  settingsStatus.classList.remove("warning");
  settingsStatus.textContent = "Testing notification…";
  const res = await chrome.runtime.sendMessage({ type: "CQ_TEST_NOTIFICATION" });
  if (res?.ok) {
    settingsStatus.textContent = "High-priority notification created. It will stay visible until dismissed; Chrome will also request attention if it is in the background.";
  } else {
    settingsStatus.classList.add("warning");
    settingsStatus.textContent = `Notification failed${res?.permission ? ` (${res.permission})` : ""}: ${res?.error || "unknown error"}`;
  }
};

testSoundBtn.onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CQ_TEST_SOUND" });
  settingsStatus.textContent = "Test sound played";
};

refreshBtn.onclick = load;

settingsBtn.onclick = () => {
  tabsView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  summaryEl.classList.add("hidden");
  refreshBtn.classList.add("hidden");
  settingsBtn.classList.add("hidden");
  pageTitle.textContent = "Settings";
  loadGlobalSettings();
};

backBtn.onclick = () => {
  settingsView.classList.add("hidden");
  tabsView.classList.remove("hidden");
  summaryEl.classList.remove("hidden");
  refreshBtn.classList.remove("hidden");
  settingsBtn.classList.remove("hidden");
  pageTitle.textContent = "ChatGPT Queue";
};

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function normalizedStatus(tab) {
  if (tab.paused) return "paused";
  if (["working","finishing","sending"].includes(tab.status)) return "working";
  if (tab.doneUnread || tab.status === "done") return "done";
  if (tab.queueCount > 0) return "queued";
  return "idle";
}

function statusText(tab) {
  const s = normalizedStatus(tab);
  if (s === "working") {
    if (tab.status === "sending") return "Sending";
    if (tab.status === "finishing") return "Finishing";
    return "Working";
  }
  if (s === "done") return "Done";
  if (s === "paused") return "Paused";
  if (s === "queued") return "Queued";
  return "Idle";
}

function statusIcon(tab) {
  const s = normalizedStatus(tab);
  if (s === "working") return "🔄";
  if (s === "done") return "✅";
  if (s === "paused") return "⏸";
  if (s === "queued") return "📥";
  return "😴";
}

function statusClass(tab) {
  return `status-${normalizedStatus(tab)}`;
}

function formatLastFinished(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    if (sameDay) return `Last done ${time}`;

    const date = d.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    });

    return `Last done ${date} ${time}`;
  } catch {
    return "";
  }
}

function sectionFor(tab) {
  if (tab.active) return "current";
  if (
    tab.paused ||
    tab.queueCount > 0 ||
    ["working","finishing","sending","done"].includes(tab.status) ||
    tab.doneUnread
  ) return "active";
  return "other";
}

function buildSummary(tabs) {
  const working = tabs.filter(t => ["working","finishing","sending"].includes(t.status)).length;
  const queued = tabs.reduce((sum, t) => sum + Number(t.queueCount || 0), 0);

  summaryEl.innerHTML = `
    <span class="summary-pill">${tabs.length} tab${tabs.length === 1 ? "" : "s"}</span>
    ${working ? `<span class="summary-pill working">${working} working</span>` : ""}
    ${queued ? `<span class="summary-pill queued">${queued} queued</span>` : ""}
  `;
}

async function command(tabId, command) {
  await chrome.runtime.sendMessage({
    type: "CQ_COMMAND",
    tabId,
    command
  });
  setTimeout(load, 220);
}

async function focusTab(tabId) {
  await chrome.runtime.sendMessage({
    type: "CQ_FOCUS_TAB",
    tabId
  });
}

async function openTab(tabId) {
  await focusTab(tabId);
  window.close();
}

async function openQueuePanel(tabId) {
  await chrome.runtime.sendMessage({
    type: "CQ_COMMAND",
    tabId,
    command: "togglePanel"
  });
  await focusTab(tabId);
  window.close();
}

function makeCard(tab) {
  const card = document.createElement("article");
  const status = normalizedStatus(tab);

  card.className = [
    "card",
    tab.active ? "current" : "",
    ["working","queued","done"].includes(status) ? "active-card" : "",
    status === "paused" ? "paused-card" : ""
  ].filter(Boolean).join(" ");

  const queueMeta = tab.queueCount > 0
    ? `<span class="queue-count">${tab.queueCount} queued</span>`
    : "";

  const lastDone = formatLastFinished(tab.lastFinishedAt);

  card.innerHTML = `
    <div class="card-head">
      <div class="title" title="${esc(tab.title || "ChatGPT")}">
        ${statusIcon(tab)} ${esc(tab.title || "ChatGPT")}
      </div>
      <div class="badges">
        ${tab.active ? `<span class="badge current">Current</span>` : ""}
      </div>
    </div>

    <div class="meta">
      <span class="status-chip ${statusClass(tab)}">
        <span class="status-dot"></span>
        ${statusText(tab)}
      </span>
      ${queueMeta}
      ${lastDone ? `<span class="last-done">${esc(lastDone)}</span>` : ""}
    </div>

    <div class="actions"></div>
  `;

  const actions = card.querySelector(".actions");

  const openBtn = document.createElement("button");
  openBtn.className = "action-button primary";
  openBtn.textContent = "Open";
  openBtn.onclick = () => openTab(tab.tabId);
  actions.appendChild(openBtn);

  const queueBtn = document.createElement("button");
  queueBtn.className = "action-button";
  queueBtn.textContent = "Queue";
  queueBtn.onclick = () => openQueuePanel(tab.tabId);
  actions.appendChild(queueBtn);

  if (tab.queueCount > 0 && !tab.paused) {
    const runBtn = document.createElement("button");
    runBtn.className = "action-button run";
    runBtn.textContent = "Run next";
    runBtn.onclick = () => command(tab.tabId, "runNext");
    actions.appendChild(runBtn);
  }

  if (tab.paused) {
    const resumeBtn = document.createElement("button");
    resumeBtn.className = "action-button resume";
    resumeBtn.textContent = "Resume";
    resumeBtn.onclick = () => command(tab.tabId, "resume");
    actions.appendChild(resumeBtn);
  } else if (
    tab.queueCount > 0 ||
    ["working","finishing","sending"].includes(tab.status)
  ) {
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "action-button pause";
    pauseBtn.textContent = "Pause";
    pauseBtn.onclick = () => command(tab.tabId, "pause");
    actions.appendChild(pauseBtn);
  }

  return card;
}

function addSection(title, tabs) {
  if (!tabs.length) return;

  const section = document.createElement("section");
  section.className = "section";

  const heading = document.createElement("div");
  heading.className = "section-title";
  heading.textContent = title;
  section.appendChild(heading);

  tabs.forEach(tab => section.appendChild(makeCard(tab)));
  tabsEl.appendChild(section);
}

function sortTabs(tabs) {
  const rank = t => {
    let score = 0;
    if (t.paused) score += 500;
    if (["working","finishing","sending"].includes(t.status)) score += 400;
    if (t.queueCount > 0) score += 300 + Number(t.queueCount || 0);
    if (t.doneUnread || t.status === "done") score += 200;
    score += Math.min(Number(t.updatedAt || 0) / 1e13, 50);
    return score;
  };

  return [...tabs].sort((a, b) => rank(b) - rank(a));
}

async function load() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "CQ_GET_TABS" });
    const tabs = res?.tabs || [];

    buildSummary(tabs);
    tabsEl.innerHTML = "";

    if (!tabs.length) {
      tabsEl.innerHTML = `
        <div class="empty">
          <strong>No ChatGPT tabs found</strong>
          Open ChatGPT, then refresh.
        </div>
      `;
      return;
    }

    addSection("Current", tabs.filter(t => sectionFor(t) === "current"));
    addSection("Active / Queued", sortTabs(tabs.filter(t => sectionFor(t) === "active")));
    addSection("Other tabs", sortTabs(tabs.filter(t => sectionFor(t) === "other")));

  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻";
  }
}

load();
