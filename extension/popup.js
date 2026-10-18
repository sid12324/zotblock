const status = document.querySelector("#status");
const list = document.querySelector("#sites");
const form = document.querySelector("#add-site");
const input = document.querySelector("#site");
const error = document.querySelector("#site-error");

function render(stored) {
  const timer = stored.timer;
  const left = timer?.active && timer.endsAt > Date.now() ? timer.endsAt - Date.now() : 0;
  status.textContent = left > 0 ? `Covering sites for ${ZotBlockGuard.clock(left)}${timer.title ? ` · ${timer.title}` : ""}` : "No focus timer is running.";
  const sites = Array.isArray(stored.blockedSites) ? stored.blockedSites : [];
  list.replaceChildren(...sites.map(site => {
    const item = document.createElement("li");
    item.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => chrome.storage.local.set({ blockedSites: sites.filter(entry => entry !== site) }));
    item.append(remove);
    return item;
  }));
}

function refresh() { chrome.storage.local.get(["timer", "blockedSites"], render); }

form.addEventListener("submit", event => {
  event.preventDefault();
  const site = ZotBlockGuard.normalizeSite(input.value);
  if (!site) { error.textContent = "Enter a site like youtube.com."; return; }
  chrome.storage.local.get("blockedSites", stored => {
    const sites = Array.isArray(stored.blockedSites) ? stored.blockedSites : [];
    if (!sites.includes(site)) chrome.storage.local.set({ blockedSites: [...sites, site].sort() });
    input.value = "";
    error.textContent = "";
  });
});

chrome.storage.onChanged.addListener(refresh);
refresh();
setInterval(refresh, 1000);
