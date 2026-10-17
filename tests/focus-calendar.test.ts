import assert from "node:assert/strict";
import test from "node:test";
import { focusTargetFromEvent } from "../src/components/calendar/focus-timer-card";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import type { StudyPlan } from "../src/lib/types";

function plan(): StudyPlan {
  return {
    schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "demo", timeZone: "America/Los_Angeles",
    window: { start: "2026-10-17T07:00:00Z", end: "2026-10-21T07:00:00Z" }, orchestration: { framework: "langchain", model: null },
    studyBlocks: [{ id: "overnight", summary: "Study: Lab report", description: "Focus on the report.", priority: "high", start: { dateTime: "2026-10-18T06:30:00Z", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-10-18T08:00:00Z", timeZone: "America/Los_Angeles" }, source: { provider: "canvas", id: "lab", title: "Lab report", dueAt: "2026-10-20T07:00:00Z", url: "https://school.instructure.com/courses/1/assignments/2" } }],
    sourceData: { assignments: [{ id: "lab", title: "Lab report", course: "Biology", dueAt: "2026-10-20T07:00:00Z", url: "https://school.instructure.com/courses/1/assignments/2", description: "Original instructions", userEdits: { description: "Corrected instructions" } }], emails: [], calendarEvents: [] }, unscheduledTasks: [], warnings: [],
  };
}

test("starting from either overnight calendar segment uses the full block duration and saved instructions", () => {
  const input = plan();
  const segments = calendarEventsFromPlan(input).filter(event => event.kind === "study");
  assert.equal(segments.length, 2);
  for (const event of segments) {
    const target = focusTargetFromEvent(event, input.timeZone);
    assert.equal(target.durationMinutes, 90);
    assert.equal(target.title, "Study: Lab report");
    assert.equal(target.description, "Corrected instructions");
    assert.equal(target.course, "Biology");
    assert.equal(target.timeZone, input.timeZone);
  }
});

test("deadlines and standalone timers use the chosen focus duration rather than a reminder interval", () => {
  const input = plan();
  const deadline = calendarEventsFromPlan(input).find(event => event.kind === "due")!;
  assert.equal(focusTargetFromEvent(deadline, input.timeZone, 50).durationMinutes, 50);
  assert.equal(focusTargetFromEvent(null, "Asia/Tokyo", 25).durationMinutes, 25);
  assert.equal(focusTargetFromEvent(null, "Asia/Tokyo", 25).title, "Independent study");
});

test("unusually long assignment instructions retain a clear link-back note within the persisted timer budget", () => {
  const input = plan();
  input.sourceData.assignments[0].userEdits = { description: "Full instructions ".repeat(2000) };
  const event = calendarEventsFromPlan(input).find(event => event.kind === "study")!;
  const target = focusTargetFromEvent(event, input.timeZone);
  assert.ok(target.description!.length <= 20_000);
  assert.match(target.description!, /Open the calendar for the full instructions/);
  assert.ok((input.sourceData.assignments[0].userEdits?.description?.length ?? 0) > 20_000);
});
