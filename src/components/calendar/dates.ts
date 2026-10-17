// Calendar date navigation adapted from Sid's zotblock calendar.
export type CalendarView = "month" | "week" | "day";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
export function addDays(date: Date, count: number) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
export function parseISODate(iso: string) { const [year, month, day] = iso.split("-").map(Number); return new Date(year, month - 1, day); }
export function formatISO(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function sameDay(a: Date, b: Date) { return formatISO(a) === formatISO(b); }
export function startOfWeek(date: Date) { const next = startOfDay(date); const weekday = next.getDay(); next.setDate(next.getDate() + (weekday === 0 ? -6 : 1 - weekday)); return next; }
export function monthWeeks(year: number, month: number) {
  const cursor = startOfWeek(new Date(year, month, 1));
  const last = startOfDay(new Date(year, month + 1, 0));
  const weeks: Date[][] = [];
  while (weeks.length < 6) {
    const week = Array.from({ length: 7 }, () => { const date = new Date(cursor); cursor.setDate(cursor.getDate() + 1); return date; });
    weeks.push(week);
    if (week[6] >= last) break;
  }
  return weeks;
}
export function weekDays(date: Date) { const start = startOfWeek(date); return Array.from({ length: 7 }, (_, index) => addDays(start, index)); }
export function monthName(date: Date) { return date.toLocaleDateString("en-US", { month: "long" }); }
export function weekTitle(date: Date) {
  const start = startOfWeek(date); const end = addDays(start, 6);
  return start.getMonth() === end.getMonth()
    ? { primary: `${start.getDate()}–${end.getDate()}`, secondary: `${monthName(start)} ${start.getFullYear()}` }
    : { primary: `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}`, secondary: `${end.toLocaleDateString("en-US", { month: "short" })} ${end.getDate()}, ${end.getFullYear()}` };
}
export function dayTitle(date: Date) { return { primary: String(date.getDate()), secondary: date.toLocaleDateString("en-US", { weekday: "long", month: "long", year: "numeric" }) }; }
export function shiftCursor(date: Date, view: CalendarView, direction: number) { const next = new Date(date); if (view === "month") next.setMonth(next.getMonth() + direction, 1); else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1)); return next; }
