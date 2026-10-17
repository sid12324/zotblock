import { appUrl, getGoogleSession, saveGoogleSession, sessionConfigured, type GoogleProvider, type GoogleSession } from "@/lib/session";
import { bearer, IntegrationError, providerJson, stripHtml } from "./http";
import type { AcademicEmail, CalendarEvent } from "@/lib/types";
import type { PlanningProgress, ProgressReporter } from "@/lib/progress";
import { Temporal } from "@js-temporal/polyfill";

export const GOOGLE_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  "google-calendar": "https://www.googleapis.com/auth/calendar.events.readonly",
};
export const GOOGLE_CALENDAR_EXPORT_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const CALENDAR_WRITE_SCOPES = [GOOGLE_CALENDAR_EXPORT_SCOPE, "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"];
const CALENDAR_READ_SCOPES = [...CALENDAR_WRITE_SCOPES, GOOGLE_SCOPES["google-calendar"], "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events.owned.readonly"];
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

function hasProviderAccess(scopes: string[], provider: GoogleProvider) {
  return provider === "gmail" ? scopes.includes(GOOGLE_SCOPES.gmail) : CALENDAR_READ_SCOPES.some(scope => scopes.includes(scope));
}

export function hasGoogleCalendarExportAccess(session: GoogleSession | null | undefined): boolean {
  return Boolean(session?.enabled.includes("google-calendar") && CALENDAR_WRITE_SCOPES.some(scope => session.scopes.includes(scope)));
}

export function googleConfigured() {
  return sessionConfigured() && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthorizationUrl(provider: GoogleProvider, state: string, account?: string, access: "read" | "export" = "read") {
  if (!googleConfigured()) throw new IntegrationError("Configure Google OAuth and SESSION_SECRET before connecting Google.", 503);
  if (access === "export" && provider !== "google-calendar") throw new IntegrationError("Calendar export permission requires Google Calendar.", 400);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: `${appUrl()}/api/auth/google/callback`, response_type: "code", scope: `${EMAIL_SCOPE} ${access === "export" ? GOOGLE_CALENDAR_EXPORT_SCOPE : GOOGLE_SCOPES[provider]}`, state, access_type: "offline", include_granted_scopes: "true", prompt: "consent", ...(account ? { login_hint: account } : {}) }).toString();
  return url;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };

async function googleToken(parameters: Record<string, string>): Promise<TokenResponse> {
  const token = await providerJson<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...parameters }) }, "Google");
  if (!token.access_token || !token.expires_in) throw new IntegrationError("Google did not return a usable access token. Please reconnect.", 401, "AUTH_REQUIRED");
  return token;
}

export async function completeGoogleOAuth(code: string, provider: GoogleProvider, access: "read" | "export" = "read") {
  if (!googleConfigured()) throw new IntegrationError("Google OAuth has not been configured.", 503);
  if (access === "export" && provider !== "google-calendar") throw new IntegrationError("Calendar export permission requires Google Calendar.", 400);
  const [token, previous] = await Promise.all([googleToken({ code, grant_type: "authorization_code", redirect_uri: `${appUrl()}/api/auth/google/callback` }), getGoogleSession()]);
  const profile = await providerJson<{ email?: string; verified_email?: boolean }>("https://www.googleapis.com/oauth2/v2/userinfo", { headers: bearer(token.access_token!) }, "Google");
  if (!profile.email) throw new IntegrationError("Google did not share your account email. Reconnect and approve the requested permissions.", 401);
  const scopes = (token.scope || "").split(" ").filter(Boolean);
  if (!hasProviderAccess(scopes, provider) || (access === "export" && !CALENDAR_WRITE_SCOPES.some(scope => scopes.includes(scope)))) throw new IntegrationError("The requested Google permission was not granted. Please reconnect and approve it.", 401);
  const matchingPrevious = previous?.account === profile.email ? previous : null;
  const enabled = [...new Set([...(matchingPrevious?.enabled || []), provider])].filter(p => hasProviderAccess(scopes, p));
  const session: GoogleSession = { accessToken: token.access_token!, refreshToken: token.refresh_token || matchingPrevious?.refreshToken, expiresAt: Date.now() + token.expires_in! * 1000, account: profile.email, scopes, enabled };
  if (!session.refreshToken) throw new IntegrationError("Google did not grant offline access. Remove this app in Google account permissions and connect again.", 401);
  await saveGoogleSession(session);
}

export async function googleAccess(): Promise<GoogleSession | null> {
  const session = await getGoogleSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!googleConfigured() || !session.refreshToken) throw new IntegrationError("Reconnect Google to renew its access.", 401, "AUTH_REQUIRED");
  const token = await googleToken({ refresh_token: session.refreshToken, grant_type: "refresh_token" });
  const refreshed = { ...session, accessToken: token.access_token!, refreshToken: token.refresh_token || session.refreshToken, expiresAt: Date.now() + token.expires_in! * 1000 };
  if (token.scope) {
    refreshed.scopes = token.scope.split(" ");
    refreshed.enabled = refreshed.enabled.filter(p => hasProviderAccess(refreshed.scopes, p));
  }
  await saveGoogleSession(refreshed);
  return refreshed;
}

type MessagePart = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: MessagePart[] };
type GmailMessage = { id: string; snippet?: string; internalDate?: string; payload?: MessagePart & { headers?: { name: string; value: string }[] } };

export function decodeEmailBody(part?: MessagePart): string {
  if (!part) return "";
  if (part.filename) return "";
  if (part.parts?.length) {
    const plain = part.parts.filter(p => p.mimeType === "text/plain").map(decodeEmailBody).filter(Boolean);
    if (plain.length) return plain.join("\n");
    return part.parts.map(decodeEmailBody).filter(Boolean).join("\n");
  }
  if (!part.body?.data || !["text/plain", "text/html"].includes(part.mimeType || "")) return "";
  const text = Buffer.from(part.body.data, "base64url").toString("utf8");
  return part.mimeType === "text/html" ? stripHtml(text) : text;
}

async function loadInlineTextParts(part: MessagePart | undefined, messageId: string, accessToken: string, deadline: number, depth = 0): Promise<void> {
  if (!part || part.filename) return;
  const needsTextRequest = part.body?.attachmentId && !part.body.data && ["text/plain", "text/html"].includes(part.mimeType || "");
  if ((part.parts?.length || needsTextRequest) && Date.now() >= deadline) throw new IntegrationError("The Gmail collection time limit was reached.", 422);
  if (depth > 20 || (part.parts?.length || 0) > 40) throw new IntegrationError("Gmail returned an email that is too complex to read completely.", 422);
  if (part.body?.attachmentId && !part.body.data && ["text/plain", "text/html"].includes(part.mimeType || "")) {
    if ((part.body.size || 0) > 480_000) throw new IntegrationError("This academic email is too large to process completely.", 422);
    const body = await providerJson<{ data?: string }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, { headers: bearer(accessToken) }, "Gmail");
    if (!body.data) throw new IntegrationError("Gmail could not return the full body of this academic email.", 422);
    part.body.data = body.data;
  }
  for (const child of part.parts || []) await loadInlineTextParts(child, messageId, accessToken, deadline, depth + 1);
}

/** Search is deliberately limited to recent academic mail; bodies stay on the server until plan generation. */
export async function readAcademicEmails(session: GoogleSession, onProgress?: ProgressReporter): Promise<{ emails: AcademicEmail[]; warnings: string[] }> {
  const report = (progress: PlanningProgress) => {
    try { onProgress?.(progress); } catch { /* A progress display must not interrupt collection. */ }
  };
  report({ stage: "gmail", status: "running", message: "Finding recent academic emails" });
  const deadline = Date.now() + 45_000;
  let timeLimit = false;
  const warnings: string[] = [];
  const ids = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    if (Date.now() >= deadline) { timeLimit = true; break; }
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.search = new URLSearchParams({ q: "newer_than:14d -category:promotions -category:social {assignment homework coursework syllabus midterm exam quiz deadline \"due date\"}", maxResults: "100", includeSpamTrash: "false", ...(pageToken ? { pageToken } : {}) }).toString();
    const result = await providerJson<{ messages?: { id: string }[]; nextPageToken?: string }>(url, { headers: bearer(session.accessToken) }, "Gmail");
    let exceededMessageLimit = false;
    for (const message of result.messages || []) {
      if (!message.id || ids.has(message.id)) continue;
      if (ids.size === 500) { exceededMessageLimit = true; break; }
      ids.add(message.id);
    }
    report({ stage: "gmail", status: "running", message: "Finding recent academic emails", detail: `${ids.size} matching emails found · page ${page + 1}` });
    if (ids.size === 500) {
      if (result.nextPageToken || exceededMessageLimit) warnings.push("Gmail found 500 matching emails from the last 14 days; additional matching emails were not checked, so coverage may be incomplete.");
      break;
    }
    if (!result.nextPageToken) break;
    if (seenPageTokens.has(result.nextPageToken)) {
      warnings.push(`Gmail stopped after finding ${ids.size} matching emails because pagination repeated; coverage may be incomplete.`);
      break;
    }
    seenPageTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
    if (page === 9) warnings.push(`Gmail stopped after 10 result pages containing ${ids.size} matching emails; coverage may be incomplete.`);
  }
  const emails: AcademicEmail[] = [];
  const messageIds = [...ids];
  let processed = 0;
  const reportRead = () => {
    processed++;
    report({ stage: "gmail", status: "running", message: "Reading academic email bodies", completed: processed, total: messageIds.length });
  };
  report({ stage: "gmail", status: "running", message: "Reading academic email bodies", completed: 0, total: messageIds.length });
  let serializedCharacters = 2;
  let skipped = 0;
  let readingLimit = false;
  for (let index = 0; index < messageIds.length && !readingLimit && !timeLimit; index += 8) {
    if (Date.now() >= deadline) { timeLimit = true; break; }
    const group = await Promise.all(messageIds.slice(index, index + 8).map(async (id): Promise<AcademicEmail | null> => {
      try {
        const message = await providerJson<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: bearer(session.accessToken) }, "Gmail");
        await loadInlineTextParts(message.payload, id, session.accessToken, deadline);
        const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || "";
        const body = decodeEmailBody(message.payload);
        if (!body) throw new IntegrationError("This academic email has no readable text body.", 422);
        if (body.length > 120_000) throw new IntegrationError("This academic email is too large to process completely.", 422);
        const receivedAt = new Date(Number(message.internalDate));
        if (!message.internalDate || Number.isNaN(receivedAt.valueOf())) throw new IntegrationError("This academic email has an invalid received date.", 422);
        const email = { id, subject: header("subject") || "Untitled email", from: header("from"), receivedAt: receivedAt.toISOString(), body, url: `https://mail.google.com/mail/u/0/#inbox/${id}` };
        reportRead();
        return email;
      } catch (error) {
        if (error instanceof IntegrationError && error.status === 422) {
          if (Date.now() >= deadline) timeLimit = true;
          else skipped++;
          reportRead();
          return null;
        }
        throw error;
      }
    }));
    for (const email of group) {
      if (!email) continue;
      const characters = JSON.stringify(email).length + (emails.length ? 1 : 0);
      if (serializedCharacters + characters > 750_000) { readingLimit = true; break; }
      emails.push(email);
      serializedCharacters += characters;
    }
  }
  if (skipped) warnings.push(`Skipped ${skipped} Gmail ${skipped === 1 ? "email" : "emails"} with oversized, unreadable, or complex content; coverage may be incomplete.`);
  if (readingLimit) warnings.push(`Gmail included ${emails.length} emails before reaching the reading limit; remaining matching emails were not processed, so coverage is incomplete.`);
  if (timeLimit) warnings.push(`Gmail included ${emails.length} emails before reaching the collection time limit; remaining matching emails were not processed, so coverage is incomplete.`);
  report({ stage: "gmail", status: "complete", message: "Gmail collection complete", completed: processed, total: messageIds.length, detail: `${emails.length} emails included${warnings.length ? "; coverage may be incomplete" : ""}` });
  return { emails, warnings };
}

type GoogleCalendarEvent = { id?: string; summary?: string; status?: string; transparency?: string; attendees?: { self?: boolean; responseStatus?: string }[]; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string } };

/** Check API availability without returning calendar contents to the integrations page. */
export async function checkGoogleCalendar(session: GoogleSession): Promise<void> {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  const now = Date.now();
  url.search = new URLSearchParams({ maxResults: "1", singleEvents: "true", timeMin: new Date(now).toISOString(), timeMax: new Date(now + 60_000).toISOString(), fields: "kind" }).toString();
  await providerJson<{ kind?: string }>(url, { headers: bearer(session.accessToken) }, "Google Calendar");
}

export function calendarEventTime(value: { dateTime?: string; date?: string; timeZone?: string } | undefined, timeZone: string) {
  if (value?.dateTime) {
    try { return Temporal.Instant.from(value.dateTime).toString(); }
    catch {
      try { return Temporal.PlainDateTime.from(value.dateTime).toZonedDateTime(value.timeZone || timeZone).toInstant().toString(); }
      catch { throw new IntegrationError("Google Calendar returned an invalid event time."); }
    }
  }
  if (value?.date) {
    try { return Temporal.PlainDate.from(value.date).toZonedDateTime({ timeZone: value.timeZone || timeZone, plainTime: "00:00" }).toInstant().toString(); }
    catch { throw new IntegrationError("Google Calendar returned an invalid all-day event date."); }
  }
  throw new IntegrationError("Google Calendar returned an event without a time.");
}

export async function readCalendarEvents(session: GoogleSession, window: { start: string; end: string }, timeZone: string, onProgress?: ProgressReporter): Promise<CalendarEvent[]> {
  const report = (progress: PlanningProgress) => {
    try { onProgress?.(progress); } catch { /* A progress display must not interrupt collection. */ }
  };
  report({ stage: "calendar", status: "running", message: "Reading your primary Google Calendar", completed: 0 });
  const events: CalendarEvent[] = [];
  let processed = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.search = new URLSearchParams({ timeMin: window.start, timeMax: window.end, timeZone, singleEvents: "true", orderBy: "startTime", maxResults: "250", showDeleted: "false", ...(pageToken ? { pageToken } : {}) }).toString();
    const result = await providerJson<{ items?: GoogleCalendarEvent[]; nextPageToken?: string; timeZone?: string }>(url, { headers: bearer(session.accessToken) }, "Google Calendar");
    for (const event of result.items || []) {
      processed++;
      if (event.status === "cancelled" || event.transparency === "transparent" || event.attendees?.some(a => a.self && a.responseStatus === "declined")) continue;
      const start = calendarEventTime(event.start, result.timeZone || timeZone);
      const end = calendarEventTime(event.end, result.timeZone || timeZone);
      if (Date.parse(end) <= Date.parse(start)) throw new IntegrationError("Google Calendar returned an event with an invalid duration.");
      events.push({ id: event.id || `${start}-${end}`, summary: event.summary || "Busy", start, end, ...(event.start?.date && event.end?.date ? { allDay: true } : {}) });
    }
    report({ stage: "calendar", status: "running", message: "Reading your primary Google Calendar", completed: processed, detail: `${events.length} busy events collected · page ${page + 1}` });
    pageToken = result.nextPageToken;
    if (!pageToken) {
      report({ stage: "calendar", status: "complete", message: "Google Calendar collection complete", completed: processed, total: processed, detail: `${events.length} busy events collected` });
      return events;
    }
  }
  throw new IntegrationError("Google Calendar has more than 2,500 events in this window. Choose a shorter planning window.", 422);
}
