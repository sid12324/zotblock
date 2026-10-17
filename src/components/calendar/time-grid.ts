import { Temporal } from "@js-temporal/polyfill";
import type { CalendarDisplayEvent } from "@/lib/calendar/events";

export const MINUTES_PER_DAY = 1440;
export const HOUR_HEIGHT = 64;

export type CalendarNow = { date: string; minutes: number; label: string; epochMilliseconds: number };
export type TimedEventPlacement = {
  event: CalendarDisplayEvent;
  key: string;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  laneCount: number;
  clockChange: boolean;
};

/** The marker uses the same IANA timezone as the source-event adapter. */
export function calendarNow(timeZone: string, instant: Temporal.Instant = Temporal.Now.instant()): CalendarNow {
  const local = instant.toZonedDateTimeISO(timeZone);
  return {
    date: local.toPlainDate().toString(),
    minutes: local.hour * 60 + local.minute + local.second / 60,
    label: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant.epochMilliseconds),
    epochMilliseconds: instant.epochMilliseconds,
  };
}

export function eventIsOngoing(event: CalendarDisplayEvent, now: CalendarNow) {
  if (!event.start || !event.end || event.allDay || event.kind === "due") return false;
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return start <= now.epochMilliseconds && now.epochMilliseconds < end;
}

/** A clock-change event is split rather than drawn over a skipped/repeated hour. */
function clockRanges(event: CalendarDisplayEvent, timeZone: string) {
  if (event.allDay || event.kind === "due" || event.startMinutes === null) return [];
  if (event.start && event.end) {
    let cursor = Temporal.Instant.from(event.start);
    const end = Temporal.Instant.from(event.end);
    const ranges: { startMinutes: number; endMinutes: number }[] = [];
    while (Temporal.Instant.compare(cursor, end) < 0) {
      const local = cursor.toZonedDateTimeISO(timeZone);
      const transition = local.getTimeZoneTransition("next")?.toInstant();
      const finish = transition && Temporal.Instant.compare(transition, end) < 0 ? transition : end;
      const startMinutes = local.hour * 60 + local.minute + local.second / 60;
      const elapsed = (finish.epochMilliseconds - cursor.epochMilliseconds) / 60_000;
      ranges.push({ startMinutes, endMinutes: Math.min(MINUTES_PER_DAY, startMinutes + elapsed) });
      cursor = finish;
    }
    return ranges;
  }
  const startMinutes = Math.max(0, event.startMinutes);
  const endMinutes = Math.min(MINUTES_PER_DAY, event.endMinutes ?? startMinutes + (event.durationMinutes ?? 0));
  return Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && endMinutes > startMinutes ? [{ startMinutes, endMinutes }] : [];
}

/** Interval groups share horizontal lanes; no collision changes an event's time. */
export function layoutTimedEvents(events: CalendarDisplayEvent[], timeZone: string): TimedEventPlacement[] {
  const pending = events.flatMap(event => {
    const ranges = clockRanges(event, timeZone);
    return ranges.map((range, index) => ({ event, key: `${event.id}:${index}`, ...range, lane: 0, laneCount: 1, clockChange: ranges.length > 1 }));
  }).sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.key.localeCompare(b.key));
  const placed: TimedEventPlacement[] = [];
  let group: TimedEventPlacement[] = [];
  let groupEnd = -1;
  let laneEnds: number[] = [];
  function finishGroup() {
    for (const event of group) placed.push({ ...event, laneCount: laneEnds.length });
    group = [];
    laneEnds = [];
  }
  for (const item of pending) {
    if (item.startMinutes >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex(end => end <= item.startMinutes);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endMinutes;
    group.push({ ...item, lane });
    groupEnd = Math.max(group.length === 1 ? -1 : groupEnd, item.endMinutes);
  }
  finishGroup();
  return placed;
}
