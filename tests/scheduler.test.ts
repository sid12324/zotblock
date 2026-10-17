import assert from "node:assert/strict";
import test from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { scheduleTasks } from "../src/lib/planner/scheduler";
import { demoData } from "../src/lib/planner/demo";
import { planningWindow } from "../src/lib/planner/time";
import type { SourceData, StudyPreferences, StudyTask } from "../src/lib/types";

const preferences: StudyPreferences = { timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
const now = "2026-10-17T16:12:00Z";
const empty: SourceData = { assignments: [], emails: [], calendarEvents: [] };
const task = (extra: Partial<StudyTask> = {}): StudyTask => ({ id: "canvas:1", source: "canvas", sourceId: "1", title: "Problem set", course: "Math", dueAt: "2026-10-18T20:00:00Z", estimatedMinutes: 150, priority: "high", url: null, ...extra });

test("blocks respect existing events, now, deadlines, duration and break time", () => {
  const busy = { id: "class", summary: "Lecture", start: "2026-10-17T16:30:00Z", end: "2026-10-17T18:00:00Z" };
  const result = scheduleTasks([task()], { ...empty, calendarEvents: [busy] }, preferences, now);
  assert.equal(result.unscheduledTasks.length, 0);
  assert.equal(result.studyBlocks.reduce((sum, block) => sum + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000, 0), 150);
  for (const [index, block] of result.studyBlocks.entries()) {
    const start = Date.parse(block.start.dateTime), end = Date.parse(block.end.dateTime);
    assert.ok(start >= Date.parse(now));
    assert.ok(end <= Date.parse(task().dueAt));
    assert.ok(end - start <= preferences.blockMinutes * 60_000);
    assert.ok(end <= Date.parse(busy.start) || start >= Date.parse(busy.end));
    if (index) assert.ok(start >= Date.parse(result.studyBlocks[index - 1].end.dateTime) + 10 * 60_000);
  }
});

test("a full-day calendar event blocks the whole local day", () => {
  const sources = { ...empty, calendarEvents: [{ id: "away", summary: "Away", start: "2026-10-17T07:00:00Z", end: "2026-10-18T07:00:00Z" }] };
  const result = scheduleTasks([task({ dueAt: "2026-10-18T06:59:00Z" })], sources, preferences, now);
  assert.equal(result.studyBlocks.length, 0);
  assert.equal(result.unscheduledTasks[0].remainingMinutes, 150);
});

test("reports remaining work when the deadline leaves insufficient time", () => {
  const result = scheduleTasks([task({ dueAt: "2026-10-17T17:00:00Z" })], empty, preferences, now);
  assert.equal(result.studyBlocks.length, 1);
  assert.equal(result.unscheduledTasks[0].remainingMinutes, 105);
});

test("local study hours survive daylight saving transitions", () => {
  const dstNow = "2026-10-31T07:00:00Z";
  const sources = { ...empty, calendarEvents: [{ id: "away", summary: "Away", start: "2026-10-31T07:00:00Z", end: "2026-11-01T07:00:00Z" }] };
  const result = scheduleTasks([task({ dueAt: "2026-11-03T00:00:00Z", estimatedMinutes: 50 })], sources, preferences, dstNow);
  assert.equal(result.studyBlocks[0].start.dateTime, "2026-11-01T17:00:00.000Z");
  const local = Temporal.Instant.from(result.studyBlocks[0].start.dateTime).toZonedDateTimeISO(preferences.timeZone);
  assert.equal(local.hour, 9);
  assert.equal(local.offset, "-08:00");
});

test("past due tasks cannot be placed", () => {
  const result = scheduleTasks([task({ dueAt: "2026-10-16T20:00:00Z" })], empty, preferences, now);
  assert.equal(result.studyBlocks.length, 0);
  assert.match(result.unscheduledTasks[0].reason, /already passed/);
});

test("explicit sample fixtures generate a usable plan and preserve source links", () => {
  const { sources, tasks } = demoData(preferences, now);
  const result = scheduleTasks(tasks, sources, preferences, now);
  assert.equal(result.unscheduledTasks.length, 0);
  assert.ok(result.studyBlocks.length >= 7);
  assert.ok(result.studyBlocks.some(block => block.source.provider === "gmail"));
  assert.ok(result.studyBlocks.some(block => block.source.provider === "canvas"));
});

test("planning windows end at local midnight across DST", () => {
  const window = planningWindow({ ...preferences, days: 3 }, "2026-10-31T19:00:00Z");
  assert.equal(window.end, "2026-11-03T08:00:00Z");
});

test("invalid occupied intervals fail instead of creating overlapping study blocks", () => {
  assert.throws(() => scheduleTasks([task()], { ...empty, calendarEvents: [{ id: "bad", summary: "Bad event", start: now, end: "2026-10-17T00:00:00Z" }] }, preferences, now), /invalid time range/);
});
