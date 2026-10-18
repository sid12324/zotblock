import { Temporal } from "@js-temporal/polyfill";
import { studyBlockCompletionKey } from "@/lib/completed-blocks";
import type { Assignment, AssignmentDetails, ProviderId, StudyPlan, StudyTask } from "@/lib/types";

export type CalendarDisplayEvent = {
  id: string;
  kind: "study" | "class" | "due";
  completionKey?: string;
  title: string;
  shortLabel: string;
  date: string;
  timeLabel: string;
  startMinutes: number | null;
  endMinutes?: number | null;
  allDay: boolean;
  durationMinutes: number | null;
  courseCode: string;
  courseName: string;
  estimate: string;
  estimateNote: string;
  description: string;
  assignmentDetails?: AssignmentDetails;
  assignment?: Assignment;
  summary: string;
  sourceProvider: ProviderId;
  sourceLabel: string;
  htmlUrl?: string;
  start?: string;
  end?: string;
  exportStart?: string;
  exportEnd?: string;
  dueAt?: string;
  resources: { icon: "book" | "document" | "clock"; title: string; detail: string; href?: string }[];
  priority?: StudyTask["priority"];
};

type Work = {
  provider: "gmail" | "canvas";
  id: string;
  title: string;
  dueAt: string;
  course: string;
  url?: string;
  description: string;
  details?: AssignmentDetails;
  assignment?: Assignment;
  scheduledMinutes: number;
  remainingMinutes: number;
  estimatedMinutes?: number;
  priority?: StudyTask["priority"];
};

function safeUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* An invalid source URL is displayed as plain text only. */ }
  return undefined;
}

function workKey(provider: Work["provider"], id: string, title: string, dueAt: string) {
  return provider === "canvas" ? `canvas:${id}` : `gmail:${id}:${Temporal.Instant.from(dueAt).toString()}:${title.trim().toLowerCase()}`;
}

function minutes(start: string, end: string) {
  const duration = (Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds) / 60_000;
  if (duration <= 0) throw new Error("A calendar item has an invalid time range.");
  return duration;
}

function estimateLabel(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function clock(value: Temporal.Instant, timeZone: string, showZone = false) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true, ...(showZone ? { timeZoneName: "short" as const } : {}) }).format(value.epochMilliseconds).replace(/\u202f/g, " ").toLowerCase();
}

function deadlineLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(Temporal.Instant.from(value).epochMilliseconds);
}

function sourceResources(work: Work): CalendarDisplayEvent["resources"] {
  const resources: CalendarDisplayEvent["resources"] = [];
  if (work.url) resources.push({ icon: work.provider === "canvas" ? "book" : "document", title: work.provider === "canvas" ? "Canvas assignment" : "Source email", detail: work.title, href: work.url });
  for (const attachment of work.details?.attachments || []) {
    const href = safeUrl(attachment.url);
    if (href) resources.push({ icon: "document", title: attachment.title || "Attachment", detail: "Canvas attachment", href });
  }
  return resources;
}

function assignmentDetails(details?: AssignmentDetails): AssignmentDetails | undefined {
  if (!details) return undefined;
  return {
    ...details,
    ...(details.attachments ? { attachments: details.attachments.flatMap(attachment => {
      const url = safeUrl(attachment.url);
      return url ? [{ ...attachment, url }] : [];
    }) } : {}),
  };
}

function timeOfDay(value: Temporal.ZonedDateTime) {
  return value.hour * 60 + value.minute + value.second / 60 + value.millisecond / 60_000;
}

/** Segment instants at local midnights, whose spacing can be 23 or 25 hours at DST. */
function intervalDays(start: string, end: string, timeZone: string, range?: { start: Temporal.Instant; end: Temporal.Instant }) {
  let cursor = Temporal.Instant.from(start);
  let finish = Temporal.Instant.from(end);
  if (Temporal.Instant.compare(cursor, finish) >= 0) throw new Error("A calendar item has an invalid time range.");
  if (range) {
    if (Temporal.Instant.compare(cursor, range.start) < 0) cursor = range.start;
    if (Temporal.Instant.compare(finish, range.end) > 0) finish = range.end;
  }
  const days: { date: string; start: string; end: string; durationMinutes: number; startMinutes: number; endMinutes: number; timeLabel: string }[] = [];
  while (Temporal.Instant.compare(cursor, finish) < 0) {
    const localStart = cursor.toZonedDateTimeISO(timeZone);
    const date = localStart.toPlainDate();
    const midnight = date.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: "00:00" }).toInstant();
    const segmentEnd = Temporal.Instant.compare(midnight, finish) < 0 ? midnight : finish;
    const localEnd = segmentEnd.toZonedDateTimeISO(timeZone);
    const showZone = localStart.offset !== localEnd.offset;
    days.push({ date: date.toString(), start: cursor.toString(), end: segmentEnd.toString(), durationMinutes: minutes(cursor.toString(), segmentEnd.toString()), startMinutes: timeOfDay(localStart), endMinutes: localEnd.toPlainDate().equals(date) ? timeOfDay(localEnd) : 1440, timeLabel: `${clock(cursor, timeZone, showZone)}–${clock(segmentEnd, timeZone, showZone)}` });
    cursor = segmentEnd;
  }
  return days;
}

/** Render only information present in the generated plan and its connected source data. */
export function calendarEventsFromPlan(plan: StudyPlan): CalendarDisplayEvent[] {
  const works = new Map<string, Work>();
  const emailById = new Map(plan.sourceData.emails.map(email => [email.id, email]));
  for (const assignment of plan.sourceData.assignments) {
    works.set(workKey("canvas", assignment.id, assignment.title, assignment.dueAt), { provider: "canvas", id: assignment.id, title: assignment.title, dueAt: assignment.dueAt, course: assignment.course, url: safeUrl(assignment.url), description: assignment.userEdits?.description ?? (assignment.description || "No Canvas description was provided."), details: assignmentDetails(assignment.details), assignment, scheduledMinutes: 0, remainingMinutes: 0 });
  }
  for (const { task, remainingMinutes } of plan.unscheduledTasks) {
    const key = workKey(task.source, task.sourceId, task.title, task.dueAt);
    const email = task.source === "gmail" ? emailById.get(task.sourceId) : undefined;
    const previous = works.get(key);
    works.set(key, { provider: task.source, id: task.sourceId, title: task.title, dueAt: task.dueAt, course: task.course, url: safeUrl(task.url) || safeUrl(email?.url), description: email ? `Source email: ${email.subject}` : "No source description was provided.", scheduledMinutes: 0, ...previous, estimatedMinutes: task.estimatedMinutes, remainingMinutes, priority: task.priority });
  }
  for (const block of plan.studyBlocks) {
    const source = block.source;
    const key = workKey(source.provider, source.id, source.title, source.dueAt);
    let work = works.get(key);
    if (!work) {
      const email = source.provider === "gmail" ? emailById.get(source.id) : undefined;
      work = { provider: source.provider, id: source.id, title: source.title, dueAt: source.dueAt, course: "", url: safeUrl(source.url) || safeUrl(email?.url), description: email ? `Source email: ${email.subject}` : "No source description was provided.", scheduledMinutes: 0, remainingMinutes: 0, priority: block.priority };
      works.set(key, work);
    }
    work.scheduledMinutes += minutes(block.start.dateTime, block.end.dateTime);
    work.priority ||= block.priority;
  }

  const events: CalendarDisplayEvent[] = [];
  for (const block of plan.studyBlocks) {
    const work = works.get(workKey(block.source.provider, block.source.id, block.source.title, block.source.dueAt))!;
    for (const segment of intervalDays(block.start.dateTime, block.end.dateTime, plan.timeZone)) {
      events.push({ ...segment, id: `study:${encodeURIComponent(block.id)}:${segment.date}`, completionKey: studyBlockCompletionKey(block), kind: "study", exportStart: block.start.dateTime, exportEnd: block.end.dateTime, title: block.summary, shortLabel: block.summary, allDay: false, courseCode: "", courseName: work.course, estimate: estimateLabel(segment.durationMinutes), estimateNote: "hours · scheduled study duration", description: work.provider === "canvas" ? work.description : block.description || work.description, assignmentDetails: work.details, assignment: work.assignment, summary: `Scheduled study time for ${work.title}. Deadline: ${deadlineLabel(work.dueAt, plan.timeZone)}.`, sourceProvider: work.provider, sourceLabel: work.provider === "canvas" ? "Canvas" : "Gmail", htmlUrl: work.url, dueAt: work.dueAt, resources: sourceResources(work), priority: block.priority });
    }
  }

  const range = { start: Temporal.Instant.from(plan.window.start).toZonedDateTimeISO(plan.timeZone).startOfDay().toInstant(), end: Temporal.Instant.from(plan.window.end) };
  for (const event of plan.sourceData.calendarEvents) {
    for (const segment of intervalDays(event.start, event.end, plan.timeZone, range)) {
      events.push({ ...segment, id: `google-calendar:${encodeURIComponent(event.id)}:${segment.date}`, kind: "class", title: event.summary, shortLabel: event.summary, allDay: Boolean(event.allDay), startMinutes: event.allDay ? null : segment.startMinutes, endMinutes: event.allDay ? null : segment.endMinutes, timeLabel: event.allDay ? "All day" : segment.timeLabel, courseCode: "", courseName: "", estimate: estimateLabel(segment.durationMinutes), estimateNote: "hours · calendar event duration", description: "Busy time from your primary Google Calendar.", summary: "This Google Calendar event is treated as busy time when scheduling study blocks.", sourceProvider: "google-calendar", sourceLabel: "Google Calendar", resources: [] });
    }
  }

  for (const work of works.values()) {
    const dueAt = Temporal.Instant.from(work.dueAt);
    const planned = work.scheduledMinutes + work.remainingMinutes;
    const estimate = work.estimatedMinutes ?? (planned > 0 ? planned : null);
    const progress = work.scheduledMinutes || work.remainingMinutes ? ` ${work.scheduledMinutes} minutes scheduled${work.remainingMinutes ? `; ${work.remainingMinutes} minutes remain unscheduled` : ""}.` : "";
    events.push({ id: `due:${work.provider}:${encodeURIComponent(work.id)}${work.provider === "gmail" ? `:${encodeURIComponent(dueAt.toString())}:${encodeURIComponent(work.title.trim().toLowerCase())}` : ""}`, kind: "due", title: work.title, shortLabel: `${work.title} · due`, date: dueAt.toZonedDateTimeISO(plan.timeZone).toPlainDate().toString(), timeLabel: clock(dueAt, plan.timeZone), startMinutes: null, endMinutes: null, allDay: false, durationMinutes: null, courseCode: "", courseName: work.course, estimate: estimateLabel(estimate), estimateNote: estimate === null ? "No study estimate available" : "hours · planned study effort", description: work.description, assignmentDetails: work.details, assignment: work.assignment, summary: `${work.provider === "canvas" ? "Canvas assignment" : "Task from Gmail"} deadline.${progress}`, sourceProvider: work.provider, sourceLabel: work.provider === "canvas" ? "Canvas" : "Gmail", htmlUrl: work.url, dueAt: work.dueAt, resources: sourceResources(work), priority: work.priority });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startMinutes ?? 1440) - (b.startMinutes ?? 1440) || a.id.localeCompare(b.id));
}
