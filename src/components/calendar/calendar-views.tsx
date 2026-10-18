import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { CalendarDisplayEvent } from "@/lib/calendar/events";
import { paintLookup } from "@/lib/calendar/colors";
import { formatISO, monthWeeks, sameDay, WEEKDAYS, weekDays } from "./dates";
import { eventIsOngoing, HOUR_HEIGHT, layoutTimedEvents, MINUTES_PER_DAY, type CalendarNow } from "./time-grid";

type ViewProps = { cursor: Date; today: Date; events: CalendarDisplayEvent[]; selectedId: string | null; completedKeys: ReadonlySet<string>; onSelect: (id: string) => void };
const toneOf = (event: CalendarDisplayEvent) => event.tone || (event.kind === "study" ? "study" : event.kind === "due" ? "due" : "class");
const isCompleted = (event: CalendarDisplayEvent, completedKeys: ReadonlySet<string>) => Boolean(event.completionKey && completedKeys.has(event.completionKey));
const eventClass = (event: CalendarDisplayEvent, selectedId: string | null, completedKeys: ReadonlySet<string>) => `${event.kind} tone-${toneOf(event)} ${event.id === selectedId ? "selected" : ""} ${isCompleted(event, completedKeys) ? "completed" : ""}`;
const eventLabel = (event: CalendarDisplayEvent, completedKeys: ReadonlySet<string>) => `${event.title}${event.timeLabel ? `, ${event.timeLabel}` : ""}${isCompleted(event, completedKeys) ? ", completed" : ""}`;

export function MonthView({ cursor, today, events, selectedId, completedKeys, onSelect, onShowWeek, onShowDay }: ViewProps & { onShowWeek: (date: Date) => void; onShowDay: (date: Date) => void }) {
  const paint = useMemo(() => paintLookup(events), [events]);
  const weeks = monthWeeks(cursor.getFullYear(), cursor.getMonth());
  return <div className="month" aria-label="Month view"><div className="dow">{WEEKDAYS.map((label, index) => <span key={label} className={weeks.some(week => sameDay(week[index], today)) ? "is-today" : ""}>{label}</span>)}</div><div className="month-grid">{weeks.flat().map(date => {
    const iso = formatISO(date);
    const dayEvents = events.filter(event => event.date === iso);
    const shown = dayEvents.slice(0, 3);
    const extra = dayEvents.length - shown.length;
    return <div key={iso} className="day"><button type="button" className={`date-number ${sameDay(date, today) ? "today-num" : date.getMonth() !== cursor.getMonth() ? "outside" : ""}`} aria-label={`Show ${date.toLocaleDateString("en-US", { dateStyle: "full" })}`} onClick={() => onShowDay(date)}>{date.getDate()}</button>{shown.map(event => <button key={event.id} type="button" className={`chip ${eventClass(event, selectedId, completedKeys)}`} style={paint(event)} onClick={() => onSelect(event.id)} title={eventLabel(event, completedKeys)} aria-label={eventLabel(event, completedKeys)}><span>{event.shortLabel}</span></button>)}{extra > 0 && <button type="button" className="more" onClick={() => onShowWeek(date)} aria-label={`Show ${extra} more events in the week of ${iso}`}>+{extra} more</button>}</div>;
  })}</div></div>;
}

type TimeViewProps = ViewProps & { now: CalendarNow; timeZone: string };
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour % 24 < 12 ? "AM" : "PM"}`;

function TimeGrid({ days, today, events, selectedId, completedKeys, onSelect, now, timeZone }: Omit<TimeViewProps, "cursor"> & { days: Date[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastScrolledRange = useRef("");
  const dates = days.map(formatISO);
  const rangeKey = dates.join(":");
  const visible = days.map((date, index) => {
    const dayEvents = events.filter(event => event.date === dates[index]);
    return { date, iso: dates[index], rail: dayEvents.filter(event => event.allDay || event.kind === "due" || event.startMinutes === null), timed: layoutTimedEvents(dayEvents, timeZone) };
  });
  // Scroll once per displayed range; streamed blocks and minute ticks leave the user's position alone.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroll = root?.parentElement;
    const body = root?.querySelector<HTMLElement>(".time-grid-body");
    if (!root || !scroll || !body || lastScrolledRange.current === rangeKey) return;
    lastScrolledRange.current = rangeKey;
    const firstTime = Math.min(...events.filter(event => dates.includes(event.date) && !event.allDay && event.kind !== "due" && event.startMinutes !== null).map(event => event.startMinutes!));
    const target = dates.includes(now.date) ? now.minutes - 120 : Number.isFinite(firstTime) ? firstTime - 60 : 8 * 60;
    scroll.scrollTop = Math.max(0, target) / 60 * HOUR_HEIGHT;
  }, [rangeKey, dates, events, now]);
  const paint = useMemo(() => paintLookup(events), [events]);
  const gridStyle = { "--day-count": days.length, "--hour-height": `${HOUR_HEIGHT}px` } as CSSProperties;
  return <div ref={rootRef} className={`time-grid ${days.length === 1 ? "time-grid-day" : "time-grid-week"}`} style={gridStyle} aria-label={`${days.length === 1 ? "Day" : "Week"} view, ${timeZone}`}>
    <div className="time-grid-heading"><div className="time-grid-corner">TIME</div>{visible.map(({ date, iso }) => {
      const dots = events.filter(event => event.date === iso && event.kind !== "due").slice(0, 3);
      return <div key={iso} className={`time-grid-date ${sameDay(date, today) ? "is-today" : ""}`}><span>{WEEKDAYS[(date.getDay() + 6) % 7]}</span><strong className={sameDay(date, today) ? "today-block" : ""}>{date.getDate()}</strong>{dots.length > 0 && <span className="day-dots" aria-hidden="true">{dots.map(event => <i key={event.id} className={`day-dot tone-${toneOf(event)}`} style={paint(event)}/>)}</span>}</div>;
    })}</div>
    {visible.some(day => day.rail.length > 0) && <div className="time-grid-rail" role="group" aria-label="All-day events and deadlines"><div className="rail-label">DUE</div>{visible.map(({ iso, rail }) => <div key={iso} className="rail-day">{rail.length === 0 ? <span className="rail-empty" aria-label="No all-day events or deadlines">—</span> : rail.map(event => <button key={event.id} type="button" className={`rail-event ${eventClass(event, selectedId, completedKeys)}`} style={paint(event)} onClick={() => onSelect(event.id)} title={eventLabel(event, completedKeys)} aria-label={eventLabel(event, completedKeys)} aria-pressed={event.id === selectedId}><em>{event.kind === "due" ? `Due ${event.timeLabel}` : event.timeLabel || "All day"}</em><span>{event.shortLabel}</span></button>)}</div>)}</div>}
    <div className="time-grid-body"><div className="time-axis" aria-hidden="true">{Array.from({ length: 25 }, (_, hour) => <span key={hour} className="hour-label" style={{ top: `${hour / 24 * 100}%` }}>{hourLabel(hour)}</span>)}</div>{visible.map(({ iso, timed }) => <div key={iso} className={`time-day-track ${iso === now.date ? "is-today" : ""}`} aria-label={iso}>
      {timed.map(({ event, key, startMinutes, endMinutes, lane, laneCount, clockChange }) => {
        const ongoing = eventIsOngoing(event, now);
        const style = { ...paint(event), top: `${startMinutes / MINUTES_PER_DAY * 100}%`, height: `${(endMinutes - startMinutes) / MINUTES_PER_DAY * 100}%`, left: `calc(${lane / laneCount * 100}% + 3px)`, width: `calc(${100 / laneCount}% - 6px)` };
        return <button key={key} type="button" className={`time-event ${eventClass(event, selectedId, completedKeys)} ${endMinutes - startMinutes < 30 ? "compact" : ""} ${ongoing ? "ongoing" : ""}`} style={style} onClick={() => onSelect(event.id)} title={`${eventLabel(event, completedKeys)}${clockChange ? " · Clock changes during this event" : ""}`} aria-label={`${eventLabel(event, completedKeys)}${ongoing ? ", in progress" : ""}`} aria-pressed={event.id === selectedId}><em>{event.timeLabel}{ongoing ? " · Now" : ""}</em><strong>{event.shortLabel}</strong>{clockChange && <small>Clock change</small>}</button>;
      })}
      {iso === now.date && <div className="current-time-line" style={{ top: `${now.minutes / MINUTES_PER_DAY * 100}%` }} role="img" aria-label={`Current time: ${now.label}, ${timeZone}`}><span>{now.label}</span></div>}
    </div>)}</div>
  </div>;
}

export function WeekView({ cursor, ...props }: TimeViewProps) { return <TimeGrid {...props} days={weekDays(cursor)}/>; }
export function DayView({ cursor, ...props }: TimeViewProps) { return <TimeGrid {...props} days={[cursor]}/>; }
