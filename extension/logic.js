globalThis.ZotBlockGuard = (() => {
  const DEFAULT_SITES = ["youtube.com", "youtu.be"];

  function normalizeSite(value) {
    let text = String(value || "").trim().toLowerCase();
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    text = text.split("/")[0].split("?")[0].split("#")[0].replace(/:\d+$/, "");
    text = text.replace(/^www\./, "").replace(/\.$/, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) || text.length > 253) return null;
    return text;
  }

  function hostIsBlocked(hostname, sites) {
    const host = String(hostname || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host === "127.0.0.1") return false;
    return (Array.isArray(sites) ? sites : []).some(site => {
      const normalized = normalizeSite(site);
      return Boolean(normalized && (host === normalized || host.endsWith(`.${normalized}`)));
    });
  }

  function timerFromStorage(raw, now) {
    try {
      const session = JSON.parse(raw || "null")?.session;
      const title = typeof session?.target?.title === "string" ? session.target.title.trim().slice(0, 200) : "";
      if (session?.status === "running" && typeof session.endsAt === "number" && session.endsAt > now) {
        return { active: true, endsAt: session.endsAt, title: title || "Study block" };
      }
    } catch { /* A damaged timer record leaves every other tab alone. */ }
    return { active: false, endsAt: null, title: "" };
  }

  function clock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  return { DEFAULT_SITES, normalizeSite, hostIsBlocked, timerFromStorage, clock };
})();

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.ZotBlockGuard;
