import { Temporal } from "@js-temporal/polyfill";
import type { StudyPreferences } from "@/lib/types";

export function planningWindow(preferences: StudyPreferences, now: string) {
  const start = Temporal.Instant.from(now);
  const end = start.toZonedDateTimeISO(preferences.timeZone)
    .startOfDay().add({ days: preferences.days }).toInstant();
  return { start: start.toString(), end: end.toString() };
}

export function localDateTime(now: string, timeZone: string, days: number, hour: number) {
  return Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).startOfDay()
    .add({ days }).with({ hour }).toInstant().toString();
}
