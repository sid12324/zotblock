import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useMemo, useState } from "react";
import { calendarNow } from "./time-grid";

export function useCalendarClock(timeZone: string) {
  const [epochMilliseconds, setEpochMilliseconds] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      setEpochMilliseconds(Date.now());
      timer = setTimeout(tick, 60_000 - Date.now() % 60_000);
    }
    function onVisibilityChange() { if (!document.hidden) { clearTimeout(timer); tick(); } }
    timer = setTimeout(tick, 60_000 - Date.now() % 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, []);
  // Store the instant, so a changed plan timezone takes effect before the next tick.
  return useMemo(() => calendarNow(timeZone, Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)), [timeZone, epochMilliseconds]);
}
