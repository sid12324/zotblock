if (globalThis.__zotblockBridgeInstalled) {
  globalThis.__zotblockPublishTimer?.();
} else {
  globalThis.__zotblockBridgeInstalled = true;
  const TIMER_KEY = "zotblock-focus-timer-v1";
  let lastSent = "";

  function readTimer(now) {
    const stored = (() => {
      try { return globalThis.ZotBlockGuard.timerFromStorage(localStorage.getItem(TIMER_KEY), now); } catch { return { active: false, endsAt: null, title: "" }; }
    })();
    if (stored.active) return stored;
    try {
      const parsed = JSON.parse(document.documentElement?.dataset.zotblockFocus || "null");
      if (parsed?.active === true && typeof parsed.endsAt === "number" && parsed.endsAt > now) {
        return { active: true, endsAt: parsed.endsAt, title: String(parsed.title || "Study block").slice(0, 200) };
      }
    } catch { /* The page attribute is optional. The saved timer is enough. */ }
    return { active: false, endsAt: null, title: "" };
  }

  function publishTimer() {
    const state = { ...readTimer(Date.now()), returnUrl: `${location.origin}/focus` };
    const serialized = JSON.stringify(state);
    if (serialized === lastSent) return;
    chrome.runtime.sendMessage({ type: "zotblock-timer", state }, () => {
      if (!chrome.runtime.lastError) lastSent = serialized;
    });
  }

  globalThis.__zotblockPublishTimer = publishTimer;
  publishTimer();
  document.addEventListener("zotblock-focus-guard", publishTimer);
  window.addEventListener("storage", event => {
    if (event.key === TIMER_KEY || event.key === null) publishTimer();
  });
  setInterval(publishTimer, 1000);
}
