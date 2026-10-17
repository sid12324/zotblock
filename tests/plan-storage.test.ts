import assert from "node:assert/strict";
import test from "node:test";
import { isStudyPlan, restoreSavedPlan, savePlan } from "../src/components/plan-provider";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import type { StudyPlan } from "../src/lib/types";

function plan(): StudyPlan {
  return {
    schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live",
    timeZone: "America/Los_Angeles",
    window: { start: "2026-10-17T07:00:00Z", end: "2026-10-24T07:00:00Z" },
    orchestration: { framework: "langchain", model: "test-model" },
    studyBlocks: [{
      id: "study:one", summary: "Study problem set", description: "Work through the problems.",
      start: { dateTime: "2026-10-17T16:00:00Z", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-10-17T16:50:00Z", timeZone: "America/Los_Angeles" },
      source: { provider: "canvas", id: "assignment:one", title: "Problem set", dueAt: "2026-10-20T06:59:00Z", url: null },
      priority: "high",
    }],
    unscheduledTasks: [{
      task: { id: "gmail:one", source: "gmail", sourceId: "email:one", title: "Quiz review", course: "Math", dueAt: "2026-10-21T19:00:00Z", estimatedMinutes: 60, priority: "medium", url: "https://mail.google.com/mail/u/0/#inbox/one" },
      remainingMinutes: 60, reason: "No free time before the deadline.",
    }],
    sourceData: {
      assignments: [{ id: "assignment:one", title: "Problem set", course: "Math", dueAt: "2026-10-20T06:59:00Z", url: null, description: "Complete the assigned problems." }],
      emails: [{ id: "email:one", subject: "Upcoming quiz", from: "instructor@example.edu", receivedAt: "2026-10-16T19:00:00Z", body: "Review the course notes.", url: "https://mail.google.com/mail/u/0/#inbox/one" }],
      calendarEvents: [{ id: "event:one", summary: "Class", start: "2026-10-17T18:00:00Z", end: "2026-10-17T19:00:00Z" }],
    },
    warnings: [],
  };
}

function storage(stored: string | null) {
  const removed: string[] = [];
  return { getItem: () => stored, removeItem: (key: string) => { removed.push(key); }, removed };
}

test("complete plans from the previous schema restore and render without optional new fields", () => {
  const original = plan();
  const saved = storage(JSON.stringify(original));
  const result = restoreSavedPlan(saved);
  assert.equal(isStudyPlan(original), true);
  assert.deepEqual(result, { plan: original, ready: true, storageNotice: null });
  assert.equal(calendarEventsFromPlan(result.plan!).length, 4);
  assert.deepEqual(saved.removed, []);
});

test("missing nested source arrays and malformed source relationships are rejected before rendering", () => {
  const incomplete = { ...plan(), sourceData: {} };
  assert.equal(isStudyPlan(incomplete), false);
  const missingWindow = { ...plan(), window: undefined };
  assert.equal(isStudyPlan(missingWindow), false);
  const malformedBlock = plan();
  Reflect.deleteProperty(malformedBlock.studyBlocks[0], "source");
  assert.equal(isStudyPlan(malformedBlock), false);
  const malformedEmail = plan();
  Reflect.deleteProperty(malformedEmail.sourceData.emails[0], "subject");
  assert.equal(isStudyPlan(malformedEmail), false);
  const malformedTask = plan();
  malformedTask.unscheduledTasks[0].remainingMinutes = Number.NaN;
  assert.equal(isStudyPlan(malformedTask), false);
  assert.equal(isStudyPlan({ ...plan(), warnings: [null] }), false);
});

test("invalid instants, timezone identifiers, and time ranges cannot reach the calendar", () => {
  const mutations: ((input: StudyPlan) => void)[] = [
    input => { input.timeZone = "Invalid/Timezone"; },
    input => { input.generatedAt = "yesterday"; },
    input => { input.sourceData.assignments[0].dueAt = "2026-10-20"; },
    input => { input.sourceData.emails[0].receivedAt = "not-a-date"; },
    input => { input.unscheduledTasks[0].task.dueAt = "tomorrow at noon"; },
    input => { input.studyBlocks[0].end.timeZone = "Invalid/Timezone"; },
    input => { input.studyBlocks[0].source.dueAt = "2026-10-20T12:00:00"; },
    input => { input.studyBlocks[0].end.dateTime = input.studyBlocks[0].start.dateTime; },
    input => { input.sourceData.calendarEvents[0].end = "2026-10-17T17:00:00Z"; },
    input => { input.window.end = input.window.start; },
    input => { input.window.end = "2027-10-24T07:00:00Z"; },
    input => { input.studyBlocks[0].end.dateTime = "2027-10-17T16:00:00Z"; },
  ];
  for (const mutate of mutations) {
    const input = plan();
    mutate(input);
    assert.equal(isStudyPlan(input), false, mutate.toString());
  }
});

test("DST instants, optional all-day provenance, warnings, and preferences stay compatible", () => {
  const input = plan();
  input.preferences = { timeZone: input.timeZone, days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
  input.window = { start: "2026-11-01T07:00:00Z", end: "2026-11-03T08:00:00Z" };
  input.studyBlocks[0].start.dateTime = "2026-11-01T08:30:00Z";
  input.studyBlocks[0].end.dateTime = "2026-11-01T09:30:00Z";
  input.sourceData.calendarEvents = [{ id: "all-day", summary: "Campus closed", start: "2026-11-01T07:00:00Z", end: "2026-11-02T08:00:00Z", allDay: true }];
  input.sourceData.collectionWarnings = ["Inbox coverage is incomplete."];
  assert.equal(isStudyPlan(input), true);
  assert.doesNotThrow(() => calendarEventsFromPlan(input));
});

test("corrupt or obsolete cached plans are removed and replaced with a recovery notice", () => {
  for (const corrupt of ["{broken", "null", JSON.stringify({ ...plan(), sourceData: {} }), JSON.stringify({ ...plan(), schemaVersion: "0.9" })]) {
    const saved = storage(corrupt);
    const result = restoreSavedPlan(saved);
    assert.equal(result.plan, null);
    assert.equal(result.ready, true);
    assert.match(result.storageNotice!, /Generate a new plan/);
    assert.deepEqual(saved.removed, ["studyflow-plan"]);
  }
});

test("empty or blocked browser storage remains safe", () => {
  assert.deepEqual(restoreSavedPlan(storage(null)), { plan: null, ready: true, storageNotice: null });
  const blocked = { getItem() { throw new Error("Storage blocked"); }, removeItem() { throw new Error("Storage blocked"); } };
  const result = restoreSavedPlan(blocked);
  assert.equal(result.plan, null);
  assert.equal(result.ready, true);
  assert.match(result.storageNotice!, /couldn’t be loaded/);
});

test("a malformed successful API response cannot overwrite a saved plan", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { setItem() { writes++; } } });
  try {
    const invalid = { ...plan(), sourceData: {} } as StudyPlan;
    assert.throws(() => savePlan(invalid), /generated plan could not be read/);
    assert.equal(writes, 0);
    savePlan(plan());
    assert.equal(writes, 1);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
