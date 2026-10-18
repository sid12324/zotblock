import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import { completedBlocksSchema, studyBlockCompletionKey, toggleCompletedBlock } from "../src/lib/completed-blocks";
import type { StudyBlock, StudyPlan } from "../src/lib/types";

const requireForTest = createRequire(import.meta.url);
const providerPath = requireForTest.resolve("../src/components/completed-blocks-provider.tsx");
const storageKey = "zotblock-completed-blocks-v1";

function freshProvider() {
  delete requireForTest.cache[providerPath];
  return requireForTest(providerPath) as typeof import("../src/components/completed-blocks-provider");
}

function withStorage(run: (values: Map<string, string>) => void, initial?: string) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalProvider = requireForTest.cache[providerPath];
  const values = new Map<string, string>(initial === undefined ? [] : [[storageKey, initial]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  } });
  try { run(values); }
  finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalProvider) requireForTest.cache[providerPath] = originalProvider;
    else delete requireForTest.cache[providerPath];
  }
}

function block(id: string, start: string): StudyBlock {
  return { id, summary: "Study: Lab report", description: "Focused study.", start: { dateTime: start, timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-10-18T01:50:00Z", timeZone: "America/Los_Angeles" }, source: { provider: "canvas", id: "assignment-1", title: "Lab report", dueAt: "2026-10-20T06:59:00Z", url: null }, priority: "high" };
}

test("completing a study block can be undone and ignores a rescheduled copy", () => {
  const first = studyBlockCompletionKey(block("study-1", "2026-10-18T01:00:00Z"));
  const moved = studyBlockCompletionKey(block("study-1", "2026-10-19T01:00:00Z"));
  assert.notEqual(first, moved);
  const completed = toggleCompletedBlock([], first);
  assert.deepEqual(completed, [first]);
  assert.equal(completed.includes(moved), false);
  assert.deepEqual(toggleCompletedBlock(completed, first), []);
});

test("study events carry the completion key and other events do not", () => {
  const study = block("study-1", "2026-10-18T01:00:00Z");
  const plan: StudyPlan = { schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live", timeZone: "America/Los_Angeles", window: { start: "2026-10-17T07:00:00Z", end: "2026-10-21T07:00:00Z" }, orchestration: { framework: "langchain", model: "test-model" }, studyBlocks: [study], unscheduledTasks: [], sourceData: { assignments: [], emails: [], calendarEvents: [{ id: "class", summary: "Lecture", start: "2026-10-18T17:00:00Z", end: "2026-10-18T18:00:00Z" }] }, warnings: [] };
  const events = calendarEventsFromPlan(plan);
  const studyEvent = events.find(event => event.kind === "study")!;
  assert.equal(studyEvent.completionKey, studyBlockCompletionKey(study));
  assert.equal(events.find(event => event.kind === "class")!.completionKey, undefined);
  assert.equal(events.find(event => event.kind === "due")!.completionKey, undefined);
});

test("completed study blocks persist in browser storage", () => {
  withStorage(values => {
    const key = studyBlockCompletionKey(block("study-1", "2026-10-18T01:00:00Z"));
    const first = freshProvider();
    assert.deepEqual(first.getSavedCompletedBlocks(), []);
    first.toggleSavedCompletedBlock(key);
    assert.deepEqual(JSON.parse(values.get(storageKey)!), [key]);
    assert.deepEqual(freshProvider().getSavedCompletedBlocks(), [key]);
    freshProvider().toggleSavedCompletedBlock(key);
    assert.deepEqual(freshProvider().getSavedCompletedBlocks(), []);
  }, "[]");
});

test("stored completions reject values that are not a list of keys", () => {
  assert.equal(completedBlocksSchema.safeParse(["study-1@2026-10-18T01:00:00Z"]).success, true);
  assert.equal(completedBlocksSchema.safeParse({ study: true }).success, false);
  assert.equal(completedBlocksSchema.safeParse([""]).success, false);
});
