import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { Temporal } from "@js-temporal/polyfill";
import { defaultOnboardingAnswers, defaultStudyPreferences, onboardingAnswersSchema, preferencesFromOnboarding, studyPreferencesSchema } from "../src/lib/preferences";
import { scheduleTasks } from "../src/lib/planner/scheduler";
import type { OnboardingAnswers, SourceData, StudyPreferences, StudyTask } from "../src/lib/types";

const empty: SourceData = { assignments: [], emails: [], calendarEvents: [] };
const base = defaultStudyPreferences("America/Los_Angeles");
const answers = (extra: Partial<OnboardingAnswers> = {}): OnboardingAnswers => ({ ...defaultOnboardingAnswers, name: "Student", major: "Computer Science", studyHours: "2", ...extra });
const preferences = (extra: Partial<OnboardingAnswers> = {}, days = 2) => preferencesFromOnboarding(answers(extra), { ...base, days });
const task = (extra: Partial<StudyTask> = {}): StudyTask => ({ id: "canvas:one", source: "canvas", sourceId: "one", title: "Problem set", course: "Math", dueAt: "2026-10-21T06:00:00Z", estimatedMinutes: 100, priority: "high", url: null, ...extra });
const at = (value: string, zone = base.timeZone) => new Date(Temporal.PlainDateTime.from(value).toZonedDateTime(zone).epochMilliseconds).toISOString();
const studyMinutes = (blocks: ReturnType<typeof scheduleTasks>["studyBlocks"]) => blocks.reduce((sum, block) => sum + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000, 0);

const requireForTest = createRequire(import.meta.url);
const serverOnlyPath = requireForTest.resolve("server-only");
const originalServerOnly = requireForTest.cache[serverOnlyPath];
// This suite runs the server pipeline directly, without importing it into a client bundle.
requireForTest.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} } as NodeModule;
let generateStudyPlan: typeof import("../src/lib/planner")["generateStudyPlan"];
before(async () => { ({ generateStudyPlan } = await import("../src/lib/planner")); });
after(() => {
  if (originalServerOnly) requireForTest.cache[serverOnlyPath] = originalServerOnly;
  else delete requireForTest.cache[serverOnlyPath];
});

test("Meher answers remain intact while minute-accurate routine values are normalized", () => {
  const raw = answers({ name: " Student ", wake: "07:10", sleep: "22:35", studyHours: "1.25", breakMinutes: "20", breakFrequency: "Every 45 minutes", focusPeriod: "Evening", focusTime: "18:20", deadlineDays: 5 });
  const normalized = preferencesFromOnboarding(raw, { ...base, timeZone: "Asia/Tokyo", days: 3 });
  assert.deepEqual(normalized.onboardingAnswers, raw);
  assert.equal(normalized.timeZone, "Asia/Tokyo");
  assert.equal(normalized.days, 3);
  assert.equal(normalized.dayStart, 0);
  assert.equal(normalized.dayEnd, 24);
  assert.equal(normalized.blockMinutes, 45);
  assert.deepEqual(normalized.routine, { wakeMinutes: 430, sleepMinutes: 1355, dailyStudyMinutes: 75, breakMinutes: 20, breakEveryMinutes: 45, focusPeriod: "Evening", focusMinutes: 1100, deadlineLeadDays: 5 });
});

test("the API preference schema regenerates routine values instead of trusting stale client limits", () => {
  const parsed = studyPreferencesSchema.parse({ ...base, onboardingAnswers: answers({ studyHours: "0" }), routine: { wakeMinutes: 0, sleepMinutes: 1440, dailyStudyMinutes: 1440, breakMinutes: 0 } });
  assert.equal(parsed.routine?.dailyStudyMinutes, 0);
  assert.equal(parsed.routine?.wakeMinutes, 480);
  assert.equal(parsed.routine?.breakMinutes, 15);
  assert.deepEqual(studyPreferencesSchema.parse(base), base);
  assert.equal(studyPreferencesSchema.parse({ ...base, routine: parsed.routine }).routine, undefined);
});

test("invalid or ambiguous onboarding times and study limits are rejected", () => {
  for (const invalid of [
    { name: " " }, { wake: "25:00" }, { wake: "08:00", sleep: "08:00" },
    { studyHours: "" }, { studyHours: "-1" }, { studyHours: "24.1" }, { studyHours: "1e1" },
    { breakMinutes: "0" }, { breakFrequency: "Every 5 minutes" }, { deadlineDays: 31 },
  ]) assert.equal(onboardingAnswersSchema.safeParse({ ...answers(), ...invalid }).success, false, JSON.stringify(invalid));
  assert.equal(onboardingAnswersSchema.safeParse(answers({ wake: "20:10", sleep: "04:20", studyHours: ".25" })).success, true);
});

test("zero and fractional daily study limits stay hard limits", () => {
  const now = at("2026-10-17T07:00");
  const zero = scheduleTasks([task()], empty, preferences({ studyHours: "0" }), now);
  assert.equal(zero.studyBlocks.length, 0);
  assert.equal(zero.unscheduledTasks[0].remainingMinutes, 100);
  const limited = scheduleTasks([task()], empty, preferences({ studyHours: "0.25", deadlineDays: 30 }), now);
  assert.equal(studyMinutes(limited.studyBlocks), 30);
  assert.ok(limited.studyBlocks.every(block => (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000 <= 15));
  assert.equal(limited.unscheduledTasks[0].remainingMinutes, 70);
});

test("precise wake and sleep minutes and chosen breaks bound sessions", () => {
  const chosen = preferences({ wake: "07:10", sleep: "08:05", studyHours: "2", breakMinutes: "5", breakFrequency: "Every 30 minutes", focusPeriod: "Morning", focusTime: "07:10", deadlineDays: 30 }, 1);
  const result = scheduleTasks([task({ estimatedMinutes: 60 })], empty, chosen, at("2026-10-17T07:00"));
  assert.equal(result.studyBlocks[0].start.dateTime, at("2026-10-17T07:10"));
  assert.equal(result.studyBlocks.at(-1)?.end.dateTime, at("2026-10-17T08:05"));
  assert.equal(studyMinutes(result.studyBlocks), 50);
  assert.equal(result.unscheduledTasks[0].remainingMinutes, 10);
  for (let index = 1; index < result.studyBlocks.length; index++) assert.ok(Date.parse(result.studyBlocks[index].start.dateTime) - Date.parse(result.studyBlocks[index - 1].end.dateTime) >= 5 * 60_000);
});

test("overnight wake cycles stay outside sleep and calendar events with caps per local date", () => {
  const chosen = preferences({ wake: "20:10", sleep: "04:20", studyHours: "1", breakMinutes: "20", breakFrequency: "Every 25 minutes", focusPeriod: "Night", focusTime: "21:15", deadlineDays: 30 });
  const busy = { id: "class", summary: "Evening class", start: at("2026-10-17T21:00"), end: at("2026-10-17T22:00") };
  const result = scheduleTasks([task({ estimatedMinutes: 300 })], { ...empty, calendarEvents: [busy] }, chosen, at("2026-10-17T19:00"));
  const daily = new Map<string, number>();
  for (const block of result.studyBlocks) {
    const start = Temporal.Instant.from(block.start.dateTime).toZonedDateTimeISO(chosen.timeZone);
    const last = Temporal.Instant.from(block.end.dateTime).subtract({ nanoseconds: 1 }).toZonedDateTimeISO(chosen.timeZone);
    for (const time of [start, last]) assert.ok(time.hour * 60 + time.minute >= 1210 || time.hour * 60 + time.minute < 260);
    assert.ok(Date.parse(block.end.dateTime) <= Date.parse(busy.start) || Date.parse(block.start.dateTime) >= Date.parse(busy.end));
    const date = start.toPlainDate().toString();
    daily.set(date, (daily.get(date) || 0) + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000);
  }
  assert.equal(studyMinutes(result.studyBlocks), 120);
  assert.ok([...daily.values()].every(minutes => minutes <= 60));
  for (let index = 1; index < result.studyBlocks.length; index++) assert.ok(Date.parse(result.studyBlocks[index].start.dateTime) - Date.parse(result.studyBlocks[index - 1].end.dateTime) >= 20 * 60_000);
});

test("harder, higher-priority work uses peak hours while easier work leaves those hours free", () => {
  const chosen = preferences({ wake: "08:00", sleep: "22:00", studyHours: "4", focusPeriod: "Afternoon", focusTime: "14:00", deadlineDays: 30 }, 1);
  const result = scheduleTasks([task({ id: "easy", sourceId: "easy", estimatedMinutes: 25, priority: "low" }), task({ id: "hard", sourceId: "hard" })], empty, chosen, at("2026-10-17T07:00"));
  const hard = result.studyBlocks.find(block => block.source.id === "hard")!;
  const easy = result.studyBlocks.find(block => block.source.id === "easy")!;
  assert.equal(hard.start.dateTime, at("2026-10-17T14:00"));
  assert.equal(easy.start.dateTime, at("2026-10-17T08:00"));
  assert.equal(result.unscheduledTasks.length, 0);
});

test("soft focus placement falls back when it would sacrifice feasible study capacity", () => {
  const chosen = preferences({ wake: "13:00", sleep: "15:00", studyHours: "2", focusPeriod: "Afternoon", focusTime: "13:30", deadlineDays: 30 }, 1);
  const result = scheduleTasks([task()], empty, chosen, at("2026-10-17T12:00"));
  assert.equal(result.unscheduledTasks.length, 0);
  assert.equal(studyMinutes(result.studyBlocks), 100);
  assert.equal(result.studyBlocks[0].start.dateTime, at("2026-10-17T13:00"));
});

test("soft placement cannot consume another task's feasible shared daily capacity", () => {
  const chosen = preferences({ wake: "13:00", sleep: "15:00", studyHours: "1.5", breakFrequency: "Every 30 minutes", focusPeriod: "Afternoon", focusTime: "13:30", deadlineDays: 30 }, 1);
  const result = scheduleTasks([task({ id: "first", sourceId: "first", estimatedMinutes: 60 }), task({ id: "second", sourceId: "second", estimatedMinutes: 30, priority: "low" })], empty, chosen, at("2026-10-17T12:00"));
  assert.equal(result.unscheduledTasks.length, 0);
  assert.equal(studyMinutes(result.studyBlocks), 90);
  assert.equal(result.studyBlocks.filter(block => block.source.id === "first").reduce((sum, block) => sum + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000, 0), 60);
  assert.equal(result.studyBlocks.filter(block => block.source.id === "second").reduce((sum, block) => sum + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000, 0), 30);
});

test("deadline lead days prefer a start date and fall back earlier when that period is busy", () => {
  const chosen = preferences({ deadlineDays: 1 }, 4);
  const dueAt = at("2026-10-20T23:00");
  const work = task({ dueAt, estimatedMinutes: 60 });
  const result = scheduleTasks([work], empty, chosen, at("2026-10-17T07:00"));
  assert.equal(Temporal.Instant.from(result.studyBlocks[0].start.dateTime).toZonedDateTimeISO(chosen.timeZone).day, 19);
  const busy = { id: "away", summary: "Away", start: at("2026-10-19T00:00"), end: at("2026-10-21T00:00") };
  const fallback = scheduleTasks([work], { ...empty, calendarEvents: [busy] }, chosen, at("2026-10-17T07:00"));
  assert.equal(fallback.unscheduledTasks.length, 0);
  assert.ok(fallback.studyBlocks.every(block => Date.parse(block.end.dateTime) <= Date.parse(busy.start)));
});

test("routine time zones and overnight sleep remain valid through daylight saving changes", () => {
  const chosen = preferences({ wake: "20:00", sleep: "02:30", studyHours: "2", focusPeriod: "Night", focusTime: "01:00", deadlineDays: 30 }, 2);
  const result = scheduleTasks([task({ dueAt: "2026-11-03T08:00:00Z", estimatedMinutes: 300 })], empty, chosen, "2026-10-31T07:00:00Z");
  const daily = new Map<string, number>();
  for (const block of result.studyBlocks) {
    assert.equal(block.start.timeZone, chosen.timeZone);
    const local = Temporal.Instant.from(block.start.dateTime).toZonedDateTimeISO(chosen.timeZone);
    assert.ok(local.hour >= 20 || local.hour < 3);
    daily.set(local.toPlainDate().toString(), (daily.get(local.toPlainDate().toString()) || 0) + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000);
  }
  assert.equal(studyMinutes(result.studyBlocks), 240);
  assert.ok([...daily.values()].every(minutes => minutes <= 120));
});

test("a repeated daylight-saving hour cannot place study inside the wake boundary", () => {
  const chosen = preferences({ wake: "01:30", sleep: "04:00", studyHours: "4", breakFrequency: "Every 90 minutes", breakMinutes: "5", focusPeriod: "Night", focusTime: "01:30", deadlineDays: 30 }, 1);
  const result = scheduleTasks([task({ dueAt: "2026-11-02T08:00:00Z", estimatedMinutes: 200 })], empty, chosen, "2026-11-01T07:00:00Z");
  for (const block of result.studyBlocks) {
    for (let instant = Date.parse(block.start.dateTime); instant < Date.parse(block.end.dateTime); instant += 60_000) {
      const local = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(chosen.timeZone);
      assert.ok(local.hour * 60 + local.minute >= 90 && local.hour < 4);
    }
  }
  assert.ok(studyMinutes(result.studyBlocks) > 0);
});

test("the LangChain demo pipeline preserves the complete normalized preferences in JSON", async () => {
  const chosen: StudyPreferences = preferencesFromOnboarding(answers({ name: "Avery", major: "Biology", studyHours: "1.5", breakFrequency: "Every 30 minutes", focusTime: "16:15" }), { ...base, timeZone: "Asia/Tokyo", days: 3 });
  const plan = await generateStudyPlan({ mode: "demo", preferences: chosen, now: "2026-10-17T00:00:00Z" });
  assert.deepEqual(plan.preferences, chosen);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)).preferences.onboardingAnswers, chosen.onboardingAnswers);
  assert.equal(plan.orchestration.framework, "langchain");
  assert.equal(plan.timeZone, "Asia/Tokyo");
  assert.ok(plan.studyBlocks.every(block => block.start.timeZone === "Asia/Tokyo" && Date.parse(block.end.dateTime) <= Date.parse(block.source.dueAt)));
});
