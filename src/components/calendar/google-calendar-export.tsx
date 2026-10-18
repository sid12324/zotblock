"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarIcon } from "@/components/icons";
import { calendarExportItems, type CalendarExportItem, type CalendarExportResult, type CalendarExportScope } from "@/lib/calendar/export";
import type { StudyPlan } from "@/lib/types";

export const calendarExportAuthorizationUrl = "/api/auth/google?provider=google-calendar&access=export&returnTo=calendar";
type ExportIssue = { message: string; code?: string; actionUrl?: string };
type ExportState = { planKey: string; scope: CalendarExportScope; selectedId?: string; running: boolean; result: CalendarExportResult | null; issue: ExportIssue | null };
const emptyState: ExportState = { planKey: "", scope: "all", running: false, result: null, issue: null };

export class CalendarExportRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly actionUrl?: string) { super(message); }
}

/** OAuth returns to a reviewable control; returning never starts a write request. */
export function calendarExportReturnMessage(search: string) {
  const query = new URLSearchParams(search);
  const error = query.get("error");
  if (error) return { message: error, failed: true };
  return query.get("calendarExport") === "ready" ? { message: "Google Calendar access is ready. Choose Export to add your events.", failed: false } : null;
}

function resultIsValid(value: unknown): value is CalendarExportResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["total", "created", "existing", "failed", "pending"].every(key => Number.isInteger(result[key]) && Number(result[key]) >= 0) && Array.isArray(result.failures) && result.failures.every(failure => failure && typeof failure.title === "string" && typeof failure.message === "string") && typeof result.calendarUrl === "string";
}

export async function requestCalendarExport(plan: StudyPlan, scope: CalendarExportScope, selectedId?: string, fetcher: typeof fetch = fetch): Promise<CalendarExportResult> {
  const response = await fetcher("/api/calendar/export", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, scope, ...(scope === "selected" ? { selectedId } : {}) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new CalendarExportRequestError(typeof result?.error === "string" ? result.error : "Calendar export could not finish. Please try again.", typeof result?.code === "string" ? result.code : undefined, typeof result?.actionUrl === "string" ? result.actionUrl : undefined);
  if (!resultIsValid(result)) throw new CalendarExportRequestError("The export result could not be read. Retry safely; events already added will be skipped.");
  return result;
}

export function calendarExportSummary(items: CalendarExportItem[]) {
  const study = items.filter(item => item.kind === "study").length;
  const due = items.length - study;
  return `${study} study ${study === 1 ? "block" : "blocks"} + ${due} deadline ${due === 1 ? "reminder" : "reminders"}`;
}

function safeActionUrl(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function useGoogleCalendarExport(plan: StudyPlan | null, disabledReason: string | null) {
  const [state, setState] = useState<ExportState>(emptyState);
  const [returnMessage] = useState(() => typeof window === "undefined" ? null : calendarExportReturnMessage(window.location.search));
  const submitting = useRef(false);
  const items = useMemo(() => plan ? calendarExportItems(plan) : [], [plan]);
  const planKey = plan ? `${plan.mode}:${plan.generatedAt}` : "";
  async function exportItems(scope: CalendarExportScope, selectedId?: string) {
    if (!plan || disabledReason || submitting.current) return;
    const chosen = scope === "all" ? items : items.filter(item => selectedId !== undefined && item.displayIds.includes(selectedId));
    if (!chosen.length) return;
    submitting.current = true;
    setState({ planKey, scope, selectedId, running: true, result: null, issue: null });
    try {
      const result = await requestCalendarExport(plan, scope, selectedId);
      setState({ planKey, scope, selectedId, running: false, result, issue: null });
    } catch (cause) {
      const issue: ExportIssue = cause instanceof CalendarExportRequestError ? { message: cause.message, code: cause.code, actionUrl: cause.actionUrl } : { message: "Calendar export could not finish. Retry safely; events already added will be skipped." };
      setState({ planKey, scope, selectedId, running: false, result: null, issue });
    } finally { submitting.current = false; }
  }
  return { items, disabledReason: disabledReason || (!plan ? "Generate a complete plan before exporting." : null), running: state.running, state: state.planKey === planKey ? state : { ...emptyState, running: state.running }, returnMessage, exportItems };
}

export type GoogleCalendarExportController = ReturnType<typeof useGoogleCalendarExport>;

export function GoogleCalendarExport({ controller, selectedId, compact = false, pill = false }: { controller: GoogleCalendarExportController; selectedId?: string; compact?: boolean; pill?: boolean }) {
  const id = useId();
  const [scope, setScope] = useState<CalendarExportScope>("all");
  const selected = controller.items.filter(item => selectedId !== undefined && item.displayIds.includes(selectedId));
  const effectiveScope = compact || selected.length === 0 ? "all" : scope;
  const chosen = effectiveScope === "all" ? controller.items : selected;
  const relevant = controller.state.scope === effectiveScope && (effectiveScope === "all" || controller.state.selectedId === selectedId);
  const result = relevant ? controller.state.result : null;
  const issue = relevant ? controller.state.issue : null;
  const authFailure = controller.state.result?.failures.find(failure => ["AUTH_REQUIRED", "INSUFFICIENT_SCOPE"].includes(failure.code || ""));
  const authIssue = controller.state.issue && ["AUTH_REQUIRED", "INSUFFICIENT_SCOPE"].includes(controller.state.issue.code || "");
  const needsAuthorization = !!authFailure || !!authIssue || !!controller.returnMessage?.failed;
  const setupUrl = safeActionUrl(issue?.actionUrl || result?.failures.find(failure => failure.actionUrl)?.actionUrl);
  const calendarUrl = safeActionUrl(result?.calendarUrl);
  const remaining = result ? result.failed + result.pending : 0;
  const complete = result !== null && remaining === 0;
  const blocked = controller.disabledReason || (chosen.length === 0 ? "No study blocks or deadlines in this saved plan." : null);
  const label = controller.running ? "Exporting…" : remaining ? `Retry ${remaining} ${remaining === 1 ? "event" : "events"}` : complete ? "Exported to Google Calendar" : "Export to Google Calendar";

  return <section className={`calendar-export-control ${compact ? "compact-export" : ""} ${pill ? "export-pill" : ""}`} aria-label="Export study plan to Google Calendar">
    {!compact && !pill && selected.length > 0 && <label className="calendar-export-scope" htmlFor={`${id}-scope`}><span>Export</span><select id={`${id}-scope`} value={effectiveScope} onChange={event => setScope(event.target.value as CalendarExportScope)} disabled={controller.running}><option value="all">Whole plan ({controller.items.length} events)</option><option value="selected">Only this event</option></select></label>}
    <div className="calendar-export-main">{!pill && <div className="calendar-export-description"><p>{calendarExportSummary(chosen)}</p><span>{effectiveScope === "all" ? "Whole saved plan" : "Selected event"} · primary Google Calendar · 15-minute deadline reminders.</span></div>}<button type="button" className="google-calendar-export" onClick={() => void controller.exportItems(effectiveScope, selectedId)} disabled={controller.running || !!blocked || complete || needsAuthorization} aria-describedby={`${id}-status`}><span className="calendar-export-label"><CalendarIcon className="calendar-export-icon"/><span>{label}</span></span>{!pill && <ArrowRight className="calendar-export-arrow"/>}</button></div>
    <div id={`${id}-status`} className="calendar-export-status" aria-live="polite" aria-atomic="true">
      {blocked && <p>{blocked}</p>}
      {controller.running && <p role="status">Adding events to Google Calendar. Keep this page open until export finishes.</p>}
      {result && <p role="status">{result.created} added · {result.existing} already exported{result.failed > 0 ? ` · ${result.failed} failed` : ""}{result.pending > 0 ? ` · ${result.pending} remaining` : ""}.{remaining > 0 && " Retry skips events already added."}</p>}
      {issue && <p className="calendar-export-error" role="alert">{issue.message}</p>}
      {!issue && !result && !controller.running && controller.returnMessage && <p role={controller.returnMessage.failed ? "alert" : "status"}>{controller.returnMessage.message}</p>}
      {needsAuthorization && !controller.running && !controller.disabledReason && <div className="calendar-export-authorization"><p>Allow access once to add events. After returning, choose Export.</p><a href={calendarExportAuthorizationUrl}>Allow Google Calendar export <ArrowRight/></a></div>}
      {!needsAuthorization && setupUrl && <a className="calendar-export-setup" href={setupUrl} target="_blank" rel="noopener noreferrer">Open Google Calendar setup <ArrowRight/></a>}
      {result && result.failures.length > 0 && <details className="calendar-export-failures"><summary>Review {result.failures.length} export {result.failures.length === 1 ? "issue" : "issues"}</summary><ul>{result.failures.map((failure, index) => <li key={index}><strong>{failure.title}</strong><span>{failure.message}</span></li>)}</ul></details>}
      {calendarUrl && result && result.created + result.existing > 0 && <a className="calendar-export-success" href={calendarUrl} target="_blank" rel="noopener noreferrer">Open Google Calendar <ArrowRight/></a>}
    </div>
  </section>;
}
