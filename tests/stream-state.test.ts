import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearGeneration, getGenerationSnapshot, startGeneration } from "../src/components/generation-provider";
import type { PlanningStreamEvent } from "../src/lib/progress";
import type { StudyPlan, StudyPreferences } from "../src/lib/types";

const preferences: StudyPreferences = { timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
const storageKey = "studyflow-plan";
const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
let saved: Map<string, string>;
let writes: { key: string; value: string }[];
type ControlledStream = {
  response: Response;
  send: (event: PlanningStreamEvent) => void;
  text: (value: string) => void;
  end: () => void;
  readonly cancelled: boolean;
};
let activeStreams: ControlledStream[];

function fixture(label: string, mode: StudyPlan["mode"] = "demo"): StudyPlan {
  const dueAt = "2026-10-20T06:59:00Z";
  return {
    schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode, timeZone: preferences.timeZone, preferences,
    window: { start: "2026-10-17T07:00:00Z", end: "2026-10-24T07:00:00Z" },
    orchestration: { framework: "langchain", model: mode === "demo" ? null : "test-model" },
    studyBlocks: [0, 1].map(index => ({
      id: `${label}-block-${index}`, summary: `Study ${label}`, description: "50 minutes of focused study.",
      start: { dateTime: `2026-10-17T${index ? "18" : "16"}:00:00Z`, timeZone: preferences.timeZone },
      end: { dateTime: `2026-10-17T${index ? "18" : "16"}:50:00Z`, timeZone: preferences.timeZone },
      source: { provider: "canvas", id: `${label}-assignment`, title: `Assignment ${label}`, dueAt, url: null },
      priority: "high",
    })),
    unscheduledTasks: [], warnings: [], sourceData: {
      assignments: [{ id: `${label}-assignment`, title: `Assignment ${label}`, course: "Math", dueAt, url: null, description: `Instructions ${label}` }],
      emails: [], calendarEvents: [{ id: `${label}-calendar`, summary: `Class ${label}`, start: "2026-10-18T17:00:00Z", end: "2026-10-18T18:00:00Z" }],
    },
  };
}

function controlledStream(): ControlledStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { ended = true; cancelled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  const stream = {
    response,
    send(event: PlanningStreamEvent) { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); },
    text(value: string) { controller.enqueue(encoder.encode(value)); },
    end() { if (!ended) { ended = true; controller.close(); } },
    get cancelled() { return cancelled; },
  };
  activeStreams.push(stream);
  return stream;
}

async function turn() { await new Promise<void>(resolve => setImmediate(resolve)); }
async function until(predicate: () => boolean, description: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await turn();
  }
  assert.fail(`Timed out waiting for ${description}`);
}
function cached(plan: StudyPlan) { saved.set(storageKey, JSON.stringify(plan)); }
function mockStreamResponse(stream: ControlledStream) {
  globalThis.fetch = async () => stream.response;
}

beforeEach(() => {
  clearGeneration();
  assert.equal(getGenerationSnapshot().running, false);
  saved = new Map();
  writes = [];
  activeStreams = [];
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push({ key, value }); saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  } });
  globalThis.fetch = async () => { throw new Error("Unexpected network request in stream-state test"); };
});
afterEach(async () => {
  activeStreams.forEach(stream => stream.end());
  await until(() => !getGenerationSnapshot().running, "active generation cleanup");
  clearGeneration();
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

test("generation starts immediately, keeps same-mode busy events, and cannot be cleared or restarted while running", async () => {
  const previous = fixture("previous", "live");
  cached(previous);
  const stream = controlledStream();
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    assert.equal(new Headers(init?.headers).get("accept"), "application/x-ndjson");
    assert.deepEqual(JSON.parse(String(init?.body)), { mode: "live", preferences, assignmentEdits: {} });
    return stream.response;
  };
  startGeneration("live", preferences, previous);
  const initial = getGenerationSnapshot();
  assert.equal(initial.running, true);
  assert.equal(initial.mode, "live");
  assert.ok(initial.jobId);
  assert.equal(initial.stages.connections?.status, "running");
  assert.deepEqual(initial.preview?.sourceData.calendarEvents, previous.sourceData.calendarEvents);
  assert.deepEqual(initial.preview?.sourceData.assignments, []);
  assert.deepEqual(initial.preview?.studyBlocks, []);
  clearGeneration();
  assert.equal(getGenerationSnapshot(), initial);
  startGeneration("demo", preferences);
  assert.equal(requests, 1);
  stream.send({ type: "error", error: "The provider could not be read." });
  stream.end();
  await until(() => !getGenerationSnapshot().running, "failed generation");
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
  assert.equal(writes.length, 0);
  clearGeneration();
  assert.equal(getGenerationSnapshot().jobId, null);
  assert.equal(getGenerationSnapshot().preview, null);
});

test("progress, sources, and blocks appear before completion but only clean final output is persisted once", async () => {
  const previous = fixture("previous");
  const final = fixture("new");
  cached(previous);
  const stream = controlledStream();
  mockStreamResponse(stream);
  startGeneration("demo", preferences, previous);
  stream.send({ type: "progress", progress: { stage: "canvas", status: "running", message: "Reading assignments", completed: 2, total: 4 } });
  await until(() => getGenerationSnapshot().stages.canvas?.completed === 2, "provider progress");
  assert.equal(getGenerationSnapshot().activity.at(-1)?.message, "Reading assignments");
  stream.send({ type: "sources", sources: final.sourceData });
  await until(() => getGenerationSnapshot().preview?.sourceData.assignments[0]?.id === "new-assignment", "source preview");
  stream.send({ type: "block", block: final.studyBlocks[0], completed: 1, total: 2 });
  await until(() => getGenerationSnapshot().completedBlocks === 1, "first block preview");
  assert.equal(getGenerationSnapshot().running, true);
  assert.deepEqual(getGenerationSnapshot().preview?.studyBlocks, [final.studyBlocks[0]]);
  assert.equal(getGenerationSnapshot().totalBlocks, 2);
  assert.equal(writes.length, 0);
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
  stream.send({ type: "block", block: final.studyBlocks[1], completed: 2, total: 2 });
  await until(() => getGenerationSnapshot().completedBlocks === 2, "second block preview");
  stream.send({ type: "complete", plan: final });
  await turn();
  assert.equal(getGenerationSnapshot().running, true, "a terminal frame still needs clean EOF");
  assert.equal(writes.length, 0, "an unfinished response cannot replace the completed plan");
  stream.end();
  await until(() => !getGenerationSnapshot().running, "clean final completion");
  assert.equal(getGenerationSnapshot().error, null);
  assert.deepEqual(getGenerationSnapshot().preview, final);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, storageKey);
  assert.deepEqual(JSON.parse(writes[0].value), final);
});

test("provider errors preserve the last completed plan and leave the incomplete preview visible", async () => {
  const previous = fixture("previous", "live");
  const partial = fixture("partial", "live");
  cached(previous);
  const stream = controlledStream();
  mockStreamResponse(stream);
  startGeneration("live", preferences, previous);
  stream.send({ type: "sources", sources: partial.sourceData });
  stream.send({ type: "block", block: partial.studyBlocks[0], completed: 1, total: 2 });
  await until(() => getGenerationSnapshot().completedBlocks === 1, "incomplete study preview");
  const actionUrl = "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com";
  stream.send({ type: "error", error: "Enable Google Calendar API.", code: "SERVICE_DISABLED", actionUrl });
  stream.end();
  await until(() => !getGenerationSnapshot().running, "provider failure");
  const state = getGenerationSnapshot();
  assert.equal(state.error, "Enable Google Calendar API.");
  assert.equal(state.actionUrl, actionUrl);
  assert.deepEqual(state.preview?.sourceData, partial.sourceData);
  assert.deepEqual(state.preview?.studyBlocks, [partial.studyBlocks[0]]);
  assert.equal(writes.length, 0);
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
});

test("a truncated stream retains both its partial preview and the last completed cached plan", async () => {
  const previous = fixture("previous");
  const partial = fixture("partial");
  cached(previous);
  const stream = controlledStream();
  mockStreamResponse(stream);
  startGeneration("demo", preferences, previous);
  stream.send({ type: "sources", sources: partial.sourceData });
  stream.send({ type: "block", block: partial.studyBlocks[0], completed: 1, total: 2 });
  await until(() => getGenerationSnapshot().completedBlocks === 1, "partial preview");
  stream.end();
  await until(() => !getGenerationSnapshot().running, "truncated stream failure");
  assert.match(getGenerationSnapshot().error!, /connection ended before/i);
  assert.equal(getGenerationSnapshot().preview?.studyBlocks.length, 1);
  assert.equal(writes.length, 0);
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
});

test("a frame after a terminal plan cannot replace the last completed cached plan", async () => {
  const previous = fixture("previous");
  const invalidFinal = fixture("invalid-final");
  cached(previous);
  const stream = controlledStream();
  mockStreamResponse(stream);
  startGeneration("demo", preferences, previous);
  stream.send({ type: "complete", plan: invalidFinal });
  await turn();
  assert.equal(writes.length, 0);
  assert.equal(getGenerationSnapshot().running, true);
  stream.send({ type: "progress", progress: { stage: "scheduling", status: "complete", message: "Unexpected extra frame" } });
  stream.end();
  await until(() => !getGenerationSnapshot().running, "terminal protocol failure");
  assert.match(getGenerationSnapshot().error!, /continued after/i);
  assert.equal(writes.length, 0);
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
});

test("live and demo generations never reuse each other's previous calendar events", async () => {
  for (const mode of ["demo", "live"] as const) {
    const previous = fixture("opposite-mode", mode === "demo" ? "live" : "demo");
    const stream = controlledStream();
    mockStreamResponse(stream);
    startGeneration(mode, preferences, previous);
    assert.deepEqual(getGenerationSnapshot().preview?.sourceData, { assignments: [], emails: [], calendarEvents: [] });
    assert.deepEqual(getGenerationSnapshot().preview?.studyBlocks, []);
    stream.send({ type: "error", error: "Stop this test generation." });
    stream.end();
    await until(() => !getGenerationSnapshot().running, "generation cleanup");
    clearGeneration();
  }
});

test("out-of-order streamed blocks fail safely before corrupting the preview or cache", async () => {
  const previous = fixture("previous");
  const partial = fixture("partial");
  cached(previous);
  const stream = controlledStream();
  mockStreamResponse(stream);
  startGeneration("demo", preferences, previous);
  stream.send({ type: "block", block: partial.studyBlocks[1], completed: 2, total: 2 });
  await until(() => !getGenerationSnapshot().running, "out-of-order block rejection");
  assert.match(getGenerationSnapshot().error!, /out of order/i);
  assert.deepEqual(getGenerationSnapshot().preview?.studyBlocks, []);
  assert.equal(stream.cancelled, true);
  assert.equal(writes.length, 0);
  assert.equal(saved.get(storageKey), JSON.stringify(previous));
});
