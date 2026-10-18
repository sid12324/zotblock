const APP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
let savedTimer = "";

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && APP_HOSTS.has(url.hostname) && (url.port === "3000" || url.port === "");
  } catch {
    return false;
  }
}

function focusReturnUrl(value) {
  try {
    const url = new URL(value);
    if (isAppUrl(url.href)) return `${url.origin}/focus`;
  } catch { /* An unexpected address falls back to the local focus page. */ }
  return "http://localhost:3000/focus";
}

function isAppSender(sender) {
  return [sender?.tab?.url, sender?.url].some(isAppUrl);
}

function saveTimer(state) {
  const active = state?.active === true && typeof state.endsAt === "number" && state.endsAt > Date.now();
  const timer = {
    active,
    endsAt: active ? state.endsAt : null,
    title: active && typeof state.title === "string" ? state.title.slice(0, 200) : "",
    returnUrl: focusReturnUrl(state?.returnUrl),
  };
  const serialized = JSON.stringify(timer);
  if (serialized === savedTimer) return;
  savedTimer = serialized;
  chrome.storage.local.set({ timer });
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#254c83" });
    chrome.action.setBadgeText({ text: active ? "ON" : "" });
  } catch { /* The toolbar badge is only a status hint. */ }
}

function inject(tab, sites) {
  if (!tab?.id || !tab.url || !chrome.scripting?.executeScript) return;
  let files = null;
  if (isAppUrl(tab.url)) files = ["logic.js", "bridge.js"];
  else if (/^https?:/.test(tab.url)) {
    try {
      if (globalThis.ZotBlockGuard.hostIsBlocked(new URL(tab.url).hostname, sites)) files = ["logic.js", "guard.js"];
    } catch { files = null; }
  }
  if (!files) return;
  const pending = chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
  if (pending && typeof pending.catch === "function") pending.catch(() => {});
}

function watchOpenTabs() {
  const sites = globalThis.ZotBlockGuard.DEFAULT_SITES;
  chrome.storage.local.get("blockedSites", stored => {
    const blocked = Array.isArray(stored.blockedSites) ? stored.blockedSites : sites;
    chrome.tabs.query({}, tabs => {
      if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
      tabs.forEach(tab => inject(tab, blocked));
    });
  });
}

function pullTimers() {
  if (!chrome.tabs?.query || !chrome.scripting?.executeScript) return;
  chrome.tabs.query({}, tabs => {
    const appTabs = (tabs || []).filter(tab => tab.id && isAppUrl(tab.url || ""));
    if (appTabs.length === 0) return;
    let remaining = appTabs.length;
    let reads = 0;
    let active = null;
    const finish = () => {
      remaining -= 1;
      if (remaining > 0 || reads === 0) return;
      saveTimer(active || { active: false, returnUrl: "http://localhost:3000/focus" });
    };
    for (const tab of appTabs) {
      const task = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { try { return localStorage.getItem("zotblock-focus-timer-v1"); } catch { return null; } },
      });
      const apply = results => {
        reads += 1;
        const raw = Array.isArray(results) ? results[0]?.result : null;
        if (typeof raw === "string") {
          const state = globalThis.ZotBlockGuard.timerFromStorage(raw, Date.now());
          if (state.active) active = { ...state, returnUrl: `${new URL(tab.url).origin}/focus` };
        }
        finish();
      };
      if (task && typeof task.then === "function") task.then(apply).catch(finish);
      else finish();
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("blockedSites", stored => {
    if (!Array.isArray(stored.blockedSites)) chrome.storage.local.set({ blockedSites: globalThis.ZotBlockGuard.DEFAULT_SITES });
  });
  watchOpenTabs();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "zotblock-timer" || !isAppSender(sender) || !message.state) return;
  saveTimer(message.state);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") inject({ id: tabId, url: tab?.url || info.url || "" }, globalThis.ZotBlockGuard.DEFAULT_SITES);
});

watchOpenTabs();
pullTimers();
setInterval(pullTimers, 1000);
