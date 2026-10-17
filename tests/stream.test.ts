import assert from "node:assert/strict";
import test from "node:test";
import { readPlanningStream } from "../src/lib/planner/stream";
import { demoData } from "../src/lib/planner/demo";
import { scheduleTasks } from "../src/lib/planner/scheduler";
import type { PlanningStreamEvent } from "../src/lib/progress";
import type { StudyPlan, StudyPreferences } from "../src/lib/types";

const encoder = new TextEncoder();
const preferences: StudyPreferences = { timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
const now = "2026-10-17T16:00:00Z";
const { sources, tasks } = demoData(preferences, now);
sources.emails[0].body += "\nCañón — study 🧠 中文.";
const plan: StudyPlan = {
  schemaVersion: "1.0", generatedAt: now, mode: "demo", timeZone: preferences.timeZone, preferences,
  orchestration: { framework: "langchain", model: null }, ...scheduleTasks(tasks, sources, preferences, now),
  sourceData: sources, warnings: [],
};
const progress: PlanningStreamEvent = { type: "progress", progress: { stage: "gmail", status: "running", message: "Reading 📨 academic email — Cañón", completed: 2, total: 3 } };
const sourceFrame: PlanningStreamEvent = { type: "sources", sources };
const blockFrame: PlanningStreamEvent = { type: "block", block: plan.studyBlocks[0], completed: 1, total: plan.studyBlocks.length };
const complete: PlanningStreamEvent = { type: "complete", plan };
const terminalError: PlanningStreamEvent = { type: "error", error: "Reconnect Google Calendar and approve access.", code: "insufficientPermissions", actionUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" };
const json = (value: unknown) => JSON.stringify(value);

function responseFrom(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}
const responseText = (value: string) => responseFrom([encoder.encode(value)]);
async function safeFailure(value: string) {
  const received: PlanningStreamEvent[] = [];
  await assert.rejects(readPlanningStream(responseText(value), event => received.push(event)), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /planning update could not be read|connection ended before|continued after/i);
    assert.doesNotMatch(error.message, /PRIVATE_SOURCE_BODY|Cañón|recorded samples|Problem set/);
    return true;
  });
  return received;
}

test("stream parsing preserves UTF-8 source text across arbitrary single-byte network boundaries", async () => {
  const frames = [progress, sourceFrame, blockFrame, complete];
  const bytes = encoder.encode(frames.map(json).join("\n") + "\n");
  const chunks = Array.from(bytes, byte => new Uint8Array([byte]));
  const received: PlanningStreamEvent[] = [];
  await readPlanningStream(responseFrom(chunks), event => received.push(event));
  assert.deepEqual(received, frames);
  assert.ok((received[1] as typeof sourceFrame).sources.emails[0].body.includes("🧠 中文"));
});

test("multiple frames, CRLF, whitespace heartbeats, and a final line without newline are accepted", async () => {
  const frames = [progress, sourceFrame, blockFrame, complete];
  const received: PlanningStreamEvent[] = [];
  await readPlanningStream(responseText(`\n\r\n  \n${frames.map(json).join("\r\n\n")}\r`), event => received.push(event));
  assert.deepEqual(received, frames);
});

test("a terminal plan is delivered immediately but stream completion still requires clean EOF", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
  const received: PlanningStreamEvent[] = [];
  let finished = false;
  const parsing = readPlanningStream(response, event => received.push(event)).then(() => { finished = true; });
  controller.enqueue(encoder.encode(`${json(complete)}\n\n`));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(received, [complete]);
  assert.equal(finished, false);
  controller.close();
  await parsing;
  assert.equal(finished, true);
});

test("missing bodies, unfinished plans, and truncated frames reject instead of accepting partial output", async () => {
  await assert.rejects(readPlanningStream(new Response(null), () => undefined), /updates are unavailable/i);
  for (const value of ["", "\n  \r\n", `${json(progress)}\n`, `${json(sourceFrame)}\n${json(complete).slice(0, -30)}`]) {
    await safeFailure(value);
  }
});

test("malformed frames and invalid source, block, progress, and plan fields fail with safe errors", async () => {
  const invalid: unknown[] = [
    { type: "unknown", body: "PRIVATE_SOURCE_BODY" },
    { type: "sources", sources: { ...sources, emails: [{ ...sources.emails[0], subject: "PRIVATE_SOURCE_BODY", body: "PRIVATE_SOURCE_BODY", receivedAt: "not-a-date" }] } },
    { ...blockFrame, block: { ...plan.studyBlocks[0], end: plan.studyBlocks[0].start } },
    { ...blockFrame, completed: 3, total: 2 },
    { type: "progress", progress: { stage: "private-stage", status: "running", message: "PRIVATE_SOURCE_BODY" } },
    { type: "progress", progress: { stage: "extraction", status: "running", message: "PRIVATE_SOURCE_BODY", completed: 3, total: 2 } },
    { type: "progress", progress: { stage: "extraction", status: "running", message: "PRIVATE_SOURCE_BODY", completed: -1 } },
    { type: "complete", plan: { ...plan, window: { start: now, end: now } } },
  ];
  for (const frame of invalid) {
    const received = await safeFailure(`${json(frame)}\n${json(complete)}\n`);
    assert.equal(received.length, 0, `Invalid ${String((frame as { type: string }).type)} frame must not reach the UI`);
  }
  assert.deepEqual(await safeFailure('{"type":"sources","PRIVATE_SOURCE_BODY":invalid-json}\n'), []);
});

test("a terminal error frame preserves its actionable fields and needs no complete plan", async () => {
  const received: PlanningStreamEvent[] = [];
  await readPlanningStream(responseText(`${json(progress)}\n${json(terminalError)}\n\n`), event => received.push(event));
  assert.deepEqual(received, [progress, terminalError]);
});

test("frames after either terminal event are rejected and never delivered to the UI", async () => {
  for (const terminal of [complete, terminalError]) {
    const received = await safeFailure(`${json(terminal)}\n${json(sourceFrame)}\n`);
    assert.deepEqual(received, [terminal]);
  }
});

test("callback failure cancels the active reader and preserves the original error", async () => {
  let cancelled = false;
  let delivered = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${json(progress)}\n${json(sourceFrame)}\n`)); },
    cancel() { cancelled = true; return Promise.reject(new Error("Secondary cancellation failure")); },
  }));
  const failure = new Error("The viewer was disposed");
  await assert.rejects(readPlanningStream(response, () => { delivered++; throw failure; }), error => error === failure);
  assert.equal(delivered, 1);
  assert.equal(cancelled, true);
  assert.equal(response.body!.locked, false);
});
