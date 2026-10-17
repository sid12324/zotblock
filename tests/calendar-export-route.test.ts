import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import type { StudyPlan } from "../src/lib/types";

const cookieValues = new Map<string, string>();
const requireForTest = createRequire(import.meta.url);
const headersPath = requireForTest.resolve("next/headers");
const originalHeaders = requireForTest.cache[headersPath];
requireForTest.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({
  get(name: string) { const value = cookieValues.get(name); return value ? { value } : undefined; },
  set(name: string, value: string) { cookieValues.set(name, value); },
  delete(name: string) { cookieValues.delete(name); },
}) } } as NodeModule;

let session: typeof import("../src/lib/session");
let route: typeof import("../src/app/api/calendar/export/route");
const environment = { SESSION_SECRET: process.env.SESSION_SECRET, APP_URL: process.env.APP_URL };
const originalFetch = globalThis.fetch;

before(async () => {
  [session, route] = await Promise.all([import("../src/lib/session"), import("../src/app/api/calendar/export/route")]);
});
beforeEach(() => {
  cookieValues.clear();
  process.env.SESSION_SECRET = "calendar-export-route-test-secret-longer-than-thirty-two";
  process.env.APP_URL = "http://localhost:3000";
  globalThis.fetch = async () => { throw new Error("Unexpected provider request"); };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (originalHeaders) requireForTest.cache[headersPath] = originalHeaders;
  else delete requireForTest.cache[headersPath];
});

function plan(): StudyPlan {
  return {
    schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live", timeZone: "America/Los_Angeles",
    window: { start: "2026-10-17T07:00:00Z", end: "2026-10-25T07:00:00Z" },
    orchestration: { framework: "langchain", model: "test" }, warnings: [], unscheduledTasks: [],
    sourceData: {
      assignments: [{ id: "assignment-1", title: "Lab report", course: "Biology", dueAt: "2026-10-21T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/1", description: "Use the worksheet." }],
      emails: [], calendarEvents: [{ id: "already-in-google", summary: "Office hours", start: "2026-10-18T17:00:00Z", end: "2026-10-18T18:00:00Z" }],
    },
    studyBlocks: [{ id: "study-1", summary: "Study: Lab report", description: "Focused study.", priority: "high",
      start: { dateTime: "2026-10-18T06:30:00Z", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-10-18T08:30:00Z", timeZone: "America/Los_Angeles" },
      source: { provider: "canvas", id: "assignment-1", title: "Lab report", dueAt: "2026-10-21T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/1" },
    }],
  };
}

function request(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/calendar/export", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function connect(write = true) {
  await session.saveGoogleSession({ accessToken: "test-access-token", refreshToken: "test-refresh-token", expiresAt: Date.now() + 3_600_000,
    account: "student@example.edu", scopes: [`https://www.googleapis.com/auth/calendar.events.${write ? "owned" : "readonly"}`], enabled: ["google-calendar"],
  });
}

test("export rejects cross-origin requests before reading accounts or calling Google", async () => {
  await connect();
  const response = await route.POST(request({ plan: plan(), scope: "all" }, "https://unrelated.example"));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("missing connection and read-only sessions offer the explicit export permission flow without writes", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No provider call expected"); };
  const missing = await route.POST(request({ plan: plan(), scope: "all" }));
  assert.equal(missing.status, 401);
  const missingBody = await missing.json();
  assert.equal(missingBody.code, "AUTH_REQUIRED");
  assert.equal(missingBody.actionUrl, "/api/auth/google?provider=google-calendar&access=export&returnTo=calendar");
  await connect(false);
  const readOnly = await route.POST(request({ plan: plan(), scope: "all" }));
  assert.equal(readOnly.status, 403);
  assert.equal((await readOnly.json()).code, "INSUFFICIENT_SCOPE");
  assert.equal(calls, 0);
});

test("bulk API exports the complete validated academic plan and skips duplicates on retry", async () => {
  await connect();
  const saved = new Set<string>();
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/calendar/v3/calendars/primary/events");
    assert.equal(url.searchParams.get("sendUpdates"), "none");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    payloads.push(body);
    const id = String(body.id);
    if (saved.has(id)) return new Response(null, { status: 409 });
    saved.add(id);
    return Response.json({ id });
  };
  const response = await route.POST(request({ plan: plan(), scope: "all" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual([result.total, result.created, result.existing, result.failed, result.pending], [2, 2, 0, 0, 0]);
  assert.equal(payloads.length, 2);
  assert.ok(payloads.every(payload => !Object.hasOwn(payload, "attendees")));
  assert.equal(payloads.some(payload => payload.summary === "Office hours"), false);
  const repeated = await route.POST(request({ plan: plan(), scope: "all" }));
  const repeatedResult = await repeated.json();
  assert.deepEqual([repeatedResult.total, repeatedResult.created, repeatedResult.existing], [2, 0, 2]);
  assert.equal(saved.size, 2);
});

test("single-item API exports one full overnight block and refuses unknown or Google event IDs", async () => {
  await connect();
  const input = plan();
  const events = calendarEventsFromPlan(input);
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => { payloads.push(JSON.parse(String(init?.body))); return Response.json({ id: "saved" }); };
  const segments = events.filter(event => event.kind === "study");
  assert.equal(segments.length, 2);
  const response = await route.POST(request({ plan: input, scope: "selected", selectedId: segments[1].id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].start, { dateTime: "2026-10-18T06:30:00Z", timeZone: input.timeZone });
  assert.deepEqual(payloads[0].end, { dateTime: "2026-10-18T08:30:00Z", timeZone: input.timeZone });
  for (const selectedId of ["unknown", events.find(event => event.kind === "class")!.id]) {
    const invalid = await route.POST(request({ plan: input, scope: "selected", selectedId }));
    assert.equal(invalid.status, 400);
  }
  assert.equal(payloads.length, 1);
});

test("invalid plans, missing selections and arbitrary calendar destinations cannot reach writes", async () => {
  await connect();
  const input = plan();
  input.studyBlocks[0].end.dateTime = input.studyBlocks[0].start.dateTime;
  for (const body of [{ plan: input, scope: "all" }, { plan: plan(), scope: "selected" }, { plan: plan(), scope: "all", calendarId: "someone-else" }]) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
});
