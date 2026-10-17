import { Temporal } from "@js-temporal/polyfill";
import { assignmentDetailFields, assignmentDetailLabels, assignmentDetailValues } from "@/lib/assignment-edits";
import type { CalendarDisplayEvent } from "./events";

const MAX_LINK_LENGTH = 8_000;
const SHORTENED_NOTICE = "\n\n[Details shortened for Google Calendar. Open the source for full instructions.]";

function safeUrl(value?: string | null) {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function googleCalendarEventDescription(event: CalendarDisplayEvent, timeZone: string) {
  const assignment = event.assignment;
  const source = safeUrl(event.htmlUrl);
  const facts = { ...assignmentDetailValues(assignment?.details ?? event.assignmentDetails, timeZone), ...assignment?.userEdits?.details };
  const lines = source ? [`Source: ${source}`, "Created with ZotBlock."] : ["Created with ZotBlock."];
  const course = [...new Set([event.courseCode, event.courseName].filter(Boolean))].join(" · ");
  if (course) lines.push(`Course: ${course}`);
  if (event.dueAt) lines.push(`Deadline: ${new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full", timeStyle: "short" }).format(Temporal.Instant.from(event.dueAt).epochMilliseconds)} (${timeZone})`);
  if (event.kind === "due") lines.push("15-minute deadline reminder.");
  const instructions = assignment?.userEdits?.description ?? assignment?.description ?? event.description;
  if (instructions) lines.push(`\nInstructions:\n${instructions}`);
  const details = assignmentDetailFields.flatMap(field => facts[field] !== undefined ? [`${assignmentDetailLabels[field]}: ${facts[field]}`] : []);
  if (details.length) lines.push(`\nAssignment details:\n${details.join("\n")}`);
  return lines.join("\n");
}

/** Google's documented prefilled event form; users choose the destination calendar and save. */
export function googleCalendarExportUrl(event: CalendarDisplayEvent, timeZone: string): string | null {
  if (event.sourceProvider === "google-calendar" || !["study", "due"].includes(event.kind)) return null;
  try {
    // Validate the supplied zone, then retain exact instants across offsets and DST changes.
    new Intl.DateTimeFormat("en-US", { timeZone });
    const start = Temporal.Instant.from(event.kind === "due" ? event.dueAt! : event.exportStart ?? event.start!);
    const end = event.kind === "due" ? start.add({ minutes: 15 }) : Temporal.Instant.from(event.exportEnd ?? event.end!);
    if (Temporal.Instant.compare(start, end) >= 0) return null;
    const stamp = (instant: Temporal.Instant) => instant.toString({ fractionalSecondDigits: 0 }).replace(/[-:]/g, "");
    const url = new URL("https://calendar.google.com/calendar/r/eventedit");
    url.search = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${stamp(start)}/${stamp(end)}`, stz: timeZone, etz: timeZone }).toString();
    const details = googleCalendarEventDescription(event, timeZone);
    url.searchParams.set("details", details);
    if (url.href.length <= MAX_LINK_LENGTH) return url.href;
    // Long Canvas instructions must not produce a link that Google rejects. Keep the source near the top.
    const characters = Array.from(details);
    let low = 0, high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      url.searchParams.set("details", characters.slice(0, middle).join("") + SHORTENED_NOTICE);
      if (url.href.length <= MAX_LINK_LENGTH) low = middle;
      else high = middle - 1;
    }
    url.searchParams.set("details", characters.slice(0, low).join("") + SHORTENED_NOTICE);
    return url.href.length <= MAX_LINK_LENGTH ? url.href : null;
  } catch { return null; }
}
