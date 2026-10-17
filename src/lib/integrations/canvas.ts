import { appUrl, getCanvasSession, saveCanvasSession, sessionConfigured, type CanvasSession } from "@/lib/session";
import type { Assignment, AssignmentDetails } from "@/lib/types";
import type { PlanningProgress, ProgressReporter } from "@/lib/progress";
import { bearer, IntegrationError, providerFetch, providerJson, stripHtml } from "./http";

export const CANVAS_SCOPES = [
  "url:GET|/api/v1/planner/items", "url:GET|/api/v1/users/:user_id/profile",
  "url:GET|/api/v1/courses/:course_id/assignments/:id",
  "url:GET|/api/v1/courses/:course_id/quizzes/:id",
  "url:GET|/api/v1/courses/:course_id/discussion_topics/:topic_id",
];

export function canvasOAuthConfigured() {
  return sessionConfigured() && Boolean(process.env.CANVAS_CLIENT_ID && process.env.CANVAS_CLIENT_SECRET);
}

export function canvasTokenConfigured() {
  if (!sessionConfigured() || !process.env.CANVAS_ACCESS_TOKEN || !process.env.CANVAS_BASE_URL) return false;
  try { validateCanvasOrigin(process.env.CANVAS_BASE_URL); return true; }
  catch { return false; }
}

export function canvasConfigured() {
  return canvasOAuthConfigured() || canvasTokenConfigured();
}

function parseOrigin(input: string) {
  let url: URL;
  try { url = new URL(input.includes("://") ? input : `https://${input}`); }
  catch { throw new IntegrationError("Enter your school's Canvas hostname, such as school.instructure.com.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new IntegrationError("Canvas must use an HTTPS school hostname without a path or port.", 400);
  return url;
}

/** Never send an OAuth secret to an arbitrary user-supplied origin. */
export function validateCanvasOrigin(input?: string | null) {
  const configured = process.env.CANVAS_BASE_URL ? parseOrigin(process.env.CANVAS_BASE_URL).origin : null;
  const url = parseOrigin(input?.trim() || configured || "");
  const instructure = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+instructure\.com$/i.test(url.hostname);
  if (configured ? url.origin !== configured : !instructure) throw new IntegrationError(configured ? "Use the Canvas school configured for this app." : "Use your school's instructure.com hostname. A custom Canvas domain must be configured by the app administrator.", 400);
  return url.origin;
}

export function canvasAuthorizationUrl(origin: string, state: string) {
  if (!canvasOAuthConfigured()) throw new IntegrationError("Configure Canvas OAuth and SESSION_SECRET before connecting Canvas.", 503);
  const url = new URL("/login/oauth2/auth", validateCanvasOrigin(origin));
  url.search = new URLSearchParams({ client_id: process.env.CANVAS_CLIENT_ID!, response_type: "code", redirect_uri: `${appUrl()}/api/auth/canvas/callback`, state, scope: CANVAS_SCOPES.join(" ") }).toString();
  return url;
}

type CanvasToken = { access_token?: string; refresh_token?: string; expires_in?: number; user?: { name?: string; id?: number } };

async function canvasToken(origin: string, parameters: Record<string, string>) {
  const token = await providerJson<CanvasToken>(new URL("/login/oauth2/token", validateCanvasOrigin(origin)), { method: "POST", body: new URLSearchParams({ client_id: process.env.CANVAS_CLIENT_ID!, client_secret: process.env.CANVAS_CLIENT_SECRET!, ...parameters }) }, "Canvas");
  if (!token.access_token || !token.expires_in) throw new IntegrationError("Canvas did not return a usable access token. Please reconnect.", 401);
  return token;
}

export async function completeCanvasOAuth(code: string, origin: string) {
  if (!canvasOAuthConfigured()) throw new IntegrationError("Canvas OAuth has not been configured.", 503);
  origin = validateCanvasOrigin(origin);
  const token = await canvasToken(origin, { code, grant_type: "authorization_code", redirect_uri: `${appUrl()}/api/auth/canvas/callback` });
  const profile = await providerJson<{ name?: string; login_id?: string }>(new URL("/api/v1/users/self/profile", origin), { headers: bearer(token.access_token!) }, "Canvas");
  if (!token.refresh_token) throw new IntegrationError("Canvas did not grant renewable access. Reconnect Canvas or contact your school's Canvas administrator.", 401);
  await saveCanvasSession({ accessToken: token.access_token!, refreshToken: token.refresh_token, authType: "oauth", expiresAt: Date.now() + token.expires_in! * 1000, origin, account: profile.name || token.user?.name || new URL(origin).hostname });
}

/** Connect the server owner's Canvas account for a personal local prototype. */
export async function connectCanvasToken(): Promise<void> {
  if (!canvasTokenConfigured()) throw new IntegrationError("Configure CANVAS_ACCESS_TOKEN, CANVAS_BASE_URL, and SESSION_SECRET on the server before connecting personal Canvas.", 503);
  const origin = validateCanvasOrigin(process.env.CANVAS_BASE_URL!);
  const accessToken = process.env.CANVAS_ACCESS_TOKEN!;
  const profile = await providerJson<{ name?: string; login_id?: string }>(new URL("/api/v1/users/self/profile", origin), { headers: bearer(accessToken) }, "Canvas");
  await saveCanvasSession({ accessToken, authType: "personal-token", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, origin, account: profile.name || profile.login_id || new URL(origin).hostname });
}

export async function canvasAccess(): Promise<CanvasSession | null> {
  const session = await getCanvasSession();
  if (!session) return null;
  if (session.authType === "personal-token") {
    if (!canvasTokenConfigured() || session.accessToken !== process.env.CANVAS_ACCESS_TOKEN) throw new IntegrationError("The personal Canvas token changed or is no longer configured. Reconnect Canvas using the current server configuration.", 401);
    if (session.origin !== validateCanvasOrigin(process.env.CANVAS_BASE_URL!)) throw new IntegrationError("The configured Canvas school changed. Reconnect Canvas using the current server configuration.", 401);
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw new IntegrationError("The personal Canvas connection expired. Reconnect Canvas to use the configured token.", 401);
    return session;
  }
  validateCanvasOrigin(session.origin);
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!canvasOAuthConfigured() || !session.refreshToken) throw new IntegrationError("Reconnect Canvas to renew its access.", 401);
  const token = await canvasToken(session.origin, { refresh_token: session.refreshToken, grant_type: "refresh_token" });
  const refreshed = { ...session, accessToken: token.access_token!, refreshToken: token.refresh_token || session.refreshToken, expiresAt: Date.now() + token.expires_in! * 1000 };
  await saveCanvasSession(refreshed);
  return refreshed;
}

type PlannerItem = {
  plannable_id?: string | number;
  plannable_type?: string;
  plannable_date?: string;
  context_name?: string;
  course_id?: number;
  html_url?: string;
  planner_override?: { marked_complete?: boolean; dismissed?: boolean } | null;
  submissions?: false | { submitted?: boolean; excused?: boolean; graded?: boolean; needs_grading?: boolean; workflow_state?: string };
  plannable?: { id?: number | string; title?: string; name?: string; due_at?: string; description?: string; details?: string; html_url?: string };
};

export function canvasNextPage(link: string | null, origin: string): URL | null {
  const next = link?.split(",").find(part => /;\s*rel="?next"?(?:;|\s|$)/.test(part));
  if (!next) return null;
  const target = next.match(/<([^>]+)>/)?.[1];
  if (!target) throw new IntegrationError("Canvas returned an invalid pagination link.");
  const url = new URL(target, origin);
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith("/api/v1/")) throw new IntegrationError("Canvas returned an unsafe pagination link.");
  return url;
}

export function plannerAssignment(item: PlannerItem, origin: string): Assignment | null {
  if (!["assignment", "quiz", "discussion_topic", "assessment_request", "sub_assignment", "peer_review_sub_assignment"].includes(item.plannable_type || "")) return null;
  const submissions = item.submissions || undefined;
  if (item.planner_override?.marked_complete || item.planner_override?.dismissed || submissions?.submitted || submissions?.excused || submissions?.graded || submissions?.needs_grading || ["submitted", "graded", "pending_review"].includes(submissions?.workflow_state || "")) return null;
  // The root date includes per-student extensions; nested due_at can be the course default.
  const dueAt = item.plannable_date || item.plannable?.due_at;
  if (!dueAt) return null;
  if (Number.isNaN(Date.parse(dueAt))) throw new IntegrationError("Canvas returned an assignment with an invalid due date.");
  const id = item.plannable_id ?? item.plannable?.id;
  if (id === undefined) throw new IntegrationError("Canvas returned an assignment without an identifier.");
  const rawUrl = item.html_url || item.plannable?.html_url;
  let url: string | null = null;
  if (rawUrl) {
    try {
      const candidate = new URL(rawUrl, origin);
      if (candidate.origin === origin && !candidate.username && !candidate.password) url = candidate.href;
    } catch { /* The assignment remains usable without an invalid link. */ }
  }
  return { id: `${item.plannable_type}:${id}`, title: item.plannable?.title || item.plannable?.name || "Untitled assignment", course: item.context_name || (item.course_id ? `Course ${item.course_id}` : "Canvas"), dueAt: new Date(dueAt).toISOString(), url, description: stripHtml(item.plannable?.description || item.plannable?.details || "") };
}

function plainInstructions(html: string) {
  const clean = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  return clean.split(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|tr)>/gi).map(stripHtml).filter(Boolean).join("\n");
}

function resourceUrl(value: unknown, origin: string) {
  if (typeof value !== "string") return null;
  try {
    const decoded = stripHtml(value).replace(/&#(x[\da-f]+|\d+);/gi, (_, number: string) => {
      const code = number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
    const url = new URL(decoded, origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(key => /^(?:access_token|oauth_token|api_key)$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

function assignmentDetails(value: Record<string, unknown>, origin: string) {
  const details: AssignmentDetails = {};
  const number = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : undefined;
  const strings = (key: string) => Array.isArray(value[key]) ? value[key].filter((entry): entry is string => typeof entry === "string") : undefined;
  if (number("points_possible") !== undefined) details.pointsPossible = number("points_possible");
  if (strings("submission_types")) details.submissionTypes = strings("submission_types");
  if (strings("allowed_extensions")) details.allowedExtensions = strings("allowed_extensions");
  if (number("time_limit") !== undefined) details.timeLimitMinutes = number("time_limit");
  if (number("question_count") !== undefined) details.questionCount = number("question_count");
  if (number("allowed_attempts") !== undefined) details.allowedAttempts = number("allowed_attempts");
  if (typeof value.locked_for_user === "boolean") details.lockedForUser = value.locked_for_user;
  if (typeof value.lock_explanation === "string") details.lockExplanation = plainInstructions(value.lock_explanation);
  if (typeof value.grading_type === "string") details.gradingType = value.grading_type;
  for (const [raw, key] of [["unlock_at", "unlockAt"], ["lock_at", "lockAt"]] as const) {
    if (value[raw] === null) details[key] = null;
    else if (typeof value[raw] === "string" && !Number.isNaN(Date.parse(value[raw]))) details[key] = new Date(value[raw]).toISOString();
  }
  const html = typeof value.description === "string" ? value.description : typeof value.message === "string" ? value.message : "";
  const attachments = new Map<string, { title: string; url: string }>();
  for (const raw of Array.isArray(value.attachments) ? value.attachments : []) {
    if (!raw || typeof raw !== "object") continue;
    const attachment = raw as Record<string, unknown>;
    const url = resourceUrl(attachment.url, origin);
    if (url) attachments.set(url, { title: typeof attachment.display_name === "string" ? attachment.display_name : typeof attachment.filename === "string" ? attachment.filename : "Canvas resource", url });
  }
  const cleanHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  for (const anchor of cleanHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = anchor[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const url = resourceUrl(href?.[1] ?? href?.[2] ?? href?.[3], origin);
    if (url) attachments.set(url, { title: stripHtml(anchor[2]) || "Canvas resource", url });
  }
  if (attachments.size) details.attachments = [...attachments.values()];
  return { details, description: plainInstructions(html) };
}

/** Detail 403/404 responses mean the planner item is visible but richer content is not. */
async function readCanvasDetail(url: URL, accessToken: string): Promise<Record<string, unknown> | null> {
  let response: Response;
  try { response = await fetch(url, { headers: bearer(accessToken), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new IntegrationError("Canvas assignment details could not be reached. Please try again."); }
  if (response.status === 403 || response.status === 404) return null;
  if (response.status === 401) throw new IntegrationError("Canvas access expired. Reconnect Canvas to read assignment details.", 401, "AUTH_REQUIRED");
  if (response.status === 429) throw new IntegrationError("Canvas is rate limiting assignment detail requests. Please try again shortly.", 429, "RATE_LIMITED");
  if (!response.ok) throw new IntegrationError("Canvas could not return assignment details. Please try again.");
  const maximumBytes = 2_000_000;
  if (!response.body || Number(response.headers.get("content-length")) > maximumBytes) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function readAssignments(session: CanvasSession, window: { start: string; end: string }, onProgress?: ProgressReporter, onWarning?: (warning: string) => void): Promise<Assignment[]> {
  const report = (progress: PlanningProgress) => {
    try { onProgress?.(progress); } catch { /* A progress display must not interrupt collection. */ }
  };
  report({ stage: "canvas", status: "running", message: "Reading Canvas assignments", completed: 0 });
  const deadline = Date.now() + 45_000;
  const origin = validateCanvasOrigin(session.origin);
  let url: URL | null = new URL("/api/v1/planner/items", origin);
  url.search = new URLSearchParams({ start_date: window.start, end_date: window.end, filter: "incomplete_items", per_page: "100" }).toString();
  const assignments = new Map<string, Assignment>();
  const plannerItems = new Map<string, PlannerItem>();
  const visited = new Set<string>();
  let processed = 0;
  for (let page = 0; page < 10 && url; page++) {
    if (visited.has(url.href)) throw new IntegrationError("Canvas returned a repeated pagination link.");
    visited.add(url.href);
    const response = await providerFetch(url, { headers: bearer(session.accessToken) }, "Canvas");
    const items: unknown = await response.json();
    if (!Array.isArray(items)) throw new IntegrationError("Canvas returned an unreadable assignment list.");
    for (const item of items as PlannerItem[]) {
      const assignment = plannerAssignment(item, origin);
      if (assignment) { assignments.set(assignment.id, assignment); plannerItems.set(assignment.id, item); }
      processed++;
      const course = (assignment?.course || item.context_name || (item.course_id ? `Course ${item.course_id}` : "")).replace(/\s+/g, " ").trim().slice(0, 160);
      report({ stage: "canvas", status: "running", message: course ? `Collecting ${course}` : "Reading Canvas planner items", completed: processed, detail: `${assignments.size} assignments collected · page ${page + 1}` });
    }
    if (!items.length) report({ stage: "canvas", status: "running", message: "Reading Canvas assignments", completed: processed, detail: `Page ${page + 1} checked` });
    url = canvasNextPage(response.headers.get("link"), origin);
    if (!url) {
      const entries = [...assignments.values()];
      let detailsProcessed = 0;
      let unavailable = 0;
      let timedOut = false;
      report({ stage: "canvas", status: "running", message: "Reading Canvas assignment details", completed: 0, total: entries.length });
      for (let index = 0; index < entries.length; index += 6) {
        if (Date.now() >= deadline) { unavailable += entries.length - index; timedOut = true; break; }
        await Promise.all(entries.slice(index, index + 6).map(async assignment => {
          const item = plannerItems.get(assignment.id)!;
          const id = item.plannable_id ?? item.plannable?.id;
          const endpoint = item.plannable_type === "assignment" ? "assignments" : item.plannable_type === "quiz" ? "quizzes" : item.plannable_type === "discussion_topic" ? "discussion_topics" : null;
          if (endpoint && /^\d+$/.test(String(item.course_id)) && /^\d+$/.test(String(id))) {
            const value = await readCanvasDetail(new URL(`/api/v1/courses/${item.course_id}/${endpoint}/${id}`, origin), session.accessToken);
            if (value) {
              const enriched = assignmentDetails(value, origin);
              assignment.details = enriched.details;
              if (enriched.description) assignment.description = enriched.description;
              // Preserve the planner's personalized due date, title, course, and identity.
            } else unavailable++;
          } else if (endpoint) unavailable++;
          detailsProcessed++;
          const course = assignment.course.replace(/\s+/g, " ").trim().slice(0, 160);
          report({ stage: "canvas", status: "running", message: `Collecting ${course || "Canvas"}`, completed: detailsProcessed, total: entries.length, detail: "Reading assignment descriptions and requirements" });
        }));
      }
      if (unavailable) {
        const warning = `Canvas descriptions or details were unavailable for ${unavailable} ${unavailable === 1 ? "item" : "items"}${timedOut ? " before the collection time limit" : ""}. Basic planner dates and titles were kept; reconnect Canvas if additional read access is needed.`;
        try { onWarning?.(warning); } catch { /* Warning display must not interrupt collection. */ }
      }
      report({ stage: "canvas", status: "complete", message: "Canvas collection complete", completed: detailsProcessed, total: entries.length, detail: `${assignments.size} assignments collected${unavailable ? `; ${unavailable} with unavailable details` : ""}` });
      return entries;
    }
  }
  throw new IntegrationError("Canvas returned more than 1,000 planner items. Choose a shorter planning window.", 422);
}
