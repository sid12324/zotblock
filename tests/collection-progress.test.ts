import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import type { PlanningProgress } from "../src/lib/progress";
import type { CanvasSession, GoogleSession } from "../src/lib/session";
import type { SourceData } from "../src/lib/types";

const cookieValues = new Map<string, string>();
const requireForTest = createRequire(import.meta.url);
const headersPath = requireForTest.resolve("next/headers");
const originalHeaders = requireForTest.cache[headersPath];
requireForTest.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({
  get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
  set: (name: string, value: string) => { cookieValues.set(name, value); },
  delete: (name: string) => { cookieValues.delete(name); },
}) } } as NodeModule;

let canvas: typeof import("../src/lib/integrations/canvas");
let google: typeof import("../src/lib/integrations/google");
let sources: typeof import("../src/lib/integrations/sources");
let session: typeof import("../src/lib/session");
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const environmentNames = ["SESSION_SECRET", "CANVAS_BASE_URL"] as const;
const originalEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
const window = { start: "2026-10-17T07:00:00Z", end: "2026-10-24T07:00:00Z" };
const googleSession = (): GoogleSession => ({ accessToken: "test-google-access", account: "student@example.edu", expiresAt: Date.now() + 3_600_000, scopes: [], enabled: ["gmail", "google-calendar"] });
const canvasSession = (): CanvasSession => ({ accessToken: "test-canvas-access", account: "Student", expiresAt: Date.now() + 3_600_000, origin: "https://school.instructure.com", authType: "oauth" });
const item = (id: number, course = "Mathematics") => ({ plannable_id: id, plannable_type: "assignment", plannable_date: "2026-10-21T06:59:00Z", course_id: 10, context_name: course, plannable: { title: `Assignment ${id}`, description: "Planner description" } });
const mail = (id: string, body = "Homework instructions") => ({ id, internalDate: "1792220400000", payload: { mimeType: "text/plain", headers: [{ name: "subject", value: "Private subject" }], body: { data: Buffer.from(body).toString("base64url") } } });
const busy = (id: string) => ({ id, summary: "Private event title", start: { dateTime: "2026-10-18T17:00:00Z" }, end: { dateTime: "2026-10-18T18:00:00Z" } });

before(async () => {
  [canvas, google, sources, session] = await Promise.all([
    import("../src/lib/integrations/canvas"), import("../src/lib/integrations/google"),
    import("../src/lib/integrations/sources"), import("../src/lib/session"),
  ]);
});
beforeEach(() => {
  cookieValues.clear();
  Date.now = originalNow;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-thirty-two-characters";
  process.env.CANVAS_BASE_URL = "https://school.instructure.com";
  globalThis.fetch = async () => { throw new Error("Unexpected collection test request"); };
});
after(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const name of environmentNames) {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  }
  if (originalHeaders) requireForTest.cache[headersPath] = originalHeaders;
  else delete requireForTest.cache[headersPath];
});

test("Canvas reports actual courses and enriches instructions without replacing student deadlines", async () => {
  const progress: PlanningProgress[] = [];
  const requests: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer test-canvas-access");
    if (url.pathname === "/api/v1/planner/items") {
      return url.searchParams.has("page") ? Response.json([item(3, "Physics")]) : Response.json([item(1), { ...item(2), submissions: { submitted: true } }], { headers: { link: '<https://school.instructure.com/api/v1/planner/items?page=2>; rel="next"' } });
    }
    return Response.json({
      description: '<p>Read the instructions.</p><p>Use <a href="/courses/10/files/40?wrap=1">Worksheet</a>.</p><script>privateScript()</script><a href="javascript:alert(1)">Unsafe</a><a href="https://user:password@example.com">Credentials</a>',
      due_at: "2026-10-19T00:00:00Z", points_possible: 25, submission_types: ["online_upload"], allowed_extensions: ["pdf"], unlock_at: null, lock_at: "2026-10-22T07:00:00Z", locked_for_user: false,
    });
  };
  const assignments = await canvas.readAssignments(canvasSession(), window, event => progress.push(event));
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].dueAt, "2026-10-21T06:59:00.000Z");
  assert.match(assignments[0].description, /Read the instructions\.\nUse Worksheet/);
  assert.doesNotMatch(assignments[0].description, /privateScript|<p>|<script>/);
  assert.equal(assignments[0].details?.pointsPossible, 25);
  assert.deepEqual(assignments[0].details?.submissionTypes, ["online_upload"]);
  assert.deepEqual(assignments[0].details?.allowedExtensions, ["pdf"]);
  assert.deepEqual(assignments[0].details?.attachments, [{ title: "Worksheet", url: "https://school.instructure.com/courses/10/files/40?wrap=1" }]);
  assert.equal(assignments[0].details?.unlockAt, null);
  assert.equal(assignments[0].details?.lockedForUser, false);
  assert.ok(progress.some(event => event.message === "Collecting Mathematics"));
  assert.ok(progress.some(event => event.message === "Collecting Physics"));
  const detailEvents = progress.filter(event => event.total === 2);
  assert.deepEqual(detailEvents.filter(event => event.status === "running").map(event => event.completed), [0, 1, 2]);
  assert.equal(detailEvents.at(-1)?.status, "complete");
  assert.ok(!requests.some(path => path.endsWith("/assignments/2")));
  assert.ok(canvas.CANVAS_SCOPES.includes("url:GET|/api/v1/courses/:course_id/assignments/:id"));
});

test("Canvas detail reads have at most six requests in flight and report real item totals", async () => {
  let active = 0;
  let maximum = 0;
  const progress: PlanningProgress[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/planner/items")) return Response.json(Array.from({ length: 13 }, (_, index) => item(index + 1)));
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    return Response.json({ description: "Full instructions" });
  };
  const assignments = await canvas.readAssignments(canvasSession(), window, event => progress.push(event));
  assert.equal(maximum, 6);
  assert.equal(assignments.length, 13);
  assert.deepEqual(progress.filter(event => event.status === "running" && event.total === 13).map(event => event.completed), Array.from({ length: 14 }, (_, index) => index));
  assert.equal(progress.at(-1)?.completed, 13);
  assert.equal(progress.at(-1)?.total, 13);
});

test("Canvas restricted details retain basic assignments and warn while actual authentication failures still fail", async () => {
  const warnings: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/planner/items")) return Response.json([item(1), item(2)]);
    return Response.json({ unsafe: "not exposed" }, { status: url.pathname.endsWith("/1") ? 403 : 404 });
  };
  const assignments = await canvas.readAssignments(canvasSession(), window, undefined, warning => warnings.push(warning));
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].description, "Planner description");
  assert.equal(assignments[0].details, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unavailable for 2 items/);
  const progress: PlanningProgress[] = [];
  globalThis.fetch = async input => new URL(String(input)).pathname.endsWith("/planner/items") ? Response.json([item(1)]) : Response.json({}, { status: 401 });
  await assert.rejects(canvas.readAssignments(canvasSession(), window, event => progress.push(event)), error => error instanceof Error && "status" in error && error.status === 401);
  assert.ok(!progress.some(event => event.status === "complete"));
});

test("Canvas quiz and discussion details use their documented read endpoints", async () => {
  const paths: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith("/planner/items")) return Response.json([{ ...item(1), plannable_type: "quiz" }, { ...item(2), plannable_type: "discussion_topic" }]);
    if (url.pathname.includes("/quizzes/")) return Response.json({ description: "Review chapters 1 and 2.", time_limit: 30, question_count: 12, allowed_attempts: 2 });
    return Response.json({ message: "<p>Discuss the reading.</p>", attachments: [{ display_name: "Reading PDF", url: "https://school.instructure.com/files/7/download" }] });
  };
  const assignments = await canvas.readAssignments(canvasSession(), window);
  assert.ok(paths.includes("/api/v1/courses/10/quizzes/1"));
  assert.ok(paths.includes("/api/v1/courses/10/discussion_topics/2"));
  assert.equal(assignments[0].details?.timeLimitMinutes, 30);
  assert.equal(assignments[0].details?.questionCount, 12);
  assert.equal(assignments[0].details?.allowedAttempts, 2);
  assert.equal(assignments[1].description, "Discuss the reading.");
  assert.equal(assignments[1].details?.attachments?.[0].title, "Reading PDF");
});

test("Gmail progress uses the known unique body total after listing and reveals no email contents", async () => {
  const progress: PlanningProgress[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json(url.searchParams.has("pageToken") ? { messages: [{ id: "one" }, { id: "two" }] } : { messages: [{ id: "one" }], nextPageToken: "second-page" });
    return Response.json(mail(url.pathname.split("/").at(-1)!));
  };
  const result = await google.readAcademicEmails(googleSession(), event => progress.push(event));
  assert.equal(result.emails.length, 2);
  const bodyProgress = progress.filter(event => event.status === "running" && event.total !== undefined);
  assert.deepEqual(bodyProgress.map(event => [event.completed, event.total]), [[0, 2], [1, 2], [2, 2]]);
  assert.equal(progress.at(-1)?.status, "complete");
  assert.match(progress.at(-1)?.detail || "", /2 emails included/);
  assert.doesNotMatch(JSON.stringify(progress), /Private subject|Homework instructions|test-google-access/);
});

test("Gmail skipped bodies count as checked and preserve an honest incomplete coverage notice", async () => {
  const progress: PlanningProgress[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "large" }, { id: "usable" }] });
    return Response.json(mail(url.pathname.split("/").at(-1)!, url.pathname.endsWith("large") ? "x".repeat(121_000) : "Useful instructions"));
  };
  const result = await google.readAcademicEmails(googleSession(), event => progress.push(event));
  assert.equal(result.emails.length, 1);
  assert.equal(progress.at(-1)?.completed, 2);
  assert.equal(progress.at(-1)?.total, 2);
  assert.match(progress.at(-1)?.detail || "", /1 emails included; coverage may be incomplete/);
});

test("Calendar page counts reflect processed items while identifying actual busy events", async () => {
  const progress: PlanningProgress[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    return Response.json(url.searchParams.has("pageToken") ? { items: [busy("third")] } : { items: [busy("first"), { ...busy("transparent"), transparency: "transparent" }], nextPageToken: "page-two" });
  };
  const events = await google.readCalendarEvents(googleSession(), window, "America/Los_Angeles", event => progress.push(event));
  assert.equal(events.length, 2);
  assert.deepEqual(progress.map(event => event.completed), [0, 2, 3, 3]);
  assert.ok(progress.slice(0, -1).every(event => event.total === undefined));
  assert.equal(progress.at(-1)?.total, 3);
  assert.match(progress.at(-1)?.detail || "", /2 busy events/);
  assert.doesNotMatch(JSON.stringify(progress), /Private event title|test-google-access/);
});

test("partial source snapshots publish Calendar before slower Gmail and mark unconnected Canvas skipped", { timeout: 2_000 }, async () => {
  await session.saveGoogleSession(googleSession());
  const progress: PlanningProgress[] = [];
  const snapshots: SourceData[] = [];
  let releaseMail!: () => void;
  const mailGate = new Promise<void>(resolve => { releaseMail = resolve; });
  let calendarPublished!: () => void;
  const calendarReady = new Promise<void>(resolve => { calendarPublished = resolve; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/events")) return Response.json({ items: [busy("one")] });
    if (url.pathname.endsWith("/messages")) { await mailGate; return Response.json({ messages: [{ id: "one" }] }); }
    return Response.json(mail("one"));
  };
  const pending = sources.collectSources({ timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 }, window, event => progress.push(event), source => {
    snapshots.push(source);
    if (source.calendarEvents.length) calendarPublished();
  });
  await Promise.race([calendarReady, pending.then(() => assert.fail("Collection completed before Gmail was released"))]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].calendarEvents.length, 1);
  assert.deepEqual(snapshots[0].emails, []);
  assert.deepEqual(snapshots[0].assignments, []);
  releaseMail();
  const result = await pending;
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].emails.length, 0);
  assert.equal(snapshots[1].emails.length, 1);
  assert.deepEqual(snapshots[1], result);
  assert.ok(progress.some(event => event.stage === "connections" && event.status === "complete"));
  assert.ok(progress.some(event => event.stage === "canvas" && event.status === "skipped"));
});

test("display callback failures cannot fail providers or lose merged source warnings", async () => {
  await session.saveGoogleSession(googleSession());
  await session.saveCanvasSession(canvasSession());
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/events")) return Response.json({ items: [] });
    if (url.pathname.endsWith("/planner/items")) return Response.json([item(1)]);
    if (url.pathname.includes("/assignments/")) return Response.json({}, { status: 403 });
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "large" }] });
    return Response.json(mail("large", "x".repeat(121_000)));
  };
  const result = await sources.collectSources({ timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 }, window, () => { throw new Error("Viewer disconnected"); }, () => { throw new Error("Viewer disconnected"); });
  assert.equal(result.assignments.length, 1);
  assert.equal(result.collectionWarnings?.length, 2);
  assert.ok(result.collectionWarnings?.some(warning => warning.startsWith("Canvas")));
  assert.ok(result.collectionWarnings?.some(warning => warning.startsWith("Skipped 1 Gmail")));
});
