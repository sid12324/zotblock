import { createHash } from "node:crypto";
import type { CalendarExportItem, CalendarExportResult } from "@/lib/calendar/export";
import type { GoogleSession } from "@/lib/session";
import { bearer, IntegrationError, providerFetch, type IntegrationErrorCode } from "./http";

const RECONNECT_URL = "/api/auth/google?provider=google-calendar&access=export&returnTo=calendar";
const CALENDAR_URL = "https://calendar.google.com/calendar/r";
const MAX_DESCRIPTION_LENGTH = 8_000;
const SHORTENED_NOTICE = "<br><br>[Details shortened by ZotBlock. Open the source for full instructions.]";
const failureMessages: Record<IntegrationErrorCode, string> = {
  AUTH_REQUIRED: "Reconnect Google Calendar to renew access, then retry export. Events already saved will not be duplicated.",
  INSUFFICIENT_SCOPE: "Reconnect Google Calendar and approve event export permission, then retry.",
  RATE_LIMITED: "Google Calendar reached a rate or quota limit. Wait before retrying export.",
  API_DISABLED: "Google Calendar API is disabled for this app. Enable it in Google Cloud and retry export.",
  OAUTH_CONFIG: "Google OAuth configuration was not accepted. Check the app's Google credentials before retrying.",
  FORBIDDEN: "Google Calendar denied this write. Check the account's permissions and organization policies.",
  UPSTREAM_ERROR: "Google Calendar could not save this event. Retry export; events already saved will not be duplicated.",
};

function safeSource(value?: string) {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Escape plain text as indivisible Unicode/entity tokens before applying the app's HTML budget. */
function htmlDescription(item: CalendarExportItem, source: string | null) {
  const sourceLine = source ? `Source: ${source}` : "";
  const text = sourceLine && !item.description.startsWith(sourceLine) ? `${sourceLine}\n\n${item.description}` : item.description;
  const tokens = Array.from(text.replace(/\r\n?/g, "\n"), character => character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === "\n" ? "<br>" : character);
  if (tokens.reduce((length, token) => length + token.length, 0) <= MAX_DESCRIPTION_LENGTH) return tokens.join("");
  const budget = MAX_DESCRIPTION_LENGTH - SHORTENED_NOTICE.length;
  const included: string[] = [];
  let length = 0;
  for (const token of tokens) {
    if (length + token.length > budget) break;
    included.push(token);
    length += token.length;
  }
  return included.join("") + SHORTENED_NOTICE;
}

function failure(error: unknown, title: string): CalendarExportResult["failures"][number] {
  const code = error instanceof IntegrationError && error.code ? error.code : "UPSTREAM_ERROR";
  const actionUrl = code === "AUTH_REQUIRED" || code === "INSUFFICIENT_SCOPE" ? RECONNECT_URL : error instanceof IntegrationError ? error.actionUrl : undefined;
  return { title, message: failureMessages[code], code, ...(actionUrl ? { actionUrl } : {}) };
}

/** Stable IDs make retries safe even when an earlier response was lost after Google saved an event. */
export async function exportCalendarItems(session: GoogleSession, items: CalendarExportItem[]): Promise<CalendarExportResult> {
  const result: CalendarExportResult = { total: items.length, created: 0, existing: 0, failed: 0, pending: 0, failures: [], calendarUrl: CALENDAR_URL };
  const deadline = Date.now() + 120_000;
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && Date.now() < deadline && next < items.length) {
      const item = items[next++];
      try {
        const digest = createHash("sha256").update(JSON.stringify([session.account.trim().toLowerCase(), item.key])).digest("hex");
        const source = safeSource(item.sourceUrl);
        const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        url.searchParams.set("sendUpdates", "none");
        const response = await providerFetch(url, {
          method: "POST", headers: { ...bearer(session.accessToken), "Content-Type": "application/json" },
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          body: JSON.stringify({ id: `a${digest}`, summary: item.summary, description: htmlDescription(item, source), start: item.start, end: item.end,
            transparency: item.kind === "study" ? "opaque" : "transparent",
            extendedProperties: { private: { zotblock: "1", zotblockKey: digest, zotblockKind: item.kind } },
            ...(source ? { source: { title: "ZotBlock coursework", url: source } } : {}),
          }),
        }, "Google Calendar", [409]);
        if (response.status === 409) result.existing++;
        else result.created++;
        await response.body?.cancel().catch(() => {});
      } catch (error) {
        const failed = failure(error, item.summary);
        result.failed++;
        result.failures.push(failed);
        if (failed.code && failed.code !== "UPSTREAM_ERROR") stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  result.pending = result.total - result.created - result.existing - result.failed;
  return result;
}
