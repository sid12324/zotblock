if (globalThis.__zotblockGuardInstalled || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  /* ZotBlock stays usable while the timer is running. */
} else {
globalThis.__zotblockGuardInstalled = true;
const HOST_ID = "zotblock-focus-guard-host";
let timer = { active: false, endsAt: null, title: "", returnUrl: "http://localhost:3000/focus" };
let blockedSites = globalThis.ZotBlockGuard.DEFAULT_SITES;

function remaining() {
  return timer.active && typeof timer.endsAt === "number" ? timer.endsAt - Date.now() : 0;
}

function shouldCover() {
  return remaining() > 0 && globalThis.ZotBlockGuard.hostIsBlocked(location.hostname, blockedSites);
}

function paint() {
  const existing = document.getElementById(HOST_ID);
  if (!shouldCover()) {
    existing?.remove();
    return;
  }
  if (existing && !existing.shadowRoot) existing.remove();
  const parent = document.documentElement || document.body;
  if (!parent) return;
  const host = existing?.shadowRoot ? existing : null;
  const root = host || document.createElement("div");
  if (!host) {
    root.id = HOST_ID;
    root.style.setProperty("position", "fixed", "important");
    root.style.setProperty("inset", "0", "important");
    root.style.setProperty("z-index", "2147483647", "important");
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      .cover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(16, 32, 58, 0.72); color: #19345c; font-family: "DM Sans", "Segoe UI", sans-serif; }
      .card { width: min(460px, 100%); padding: 28px 26px 24px; border-radius: 22px; background: rgba(255, 255, 255, 0.96); text-align: center; box-shadow: 0 18px 50px rgba(16, 32, 58, 0.28); }
      .brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 14px; }
      img { width: 72px; height: auto; }
      .wordmark { font-size: 28px; font-weight: 800; letter-spacing: -1px; color: #19345c; }
      .bubble { margin: 0 auto 12px; max-width: 340px; font-size: 26px; font-weight: 750; letter-spacing: -0.5px; color: #19345c; }
      p { margin: 0; color: #5d6d86; font-size: 15px; line-height: 1.6; }
      .time { margin-top: 12px; font-variant-numeric: tabular-nums; font-size: 28px; font-weight: 750; letter-spacing: -1px; color: #254c83; }
      a { display: inline-flex; align-items: center; justify-content: center; margin-top: 18px; min-height: 42px; padding: 0 16px; border-radius: 11px; background: #254c83; color: #fff; text-decoration: none; font-size: 14px; font-weight: 700; }
      @media (prefers-reduced-motion: no-preference) {
        img { animation: nod 1.6s ease-in-out infinite; }
        @keyframes nod { 50% { transform: rotate(-6deg); } }
      }
    </style>
    <div class="cover" role="dialog" aria-modal="true" aria-labelledby="zotblock-guard-title">
      <div class="card">
        <div class="brand"><img alt="" /><span class="wordmark">ZotBlock</span></div>
        <p class="bubble" id="zotblock-guard-title">Nope. Not this tab.</p>
        <p class="detail"></p>
        <p class="time"></p>
        <a>Back to your study block</a>
      </div>
    </div>`;
    parent.appendChild(root);
  }
  const shadow = root.shadowRoot;
  const image = shadow.querySelector("img");
  image.src = chrome.runtime.getURL("anteater.png");
  const title = timer.title ? `Finish “${timer.title}” first.` : "Your focus timer is still running.";
  shadow.querySelector(".detail").textContent = title;
  shadow.querySelector(".time").textContent = globalThis.ZotBlockGuard.clock(remaining());
  const link = shadow.querySelector("a");
  link.href = timer.returnUrl || "http://localhost:3000/focus";
}

function load() {
  chrome.storage.local.get(["timer", "blockedSites"], stored => {
    if (stored.timer) timer = stored.timer;
    if (Array.isArray(stored.blockedSites)) blockedSites = stored.blockedSites;
    paint();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.timer) timer = changes.timer.newValue || { active: false };
  if (changes.blockedSites) blockedSites = changes.blockedSites.newValue || [];
  paint();
});

load();
setInterval(load, 1000);
}
