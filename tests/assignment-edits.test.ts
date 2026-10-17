import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { applyAssignmentEdits, applyPlanAssignmentEdits, assignmentDetailValues, assignmentEditKey, assignmentEditsMapSchema, assignmentEditsSchema } from "../src/lib/assignment-edits";
import type { Assignment, AssignmentEditsMap, SourceData, StudyPlan } from "../src/lib/types";

const requireForTest = createRequire(import.meta.url);
const providerPath = requireForTest.resolve("../src/components/assignment-edits-provider.tsx");
const storageKey = "zotblock-assignment-edits-v1";
const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "assignment:42", title: "Problem set", course: "Mathematics", dueAt: "2026-10-21T06:59:00Z",
  url: "https://school.instructure.com/courses/10/assignments/42", description: "Original Canvas instructions.",
  details: { pointsPossible: 10, lockedForUser: false, submissionTypes: ["online_upload"], unlockAt: null },
  ...overrides,
});
const source = (assignments: Assignment[]): SourceData => ({ assignments, emails: [], calendarEvents: [] });

function freshProvider() {
  delete requireForTest.cache[providerPath];
  return requireForTest(providerPath) as typeof import("../src/components/assignment-edits-provider");
}

function withStorage(run: (values: Map<string, string>) => void, initial?: string, blocked = false) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalProvider = requireForTest.cache[providerPath];
  const values = new Map<string, string>(initial === undefined ? [] : [[storageKey, initial]]);
  const checkAccess = () => { if (blocked) throw new Error("Browser storage is blocked"); };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem(key: string) { checkAccess(); return values.get(key) ?? null; },
    setItem(key: string, value: string) { checkAccess(); values.set(key, value); },
    removeItem(key: string) { checkAccess(); values.delete(key); },
  } });
  try { run(values); }
  finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalProvider) requireForTest.cache[providerPath] = originalProvider;
    else delete requireForTest.cache[providerPath];
  }
}

test("matching corrections attach separately while original Canvas data remains unchanged", () => {
  const original = assignment();
  const input = source([original, assignment({ id: "assignment:43" })]);
  const before = structuredClone(input);
  const edits: AssignmentEditsMap = { [assignmentEditKey(original, "live")]: { description: "Corrected instructions.", details: { pointsPossible: "0", lockedForUser: "false", lockExplanation: "" } } };
  const corrected = applyAssignmentEdits(input, edits, "live");
  assert.deepEqual(input, before);
  assert.equal(corrected.assignments[0].description, original.description);
  assert.deepEqual(corrected.assignments[0].details, original.details);
  assert.deepEqual(corrected.assignments[0].userEdits, Object.values(edits)[0]);
  assert.equal(corrected.assignments[1].userEdits, undefined);
  const plan: StudyPlan = { schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live", timeZone: "America/Los_Angeles", window: { start: "2026-10-17T07:00:00Z", end: "2026-10-24T07:00:00Z" }, orchestration: { framework: "langchain", model: "test-model" }, studyBlocks: [], unscheduledTasks: [], sourceData: input, warnings: [] };
  const correctedPlan = applyPlanAssignmentEdits(plan, edits);
  assert.deepEqual(correctedPlan.sourceData, corrected);
  assert.deepEqual(plan.sourceData, before);
  assert.equal(correctedPlan.timeZone, plan.timeZone);
  assert.equal(correctedPlan.studyBlocks, plan.studyBlocks);
});

test("corrections are isolated by Canvas school, plan mode, and assignment identity", () => {
  const first = assignment();
  const otherSchool = assignment({ url: "https://other.instructure.com/courses/10/assignments/42" });
  const otherId = assignment({ id: "assignment:43" });
  const key = assignmentEditKey(first, "live");
  assert.notEqual(key, assignmentEditKey(otherSchool, "live"));
  assert.notEqual(key, assignmentEditKey(first, "demo"));
  assert.notEqual(key, assignmentEditKey(otherId, "live"));
  const edits: AssignmentEditsMap = { [key]: { description: "Only this assignment" } };
  const corrected = applyAssignmentEdits(source([first, otherSchool, otherId]), edits, "live");
  assert.deepEqual(corrected.assignments.map(entry => entry.userEdits?.description), ["Only this assignment", undefined, undefined]);
  assert.equal(applyAssignmentEdits(source([first]), edits, "demo").assignments[0].userEdits, undefined);
});

test("reset removes previously attached corrections and recovers original facts", () => {
  const original = assignment({ userEdits: { description: "Old correction", details: { pointsPossible: "50" } } });
  const reset = applyAssignmentEdits(source([original]), {}, "live").assignments[0];
  assert.equal(reset.userEdits, undefined);
  assert.equal(reset.description, "Original Canvas instructions.");
  assert.equal(reset.details?.pointsPossible, 10);
  assert.equal(original.userEdits?.description, "Old correction");
});

test("detail display preserves zero, false, null, and intentionally empty source settings", () => {
  const values = assignmentDetailValues({ pointsPossible: 0, allowedAttempts: 0, lockedForUser: false, unlockAt: null, lockAt: null, timeLimitMinutes: 0, questionCount: 0, submissionTypes: [], allowedExtensions: [], lockExplanation: "" }, "America/Los_Angeles");
  assert.deepEqual(values, { pointsPossible: "0", allowedAttempts: "0", lockedForUser: "Not locked", unlockAt: "Not set", lockAt: "Not set", timeLimitMinutes: "0 minutes", questionCount: "0", submissionTypes: "", allowedExtensions: "", lockExplanation: "" });
  assert.equal(assignmentDetailValues({ allowedAttempts: -1 }, "UTC").allowedAttempts, "Unlimited");
  const corrections = { description: "", details: { pointsPossible: "0", lockedForUser: "false", lockExplanation: "" } };
  assert.deepEqual(assignmentEditsSchema.parse(corrections), corrections);
});

test("edit schemas reject non-text values and oversized descriptions, facts, and keys", () => {
  for (const invalid of [
    { description: false }, { description: null }, { details: { pointsPossible: 0 } },
    { details: { lockedForUser: false } }, { details: { unlockAt: null } },
    { description: "x".repeat(100_001) }, { details: { gradingType: "x".repeat(2_001) } },
  ]) assert.equal(assignmentEditsSchema.safeParse(invalid).success, false);
  assert.equal(assignmentEditsMapSchema.safeParse({ ["x".repeat(601)]: { description: "Instructions" } }).success, false);
  assert.equal(assignmentEditsMapSchema.safeParse({ assignment: { details: { pointsPossible: 0 } } }).success, false);
});

test("browser corrections save, restore in a fresh store, and persist reset", () => {
  withStorage(values => {
    const key = assignmentEditKey(assignment(), "live");
    const edits = { description: "", details: { pointsPossible: "0", lockedForUser: "false" } };
    const first = freshProvider();
    assert.deepEqual(first.getSavedAssignmentEdits(), {});
    first.saveAssignmentEdits(key, edits);
    assert.deepEqual(JSON.parse(values.get(storageKey)!), { [key]: edits });
    const restored = freshProvider();
    assert.deepEqual(restored.getSavedAssignmentEdits(), { [key]: edits });
    restored.saveAssignmentEdits(key, null);
    assert.deepEqual(restored.getSavedAssignmentEdits(), {});
    assert.deepEqual(freshProvider().getSavedAssignmentEdits(), {});
  });
});

test("invalid edits cannot overwrite existing saved corrections", () => {
  withStorage(values => {
    const provider = freshProvider();
    const key = assignmentEditKey(assignment(), "live");
    provider.saveAssignmentEdits(key, { description: "Keep this" });
    const stored = values.get(storageKey);
    assert.throws(() => provider.saveAssignmentEdits(key, { description: "x".repeat(100_001) }));
    assert.equal(values.get(storageKey), stored);
    assert.deepEqual(provider.getSavedAssignmentEdits(), { [key]: { description: "Keep this" } });
  });
});

test("corrupt browser corrections are removed without breaking subsequent edits", () => {
  for (const invalid of ["{broken", "null", JSON.stringify({ assignment: { details: { pointsPossible: 10 } } })]) {
    withStorage(values => {
      const provider = freshProvider();
      assert.deepEqual(provider.getSavedAssignmentEdits(), {});
      assert.equal(values.has(storageKey), false);
      provider.saveAssignmentEdits("new-assignment", { description: "New instructions" });
      assert.deepEqual(provider.getSavedAssignmentEdits(), { "new-assignment": { description: "New instructions" } });
    }, invalid);
  }
});

test("blocked browser storage keeps corrections usable for the current visit", () => {
  withStorage(values => {
    const provider = freshProvider();
    assert.doesNotThrow(() => provider.getSavedAssignmentEdits());
    provider.saveAssignmentEdits("assignment", { description: "Visit-only instructions" });
    assert.deepEqual(provider.getSavedAssignmentEdits(), { assignment: { description: "Visit-only instructions" } });
    assert.equal(values.size, 0);
    provider.saveAssignmentEdits("assignment", null);
    assert.deepEqual(provider.getSavedAssignmentEdits(), {});
  }, undefined, true);
});
