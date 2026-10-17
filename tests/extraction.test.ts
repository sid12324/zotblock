import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { extractTasks } from "../src/lib/planner/extract";
import { defaultOnboardingAnswers, preferencesFromOnboarding } from "../src/lib/preferences";
import type { AcademicEmail, Assignment, SourceData, StudyPreferences, StudyTask } from "../src/lib/types";

type ModelTask = Omit<StudyTask, "id" | "url">;
type Batch = { assignments: Assignment[]; emails: AcademicEmail[] };
type StubModel = { invoke: (messages: unknown, options?: { signal?: AbortSignal }) => Promise<{ tasks: ModelTask[] }> };
const modelPrototype = ChatOpenAI.prototype as unknown as { withStructuredOutput: (...args: unknown[]) => StubModel };
const originalStructuredOutput = modelPrototype.withStructuredOutput;
const originalApiKey = process.env.OPENAI_API_KEY;
const preferences: StudyPreferences = { timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
const now = "2026-10-17T16:00:00Z";
const dueAt = "2026-10-20T23:00:00Z";
const email = (id: string, body = "The problem set is due October 20 at 4 PM."): AcademicEmail => ({ id, subject: `Homework ${id}`, from: "teacher@example.edu", receivedAt: now, body, url: `https://mail.google.com/mail/u/0/#inbox/${id}` });
const assignment = (id: string, title = "Problem Set 1"): Assignment => ({ id, title, course: "Math 1", dueAt, description: "Complete the assigned problems.", url: `https://school.instructure.com/courses/1/assignments/${id}` });
const sources = (emails: AcademicEmail[] = [], assignments: Assignment[] = []): SourceData => ({ emails, assignments, calendarEvents: [] });
const extracted = (sourceId: string, extra: Partial<ModelTask> = {}): ModelTask => ({ source: "gmail", sourceId, title: `Homework ${sourceId}`, course: "Math 1", dueAt, estimatedMinutes: 75, priority: "medium", ...extra });

function batchFrom(messages: unknown): Batch {
  assert.ok(Array.isArray(messages));
  const human = messages.find(message => Array.isArray(message) && message[0] === "human");
  assert.ok(Array.isArray(human));
  assert.equal(typeof human[1], "string");
  return JSON.parse(human[1]) as Batch;
}

function stub(invoke: StubModel["invoke"]) {
  modelPrototype.withStructuredOutput = () => ({ invoke });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-only-key-no-network";
  stub(async () => { throw new Error("Unexpected model request in extraction test"); });
});
afterEach(() => {
  modelPrototype.withStructuredOutput = originalStructuredOutput;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test("all onboarding answers reach LangChain while source deadlines remain authoritative", async () => {
  const answers = { ...defaultOnboardingAnswers, name: "Taylor", major: "Computer Science", studyHours: "2.5", wake: "07:30", sleep: "22:45", focusTime: "15:15", deadlineDays: 5 };
  const personalized = preferencesFromOnboarding(answers, preferences);
  let calls = 0;
  stub(async messages => {
    calls++;
    assert.ok(Array.isArray(messages));
    const system = messages.find(message => Array.isArray(message) && message[0] === "system");
    assert.ok(Array.isArray(system));
    const serialized = system[1].match(/Student study preferences and onboarding answers: (.+)\./)?.[1];
    assert.ok(serialized);
    assert.deepEqual(JSON.parse(serialized).onboardingAnswers, answers);
    assert.match(system[1], /Source identifiers, titles, and deadlines remain authoritative/);
    return { tasks: [extracted("assignment:1", { source: "canvas", dueAt: "2026-10-31T23:00:00Z" })] };
  });
  const canonical = assignment("assignment:1");
  const result = await extractTasks(sources([], [canonical]), personalized, now);
  assert.equal(calls, 1);
  assert.equal(result.tasks[0].dueAt, canonical.dueAt);
});

test("student corrections reach the model as task context while Canvas deadlines stay canonical", async () => {
  const canonical = { ...assignment("assignment:1"), details: { pointsPossible: 10 }, userEdits: {
    description: "Teacher clarified: complete problems 1–12, including a written explanation.",
    details: { pointsPossible: "20", allowedAttempts: "Two attempts", lockAt: "The teacher has extended access until Friday" },
  } };
  stub(async messages => {
    const batch = batchFrom(messages);
    assert.deepEqual(batch.assignments[0].userEdits, canonical.userEdits);
    assert.equal(batch.assignments[0].details?.pointsPossible, 10);
    assert.ok(Array.isArray(messages));
    const system = messages.find(message => Array.isArray(message) && message[0] === "system");
    assert.match(system[1], /use those student corrections/);
    assert.match(system[1], /Preserve the original Canvas dueAt/);
    return { tasks: [extracted(canonical.id, { source: "canvas", dueAt: "2026-11-01T00:00:00Z", estimatedMinutes: 200 })] };
  });
  const result = await extractTasks(sources([], [canonical]), preferences, now);
  assert.equal(result.tasks[0].dueAt, canonical.dueAt);
  assert.equal(result.tasks[0].estimatedMinutes, 200);
});

test("large Gmail collections use bounded concurrent batches and preserve every included body", async () => {
  const emails = Array.from({ length: 12 }, (_, index) => email(String(index), `Full source ${index}:\n${"Read all assigned problems. ".repeat(index === 0 ? 4000 : 1000)}\nDeadline at the end ${index}.`));
  const input = sources(emails);
  const before = JSON.stringify(input);
  assert.ok(before.length > 180_000);
  const observed = new Map<string, string>();
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  stub(async (messages, options) => {
    const batch = batchFrom(messages);
    assert.ok(JSON.stringify(batch).length <= 180_000);
    calls++;
    active++;
    maximumActive = Math.max(maximumActive, active);
    assert.ok(options?.signal instanceof AbortSignal);
    for (const item of batch.emails) {
      assert.ok(!observed.has(item.id), "an email should be sent to the model once");
      observed.set(item.id, item.body);
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    return { tasks: batch.emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks(input, preferences, now);
  assert.ok(calls > 1);
  assert.equal(maximumActive, 3);
  assert.equal(result.tasks.length, emails.length);
  assert.equal(observed.size, emails.length);
  for (const item of emails) assert.equal(observed.get(item.id), item.body);
  assert.equal(JSON.stringify(input), before);
});

test("duplicate reminders in separate batches collapse using equivalent deadline instants", async () => {
  const emails = [email("first", "a".repeat(35_000)), email("second", "b".repeat(35_000))];
  let calls = 0;
  stub(async messages => {
    calls++;
    return { tasks: batchFrom(messages).emails.map(item => extracted(item.id, {
      title: item.id === "first" ? "Reminder: Problem Set 1!" : "problem set 1",
      dueAt: item.id === "first" ? dueAt : "2026-10-20T16:00:00-07:00",
    })) };
  });
  const result = await extractTasks(sources(emails), preferences, now);
  assert.ok(calls >= 2);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].source, "gmail");
});

test("one digest retains matching titles and deadlines belonging to different courses", async () => {
  stub(async () => ({ tasks: [
    extracted("digest", { title: "Homework 1", course: "Math 1" }),
    extracted("digest", { title: "Homework 1", course: "Physics 1" }),
  ] }));
  const result = await extractTasks(sources([email("digest")]), preferences, now);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks.map(task => task.course).sort(), ["Math 1", "Physics 1"]);
});

test("Canvas keeps canonical metadata, suppresses matching Gmail work, and retains omitted assignments", async () => {
  const assignments = [assignment("assignment:1"), assignment("assignment:2", "Lab report")];
  stub(async messages => {
    const batch = batchFrom(messages);
    return { tasks: [
      ...batch.assignments.filter(item => item.id === "assignment:1").map(item => extracted(item.id, { source: "canvas", title: "Changed by model", course: "Wrong course", dueAt: "2026-10-25T00:00:00Z", estimatedMinutes: 123, priority: "high" })),
      ...batch.emails.map(item => extracted(item.id, { title: "Problem Set 1", course: "", dueAt })),
    ] };
  });
  const result = await extractTasks(sources([email("reminder")], assignments), preferences, now);
  assert.equal(result.tasks.length, 2);
  assert.ok(result.tasks.every(item => item.source === "canvas"));
  const first = result.tasks.find(item => item.sourceId === assignments[0].id)!;
  assert.equal(first.title, assignments[0].title);
  assert.equal(first.course, assignments[0].course);
  assert.equal(first.dueAt, assignments[0].dueAt);
  assert.equal(first.url, assignments[0].url);
  assert.equal(first.estimatedMinutes, 125);
  assert.equal(first.priority, "high");
  const fallback = result.tasks.find(item => item.sourceId === assignments[1].id)!;
  assert.equal(fallback.title, assignments[1].title);
  assert.equal(fallback.estimatedMinutes, 100);
  assert.ok(result.warnings.some(warning => /100.minute|estimate/i.test(warning)));
});

test("a failed extraction batch keeps successful tasks and reports incomplete coverage", async () => {
  const emails = [email("failed", "a".repeat(35_000)), email("good", "b".repeat(35_000))];
  stub(async messages => {
    const batch = batchFrom(messages);
    if (batch.emails.some(item => item.id === "failed")) throw new Error("Private upstream response must not escape sk-test-sensitive");
    return { tasks: batch.emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks(sources(emails), preferences, now);
  assert.deepEqual(result.tasks.map(item => item.sourceId), ["good"]);
  assert.ok(result.warnings.some(warning => /batch|incomplete|extract|process/i.test(warning)));
  assert.doesNotMatch(result.warnings.join(" "), /Private upstream|sk-test-sensitive/);
});

test("when every attempted extraction batch fails the request rejects safely", async () => {
  stub(async () => { throw new Error("Private upstream response sk-test-sensitive"); });
  await assert.rejects(extractTasks(sources([email("one")]), preferences, now), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /model could not extract tasks/i);
    assert.doesNotMatch(error.message, /Private upstream|sk-test-sensitive/);
    return true;
  });
});

test("oversized indivisible sources are reported without truncating them or blocking other work", async () => {
  const oversizedCanvas = { ...assignment("large"), description: "c".repeat(190_000) };
  const oversizedEmail = email("large", "e".repeat(190_000));
  const input = sources([oversizedEmail, email("good")], [oversizedCanvas]);
  let calls = 0;
  stub(async messages => {
    const batch = batchFrom(messages);
    calls++;
    assert.ok(JSON.stringify(batch).length <= 180_000);
    assert.ok(batch.assignments.every(item => item.id !== "large"));
    assert.ok(batch.emails.every(item => item.id !== "large"));
    return { tasks: batch.emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks(input, preferences, now);
  assert.ok(calls > 0);
  assert.ok(result.tasks.some(task => task.source === "gmail" && task.sourceId === "good"));
  assert.ok(result.tasks.some(task => task.source === "canvas" && task.sourceId === "large" && task.estimatedMinutes === 100));
  assert.ok(result.warnings.some(warning => /email.*exceeded.*size limit/i.test(warning)));
  assert.ok(result.warnings.some(warning => /100 minute.*size limit/i.test(warning)));
  assert.equal(input.emails[0].body, oversizedEmail.body);
  assert.equal(input.assignments[0].description, oversizedCanvas.description);
});

test("the shared extraction deadline skips queued batches and reports their missing coverage", async context => {
  let clock = 1000;
  context.mock.method(Date, "now", () => clock);
  const emails = Array.from({ length: 6 }, (_, index) => email(String(index), "x".repeat(35_000)));
  let calls = 0;
  stub(async messages => {
    calls++;
    clock += 91_000;
    return { tasks: batchFrom(messages).emails.map(item => extracted(item.id)) };
  });
  const result = await extractTasks(sources(emails), preferences, now);
  assert.equal(calls, 1);
  assert.equal(result.tasks.length, 1);
  assert.ok(result.warnings.some(warning => /time limit.*batch/i.test(warning)));
});
