import type { SourceData, StudyPreferences } from "@/lib/types";
import type { PlanningProgress, ProgressReporter } from "@/lib/progress";
import { getCanvasSession, getGoogleSession } from "@/lib/session";
import { canvasAccess, readAssignments } from "./canvas";
import { googleAccess, readAcademicEmails, readCalendarEvents } from "./google";
import { IntegrationError } from "./http";

export async function collectSources(preferences: StudyPreferences, window: { start: string; end: string }, onProgress?: ProgressReporter, onSources?: (sources: SourceData) => void): Promise<SourceData> {
  const report = (progress: PlanningProgress) => {
    try { onProgress?.(progress); } catch { /* A progress display must not interrupt collection. */ }
  };
  let sources: SourceData = { assignments: [], emails: [], calendarEvents: [] };
  const collectionWarnings: string[] = [];
  const addWarnings = (warnings: string[]) => {
    for (const warning of warnings) if (!collectionWarnings.includes(warning)) collectionWarnings.push(warning);
  };
  const warningFields = () => collectionWarnings.length ? { collectionWarnings: [...collectionWarnings] } : {};
  const publishSources = (partial: Partial<SourceData>) => {
    sources = { ...sources, ...partial };
    try { onSources?.({ ...sources }); } catch { /* Snapshot display must not interrupt collection. */ }
  };
  report({ stage: "connections", status: "running", message: "Checking connected accounts" });
  const [storedGoogle, storedCanvas] = await Promise.all([getGoogleSession(), getCanvasSession()]);
  if (!storedGoogle?.enabled.includes("google-calendar")) throw new IntegrationError("Connect Google Calendar before generating study blocks.", 400);
  if (!storedGoogle.enabled.includes("gmail") && !storedCanvas) throw new IntegrationError("Connect Gmail or Canvas so the planner can find academic tasks.", 400);
  const [google, canvas] = await Promise.all([googleAccess(), storedCanvas ? canvasAccess() : Promise.resolve(null)]);
  if (!google?.enabled.includes("google-calendar")) throw new IntegrationError("Reconnect Google Calendar and approve calendar access.", 401);
  if (storedGoogle.enabled.includes("gmail") && !google.enabled.includes("gmail")) throw new IntegrationError("Reconnect Gmail and approve email access.", 401);
  report({ stage: "connections", status: "complete", message: "Connected accounts are ready" });
  if (!google.enabled.includes("gmail")) report({ stage: "gmail", status: "skipped", message: "Gmail is not connected" });
  if (!canvas) report({ stage: "canvas", status: "skipped", message: "Canvas is not connected" });
  const [mail, assignments, calendarEvents] = await Promise.all([
    google.enabled.includes("gmail") ? readAcademicEmails(google, report).then(mail => {
      addWarnings(mail.warnings);
      publishSources({ emails: mail.emails, ...warningFields() });
      return mail;
    }) : Promise.resolve({ emails: [], warnings: [] }),
    canvas ? readAssignments(canvas, window, report, warning => addWarnings([warning])).then(assignments => {
      publishSources({ assignments, ...warningFields() });
      return assignments;
    }) : Promise.resolve([]),
    readCalendarEvents(google, window, preferences.timeZone, report).then(calendarEvents => {
      publishSources({ calendarEvents });
      return calendarEvents;
    }),
  ]);
  return { emails: mail.emails, assignments, calendarEvents, ...warningFields() };
}
