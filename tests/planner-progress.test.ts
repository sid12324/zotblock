import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { extractTasks } from "../src/lib/planner/extract";
import { scheduleTasks } from "../src/lib/planner/scheduler";
import { demoData } from "../src/lib/planner/demo";
import { assignmentEditKey } from "../src/lib/assignment-edits";
import { defaultOnboardingAnswers, preferencesFromOnboarding } from "../src/lib/preferences";
import type { PlanningProgress } from "../src/lib/progress";
import type { AcademicEmail, SourceData, StudyBlock, StudyPreferences, StudyTask } from "../src/lib/types";

type ModelTask = Omit<StudyTask, "id" | "url">;
type Batch = { emails: AcademicEmail[] };
type StubModel = { invoke: (messages: unknown) => Promise<{ tasks: ModelTask[] }> };
const modelPrototype = ChatOpenAI.prototype as unknown as { withStructuredOutput: (...args: unknown[]) => StubModel };
const originalStructuredOutput = modelPrototype.withStructuredOutput;
const originalApiKey = process.env.OPENAI_API_KEY;
const preferences: StudyPreferences = { timeZone: "America/Los_Angeles", days: 2, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
const now = "2026-10-17T16:00:00Z";
const dueAt = "2026-10-20T23:00:00Z";
const empty: SourceData = { assignments: [], emails: [], calendarEvents: [] };
const email = (id: string): AcademicEmail => ({ id, subject: `Homework ${id}`, from: "teacher@example.edu", receivedAt: now, body: "x".repeat(35_000), url: `https://mail.google.com/mail/u/0/#inbox/${id}` });
const extracted = (sourceId: string): ModelTask => ({ source: "gmail", sourceId, title: `Homework ${sourceId}`, course: "Math", dueAt, estimatedMinutes: 75, priority: "medium" });
function batchFrom(messages: unknown): Batch {
  assert.ok(Array.isArray(messages));
  const human = messages.find(message => Array.isArray(message) && message[0] === "human");
  assert.ok(Array.isArray(human));
  return JSON.parse(human[1]) as Batch;
}
function stub(invoke: StubModel["invoke"]) { modelPrototype.withStructuredOutput = () => ({ invoke }); }

const requireForTest = createRequire(import.meta.url);
const serverOnlyPath = requireForTest.resolve("server-only");
const originalServerOnly = requireForTest.cache[serverOnlyPath];
requireForTest.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} } as NodeModule;
let generateStudyPlan: typeof import("../src/lib/planner")["generateStudyPlan"];
before(async () => { ({ generateStudyPlan } = await import("../src/lib/planner")); });
after(() => {
  if (originalServerOnly) requireForTest.cache[serverOnlyPath] = originalServerOnly;
  else delete requireForTest.cache[serverOnlyPath];
});
beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-only-key-no-network";
  stub(async () => { throw new Error("Unexpected model call in progress test"); });
});
afterEach(() => {
  modelPrototype.withStructuredOutput = originalStructuredOutput;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test("extraction progress counts actual batch resolutions and distinguishes a failed batch", async () => {
  const progress: PlanningProgress[] = [];
  let calls = 0;
  stub(async messages => {
    calls++;
    const batch = batchFrom(messages);
    await new Promise<void>(resolve => setImmediate(resolve));
    if (batch.emails[0].id === "failed") throw new Error("Private upstream response");
    return { tasks: batch.emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks({ ...empty, emails: [email("one"), email("failed"), email("three"), email("four")] }, preferences, now, item => progress.push(item));
  assert.equal(calls, 4);
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(progress.filter(item => item.status === "running").map(item => item.completed), [0, 1, 2, 3, 4]);
  assert.ok(progress.every(item => item.stage === "extraction" && item.total === calls));
  assert.match(progress.at(-1)!.detail!, /3 batches analyzed; 1 failed or interrupted; 0 skipped/);
  assert.equal(progress.at(-1)!.status, "complete");
  assert.doesNotMatch(JSON.stringify(progress), /Private upstream/);
});

test("deadline-skipped extraction batches finish progress without being reported as analyzed", async context => {
  let clock = 1000;
  context.mock.method(Date, "now", () => clock);
  const progress: PlanningProgress[] = [];
  let calls = 0;
  stub(async messages => {
    calls++;
    clock += 91_000;
    return { tasks: batchFrom(messages).emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks({ ...empty, emails: Array.from({ length: 6 }, (_, index) => email(String(index))) }, preferences, now, item => progress.push(item));
  assert.equal(calls, 1);
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(progress.filter(item => item.status === "running").map(item => item.completed), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(progress.at(-1)!.completed, 6);
  assert.match(progress.at(-1)!.detail!, /1 batches analyzed; 0 failed or interrupted; 5 skipped/);
});

test("empty sources are skipped and an all-failed extraction never reports successful completion", async () => {
  const emptyProgress: PlanningProgress[] = [];
  await extractTasks(empty, preferences, now, item => emptyProgress.push(item));
  assert.deepEqual(emptyProgress.map(item => [item.status, item.completed, item.total]), [["skipped", 0, 0]]);
  const failedProgress: PlanningProgress[] = [];
  stub(async () => { throw new Error("Private upstream response"); });
  await assert.rejects(extractTasks({ ...empty, emails: [email("one")] }, preferences, now, item => failedProgress.push(item)), /model could not extract tasks/i);
  assert.equal(failedProgress.at(-1)!.completed, 1);
  assert.ok(failedProgress.every(item => item.status !== "complete"));
});

test("scheduling progress describes only the capacity-preserving final placements", () => {
  const personalized = preferencesFromOnboarding({ ...defaultOnboardingAnswers, name: "Taylor", major: "CS", wake: "13:00", sleep: "15:00", studyHours: "2", focusTime: "13:30", deadlineDays: 30 }, { ...preferences, days: 1 });
  const task: StudyTask = { id: "one", source: "canvas", sourceId: "one", title: "Problem set", course: "Math", dueAt, estimatedMinutes: 100, priority: "high", url: null };
  const progress: PlanningProgress[] = [];
  const result = scheduleTasks([task], empty, personalized, now, item => progress.push(item));
  assert.equal(result.unscheduledTasks.length, 0);
  assert.equal(result.studyBlocks[0].start.dateTime, "2026-10-17T20:00:00.000Z");
  assert.deepEqual(progress.map(item => [item.status, item.completed, item.total]), [["running", 0, 1], ["running", 1, 1], ["complete", 1, 1]]);
  assert.match(progress[1].detail!, /100 study minutes placed/);
  assert.equal(progress.at(-1)!.message, `Created ${result.studyBlocks.length} study blocks.`);
});

test("the pipeline publishes sources before final blocks and emits each final block exactly once", async () => {
  const personalized = preferencesFromOnboarding({ ...defaultOnboardingAnswers, name: "Taylor", major: "CS", wake: "13:00", sleep: "15:00", studyHours: "1.5", focusTime: "13:30", deadlineDays: 30 }, preferences);
  const order: string[] = [];
  const blocks: StudyBlock[] = [];
  const counts: [number, number][] = [];
  const progress: PlanningProgress[] = [];
  const { sources, tasks } = demoData(personalized, now);
  const expected = scheduleTasks(tasks, sources, personalized, now);
  const plan = await generateStudyPlan({ mode: "demo", preferences: personalized, now }, {
    onProgress: item => { progress.push(item); order.push(`progress:${item.stage}`); },
    onSources: value => { assert.deepEqual(value, sources); order.push("sources"); },
    onBlock: (block, completed, total) => { blocks.push(block); counts.push([completed, total]); order.push("block"); },
  });
  assert.ok(blocks.length > 0);
  assert.deepEqual(blocks, plan.studyBlocks);
  assert.deepEqual(blocks, expected.studyBlocks);
  assert.deepEqual(counts, blocks.map((_, index) => [index + 1, blocks.length]));
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.ok(order.indexOf("sources") < order.indexOf("block"));
  assert.ok(order.indexOf("sources") < order.indexOf("progress:extraction"));
  assert.equal(progress.find(item => item.stage === "extraction")!.status, "skipped");
  const withoutCallbacks = await generateStudyPlan({ mode: "demo", preferences: personalized, now });
  assert.deepEqual(plan, withoutCallbacks);
});

test("a failed progress display cannot change extraction or scheduling results", async () => {
  stub(async messages => ({ tasks: batchFrom(messages).emails.map(item => extracted(item.id)) }));
  const onProgress = () => { throw new Error("Disconnected viewer"); };
  const result = await extractTasks({ ...empty, emails: [email("one")] }, preferences, now, onProgress);
  assert.equal(result.tasks.length, 1);
  const scheduled = scheduleTasks(result.tasks, empty, preferences, now, onProgress);
  assert.equal(scheduled.unscheduledTasks.length, 0);
  assert.ok(scheduled.studyBlocks.length > 0);
  const plan = await generateStudyPlan({ mode: "demo", preferences, now }, { onProgress });
  assert.ok(plan.studyBlocks.length > 0);
});

test("saved assignment corrections reach source frames and the final plan without changing Canvas facts", async () => {
  const sample = demoData(preferences, now);
  const assignment = sample.sources.assignments[0];
  const userEdits = { description: "Updated instructions from class", details: { pointsPossible: "20", submissionTypes: "Upload a PDF" } };
  const frames: SourceData[] = [];
  const plan = await generateStudyPlan({ mode: "demo", preferences, now, assignmentEdits: { [assignmentEditKey(assignment, "demo")]: userEdits } }, { onSources: value => frames.push(value) });
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].assignments[0].userEdits, userEdits);
  assert.deepEqual(plan.sourceData.assignments[0].userEdits, userEdits);
  assert.equal(plan.sourceData.assignments[0].description, assignment.description);
  assert.equal(plan.sourceData.assignments[0].dueAt, assignment.dueAt);
  assert.ok(plan.studyBlocks.every(block => block.source.id !== assignment.id || block.source.dueAt === assignment.dueAt));
});
