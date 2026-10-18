"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, CalendarIcon } from "@/components/icons";
import { assignmentDetailFields, assignmentDetailLabels, assignmentDetailValues } from "@/lib/assignment-edits";
import type { CalendarDisplayEvent } from "@/lib/calendar/events";
import { googleCalendarExportUrl } from "@/lib/calendar/google-export";
import type { AssignmentDetails, AssignmentEdits } from "@/lib/types";
import { AssignmentEditor } from "./assignment-editor";
import { GoogleCalendarExport, type GoogleCalendarExportController } from "./google-calendar-export";
import { parseISODate } from "./dates";

function sourceName(event: CalendarDisplayEvent) { return event.sourceProvider === "canvas" ? "Canvas" : event.sourceProvider === "gmail" ? "Gmail" : "Google Calendar"; }
function sourceUrl(value: string | undefined | null) { try { const url = new URL(value || ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function dateLabel(value: string | null, timeZone: string) {
  if (value === null) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

function AssignmentInformation({ details, edits, timeZone }: { details?: AssignmentDetails; edits?: AssignmentEdits; timeZone: string }) {
  const values = { ...assignmentDetailValues(details, timeZone), ...edits?.details };
  const fields = assignmentDetailFields.filter(field => values[field] !== undefined);
  return fields.length > 0 && <section aria-labelledby="assignment-details-heading"><h3 className="label" id="assignment-details-heading">Assignment details{edits && " · Locally edited"}</h3><dl className="assignment-facts">{fields.map(field => <div key={field}><dt>{assignmentDetailLabels[field]}</dt><dd>{values[field] || "—"}</dd></div>)}</dl></section>;
}

function AssignmentAttachments({ details }: { details?: AssignmentDetails }) {
  const attachments = (details?.attachments || []).flatMap(attachment => {
    const url = sourceUrl(attachment.url);
    return url ? [{ title: attachment.title || "Attachment", url }] : [];
  });
  return attachments.length > 0 && <section aria-labelledby="assignment-attachments-heading"><h3 className="label" id="assignment-attachments-heading">Attachments</h3><ul className="assignment-attachments">{attachments.map((attachment, index) => <li key={`${attachment.url}:${index}`}><a href={attachment.url} target="_blank" rel="noopener noreferrer">{attachment.title}<span aria-hidden="true">↗</span></a></li>)}</ul></section>;
}

export function DetailPanel({ event, timeZone, onClose, onSaveAssignment, editsNotice, calendarExport, focusAction, completed = false, onToggleComplete }: { event: CalendarDisplayEvent; timeZone: string; onClose: () => void; onSaveAssignment?: (edits: AssignmentEdits | null) => void; editsNotice?: string | null; calendarExport?: GoogleCalendarExportController; focusAction?: ReactNode; completed?: boolean; onToggleComplete?: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const url = sourceUrl(event.htmlUrl);
  const exportUrl = !calendarExport && event.sourceProvider !== "google-calendar" && (event.kind === "study" || event.kind === "due") ? googleCalendarExportUrl(event, timeZone) : null;
  const course = [...new Set([event.courseCode, event.courseName].filter(Boolean))].join(" · ");
  const date = parseISODate(event.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const duration = event.durationMinutes === null ? null : Math.round(event.durationMinutes);
  const deadline = event.kind === "study" && event.dueAt ? dateLabel(event.dueAt, timeZone) : null;
  const assignment = event.assignment;
  const description = assignment?.userEdits?.description ?? assignment?.description ?? event.description;
  const details = assignment?.details ?? event.assignmentDetails;
  useEffect(() => { panelRef.current?.focus(); }, [event.id]);
  return <aside className="panel" aria-labelledby="calendar-event-title" ref={panelRef} tabIndex={-1}>
    <div className="panel-head"><span>{event.kind === "study" ? completed ? "STUDY BLOCK · DONE" : "STUDY BLOCK" : event.kind === "due" ? "DEADLINE" : "CALENDAR EVENT"}</span><button type="button" aria-label="Close event details" onClick={onClose}><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2L12 12M12 2L2 12"/></svg></button></div>
    <div className="panel-scroll">
      {course && <p className="course">{course}</p>}
      <p className="when">{event.kind === "due" ? "Due " : ""}{date}{event.timeLabel ? ` · ${event.timeLabel}` : " · All day"}</p>
      <p className="timezone">{timeZone.replaceAll("_", " ")}</p>
      <h2 id="calendar-event-title" className={completed ? "is-complete" : undefined}>{event.title}</h2>
      {event.kind === "study" && onToggleComplete && <button type="button" className={completed ? "complete-toggle is-complete" : "complete-toggle"} aria-pressed={completed} onClick={onToggleComplete}>{completed ? "Completed — mark as not done" : "Mark complete"}</button>}
      {typeof duration === "number" && duration > 0 ? <div className="estimate"><div className="estimate-bar"/><div><p className="label">Duration</p><p className="estimate-num">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}</p><p className="note">hours · {event.kind === "study" ? "scheduled study time" : "calendar event"}</p></div></div> : event.estimate && <div className="estimate"><div className="estimate-bar"/><div><p className="label">Estimated study time</p><p className="estimate-num">{event.estimate}</p><p className="note">{event.estimateNote}</p></div></div>}
      {focusAction}
      {assignment && onSaveAssignment ? <AssignmentEditor key={`${assignment.url ?? assignment.course}:${assignment.id}`} assignment={assignment} timeZone={timeZone} onSave={onSaveAssignment} notice={editsNotice}/> : <>
        <section><p className="label">{event.sourceProvider === "canvas" ? "Assignment instructions" : "Description"}</p><p className="prose">{description || (assignment?.userEdits?.description !== undefined ? "No instructions in this local copy." : "No description was provided for this event.")}</p></section>
        <AssignmentInformation details={details} edits={assignment?.userEdits} timeZone={timeZone}/>
        {editsNotice && <p className="assignment-editor-notice" role="status">{editsNotice}</p>}
      </>}
      {deadline && <section><p className="label">Coursework deadline</p><p className="prose">{deadline}</p></section>}
      <AssignmentAttachments details={details}/>
      <section><p className="label">Source</p><p className="prose">{event.id.startsWith("drop:") ? "A block you added on this calendar." : event.kind === "study" ? `Generated from your ${sourceName(event)} coursework and available calendar time.` : event.kind === "due" ? `An academic deadline from ${sourceName(event)}.` : "A read only event from your primary Google Calendar."}</p></section>
    </div>
    {(url || exportUrl || calendarExport) && <div className="panel-actions">
      {url && <a className="canvas-btn" href={url} target="_blank" rel="noopener noreferrer">Open in {sourceName(event)}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3L11 8L6 13"/></svg></a>}
      {calendarExport && <GoogleCalendarExport controller={calendarExport} selectedId={event.id}/>}
      {exportUrl && <><a className="google-calendar-export" href={exportUrl} target="_blank" rel="noopener noreferrer" aria-describedby="calendar-export-note"><span className="calendar-export-label"><CalendarIcon className="calendar-export-icon"/><span>Export to Google Calendar</span></span><ArrowRight className="calendar-export-arrow"/></a><p id="calendar-export-note" className="calendar-export-note">{event.kind === "due" ? "Creates a 15-minute deadline reminder. Review and save in Google Calendar." : "Opens Google Calendar. Review and save the event."}</p></>}
    </div>}
  </aside>;
}
