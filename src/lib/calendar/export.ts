import { Temporal } from "@js-temporal/polyfill";
import type { IntegrationErrorCode } from "@/lib/integrations/http";
import type { StudyPlan } from "@/lib/types";
import { calendarEventsFromPlan } from "./events";
import { googleCalendarEventDescription } from "./google-export";

export type CalendarExportScope = "all" | "selected";
export type CalendarExportItem = {
  key: string;
  displayIds: string[];
  kind: "study" | "due";
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  sourceUrl?: string;
};
export type CalendarExportResult = {
  total: number;
  created: number;
  existing: number;
  failed: number;
  pending: number;
  failures: { title: string; message: string; code?: IntegrationErrorCode; actionUrl?: string }[];
  calendarUrl: string;
};

/** Export the entire plan, independently of the calendar's current view or date. */
export function calendarExportItems(plan: StudyPlan): CalendarExportItem[] {
  const items = new Map<string, CalendarExportItem>();
  const blocks = new Map(plan.studyBlocks.map(block => [encodeURIComponent(block.id), block]));
  for (const event of calendarEventsFromPlan(plan)) {
    // These events are already in the destination calendar.
    if (event.kind === "class" || event.sourceProvider === "google-calendar") continue;
    const start = Temporal.Instant.from(event.kind === "due" ? event.dueAt! : event.exportStart!);
    const end = event.kind === "due" ? start.add({ minutes: 15 }) : Temporal.Instant.from(event.exportEnd!);
    const block = event.kind === "study" ? blocks.get(event.id.split(":")[1]) : undefined;
    if (event.kind === "study" && !block) throw new Error("A study block could not be matched to its source.");
    const source = block?.source;
    const origin = event.sourceProvider === "canvas" && event.htmlUrl ? new URL(event.htmlUrl).origin : "";
    const identity = source
      ? [source.provider, source.id, ...(source.provider === "gmail" ? [source.title.trim().toLowerCase(), Temporal.Instant.from(source.dueAt).toString()] : [])]
      : [event.id];
    // The scheduler's block IDs can change across generations. The source and full interval
    // remain stable; both midnight display segments must refer to the same exported event.
    const key = JSON.stringify(["zotblock-v1", plan.mode, event.kind, origin, identity, start.toString(), end.toString()]);
    const previous = items.get(key);
    if (previous) { previous.displayIds.push(event.id); continue; }
    items.set(key, {
      key, displayIds: [event.id], kind: event.kind,
      summary: event.kind === "due" ? `${event.title} · due` : event.title,
      description: googleCalendarEventDescription(event, plan.timeZone),
      start: { dateTime: start.toString(), timeZone: plan.timeZone },
      end: { dateTime: end.toString(), timeZone: plan.timeZone },
      ...(event.htmlUrl ? { sourceUrl: event.htmlUrl } : {}),
    });
  }
  return [...items.values()];
}

export function selectCalendarExportItems(plan: StudyPlan, scope: CalendarExportScope, selectedId?: string): CalendarExportItem[] {
  const items = calendarExportItems(plan);
  return scope === "all" ? items : items.filter(item => selectedId !== undefined && item.displayIds.includes(selectedId));
}
