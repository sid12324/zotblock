import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { exportCalendarItems } from "../src/lib/integrations/calendar-export";
import type { CalendarExportItem } from "../src/lib/calendar/export";
import type { GoogleSession } from "../src/lib/session";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalNow = Date.now;
const session: GoogleSession = { accessToken: "test-calendar-write-token", account: "student@example.edu", expiresAt: 9_999_999_999_999, enabled: ["google-calendar"], scopes: ["https://www.googleapis.com/auth/calendar.events.owned"] };
const item = (index: number, overrides: Partial<CalendarExportItem> = {}): CalendarExportItem => ({
  key: "stable-academic-item:" + index, displayIds: ["study:" + index], kind: "study",
  summary: "Study block " + index, description: "Read <chapter 1> & practice.\nKeep the full instructions.",
  start: { dateTime: "2026-11-01T01:30:00-07:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-11-01T01:30:00-08:00", timeZone: "America/Los_Angeles" },
  sourceUrl: "https://school.instructure.com/courses/10/assignments/42",
  ...overrides,
});
type WrittenEvent = {
  id: string; summary: string; description: string;
  start: CalendarExportItem["start"]; end: CalendarExportItem["end"];
  transparency: string; attendees?: unknown;
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
};
const readBody = (options?: RequestInit) => JSON.parse(String(options?.body)) as WrittenEvent;

beforeEach(() => {
  Date.now = originalNow;
  console.warn = () => {};
  globalThis.fetch = async () => { throw new Error("Unexpected calendar export request"); };
});
after(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; Date.now = originalNow; });

test("bulk inserts use primary, exact instants, safe HTML, private markers and at most four requests", async () => {
  const items = Array.from({ length: 10 }, (_, index) => item(index));
  items[1] = item(1, { kind: "due", start: { dateTime: "2026-11-01T08:55:00Z", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-11-01T09:10:00Z", timeZone: "America/Los_Angeles" } });
  const bodies: WrittenEvent[] = [];
  let active = 0;
  let maximum = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.href, "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none");
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer test-calendar-write-token");
    assert.equal(new Headers(options?.headers).get("content-type"), "application/json");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
    bodies.push(readBody(options));
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    return Response.json({ id: "created" }, { status: 201 });
  };
  const result = await exportCalendarItems(session, items);
  assert.equal(maximum, 4);
  assert.deepEqual({ total: result.total, created: result.created, existing: result.existing, failed: result.failed, pending: result.pending }, { total: 10, created: 10, existing: 0, failed: 0, pending: 0 });
  assert.deepEqual(result.failures, []);
  assert.equal(new URL(result.calendarUrl).hostname, "calendar.google.com");
  assert.deepEqual(bodies[0].start, items[0].start);
  assert.deepEqual(bodies[0].end, items[0].end);
  assert.deepEqual(bodies[1].start, items[1].start);
  assert.deepEqual(bodies[1].end, items[1].end);
  assert.equal(bodies[0].transparency, "opaque");
  assert.equal(bodies[1].transparency, "transparent");
  assert.match(bodies[0].id, /^[a-v0-9]{65}$/);
  assert.equal(new Set(bodies.map(body => body.id)).size, 10);
  assert.equal(bodies[0].extendedProperties.private.zotblock, "1");
  assert.equal(bodies[1].extendedProperties.private.zotblockKind, "due");
  assert.match(bodies[0].extendedProperties.private.zotblockKey, /^[a-f0-9]{64}$/);
  assert.equal(bodies[0].attendees, undefined);
  assert.match(bodies[0].description, /Read &lt;chapter 1&gt; &amp; practice\.<br>Keep/);
  assert.doesNotMatch(bodies[0].description, /<chapter 1>/);
  assert.equal(bodies[0].source?.url, items[0].sourceUrl);
});

test("stable account-scoped IDs treat Google 409 responses as existing on retries", async () => {
  const saved = new Set<string>();
  const firstIds: string[] = [];
  globalThis.fetch = async (_input, options) => {
    const id = readBody(options).id;
    if (saved.has(id)) return Response.json({ error: { message: "Private conflict payload" } }, { status: 409 });
    saved.add(id);
    firstIds.push(id);
    return Response.json({ id }, { status: 201 });
  };
  const items = [item(1), item(2)];
  const first = await exportCalendarItems(session, items);
  const retry = await exportCalendarItems(session, items);
  assert.equal(first.created, 2);
  assert.deepEqual({ created: retry.created, existing: retry.existing, failed: retry.failed, pending: retry.pending }, { created: 0, existing: 2, failed: 0, pending: 0 });
  assert.equal(saved.size, 2);
  await exportCalendarItems({ ...session, account: "other-student@example.edu" }, [item(1)]);
  assert.equal(saved.size, 3);
  assert.ok(firstIds[2] !== firstIds[0]);
  assert.doesNotMatch(JSON.stringify(retry), /Private conflict payload|test-calendar-write-token/);
});

test("a lost response can be retried safely when Google had already created the event", async () => {
  const saved = new Set<string>();
  globalThis.fetch = async (_input, options) => {
    const id = readBody(options).id;
    if (saved.has(id)) return Response.json({}, { status: 409 });
    saved.add(id);
    throw new Error("Untrusted transport message with token-secret");
  };
  const first = await exportCalendarItems(session, [item(1)]);
  assert.equal(first.failed, 1);
  assert.equal(first.created, 0);
  const retry = await exportCalendarItems(session, [item(1)]);
  assert.equal(retry.existing, 1);
  assert.equal(retry.failed, 0);
  assert.equal(saved.size, 1);
  assert.doesNotMatch(JSON.stringify(first), /Untrusted transport|token-secret/);
});

test("recoverable individual errors preserve successful writes and continue the remaining queue", async () => {
  globalThis.fetch = async (_input, options) => readBody(options).summary === "Study block 2"
    ? Response.json({ error: { message: "Private upstream content and access-token-value" } }, { status: 500 })
    : Response.json({}, { status: 201 });
  const result = await exportCalendarItems(session, Array.from({ length: 7 }, (_, index) => item(index)));
  assert.deepEqual({ total: result.total, created: result.created, existing: result.existing, failed: result.failed, pending: result.pending }, { total: 7, created: 6, existing: 0, failed: 1, pending: 0 });
  assert.equal(result.failures[0].title, "Study block 2");
  assert.equal(result.failures[0].code, "UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(result), /Private upstream|access-token-value/);
});

test("auth, scope and rate failures stop queued writes while counting successful in-flight requests", async () => {
  for (const scenario of [
    { status: 401, reason: "authError", code: "AUTH_REQUIRED" },
    { status: 403, reason: "insufficientPermissions", code: "INSUFFICIENT_SCOPE" },
    { status: 429, reason: "rateLimitExceeded", code: "RATE_LIMITED" },
  ]) {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return Response.json({ error: { errors: [{ reason: scenario.reason }], message: "Do not expose provider messages" } }, { status: scenario.status });
      await gate;
      return Response.json({}, { status: 201 });
    };
    const pending = exportCalendarItems(session, Array.from({ length: 10 }, (_, index) => item(index)));
    await new Promise<void>(resolve => setImmediate(resolve));
    release();
    const result = await pending;
    assert.equal(calls, 4, scenario.code);
    assert.deepEqual({ total: result.total, created: result.created, failed: result.failed, pending: result.pending }, { total: 10, created: 3, failed: 1, pending: 6 });
    assert.equal(result.failures[0].code, scenario.code);
    if (scenario.code !== "RATE_LIMITED") assert.equal(result.failures[0].actionUrl, "/api/auth/google?provider=google-calendar&access=export&returnTo=calendar");
    assert.doesNotMatch(JSON.stringify(result), /Do not expose provider messages/);
  }
});

test("the total write budget leaves unstarted items pending rather than claiming failures or successes", async () => {
  let now = 1_000;
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    now += 120_001;
    return Response.json({}, { status: 201 });
  };
  const result = await exportCalendarItems(session, Array.from({ length: 8 }, (_, index) => item(index)));
  assert.equal(calls, 1);
  assert.deepEqual({ created: result.created, existing: result.existing, failed: result.failed, pending: result.pending }, { created: 1, existing: 0, failed: 0, pending: 7 });
  assert.deepEqual(result.failures, []);
});

test("escaped descriptions stay bounded without splitting Unicode or entities and keep their source first", async () => {
  let body!: WrittenEvent;
  globalThis.fetch = async (_input, options) => {
    body = readBody(options);
    return Response.json({}, { status: 201 });
  };
  const source = "https://school.instructure.com/courses/10/assignments/42";
  const result = await exportCalendarItems(session, [item(1, { description: "Source: " + source + "\n\n" + "<&>📚\n".repeat(5_000) })]);
  assert.equal(result.created, 1);
  assert.ok(body.description.length <= 8_000);
  assert.ok(body.description.startsWith("Source: " + source + "<br><br>"));
  assert.match(body.description, /Details shortened by ZotBlock/);
  assert.ok(body.description.includes("&lt;&amp;&gt;📚<br>"));
  assert.ok(!body.description.includes("\uFFFD"));
  assert.ok(!body.description.includes("<&>"));
  assert.equal(body.source?.url, source);
  const beforeNotice = body.description.split("<br><br>[Details shortened")[0];
  assert.ok(!/&(?:a(?:m(?:p)?)?|l(?:t)?|g(?:t)?)?$/.test(beforeNotice), "The truncation boundary must not split an HTML entity");
});
