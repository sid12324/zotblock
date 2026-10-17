import assert from "node:assert/strict";
import test from "node:test";
import { calendarExportItems, selectCalendarExportItems } from "../src/lib/calendar/export";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import type { StudyBlock, StudyPlan } from "../src/lib/types";

function plan(): StudyPlan {
  return {
    schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live", timeZone: "America/Los_Angeles",
    window: { start: "2026-10-17T07:00:00Z", end: "2026-10-25T07:00:00Z" },
    orchestration: { framework: "langchain", model: "test" }, warnings: [], unscheduledTasks: [],
    sourceData: {
      assignments: [{ id: "assignment-1", title: "Lab report", course: "Biology", dueAt: "2026-10-21T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/1", description: "Compare your recorded samples.", details: { pointsPossible: 10, allowedAttempts: -1, lockedForUser: false, submissionTypes: ["online_text_entry"] } }],
      emails: [], calendarEvents: [{ id: "already-in-google", summary: "Office hours", start: "2026-10-18T17:00:00Z", end: "2026-10-18T18:00:00Z" }],
    },
    studyBlocks: [block("first", "2026-10-18T06:30:00Z", "2026-10-18T08:30:00Z"), block("second", "2026-10-19T17:00:00Z", "2026-10-19T18:00:00Z")],
  };
}

function block(id: string, start: string, end: string): StudyBlock {
  return {
    id, summary: "Study: Lab report", description: "Focused study.", priority: "high",
    start: { dateTime: start, timeZone: "America/Los_Angeles" }, end: { dateTime: end, timeZone: "America/Los_Angeles" },
    source: { provider: "canvas", id: "assignment-1", title: "Lab report", dueAt: "2026-10-21T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/1" },
  };
}

test("whole-plan export includes every study block and deadline, omitting imported Google events", () => {
  const input = plan();
  input.sourceData.assignments.push({ id: "assignment-2", title: "Future quiz", course: "Math", dueAt: "2026-10-24T18:00:00Z", url: null, description: "Review all topics." });
  const items = calendarExportItems(input);
  assert.equal(items.length, 4);
  assert.equal(items.filter(item => item.kind === "study").length, 2);
  assert.equal(items.filter(item => item.kind === "due").length, 2);
  assert.ok(items.every(item => item.summary !== "Office hours"));
  assert.ok(items.some(item => item.summary === "Future quiz · due"));
  assert.equal(selectCalendarExportItems(input, "all").length, 4);
});

test("overnight display segments export one complete event and either segment can be selected", () => {
  const input = plan();
  const segments = calendarEventsFromPlan(input).filter(item => item.kind === "study" && item.exportStart === input.studyBlocks[0].start.dateTime);
  assert.equal(segments.length, 2);
  const all = calendarExportItems(input);
  const item = all.find(item => item.displayIds.includes(segments[0].id))!;
  assert.equal(item.start.dateTime, "2026-10-18T06:30:00Z");
  assert.equal(item.end.dateTime, "2026-10-18T08:30:00Z");
  assert.equal(item.start.timeZone, "America/Los_Angeles");
  assert.equal(item.displayIds.length, 2);
  for (const segment of segments) assert.deepEqual(selectCalendarExportItems(input, "selected", segment.id), [item]);
});

test("selected export only accepts an academic event from the supplied plan", () => {
  const input = plan();
  const events = calendarEventsFromPlan(input);
  const deadline = events.find(item => item.kind === "due")!;
  const selected = selectCalendarExportItems(input, "selected", deadline.id);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, "due");
  assert.equal(selected[0].start.dateTime, "2026-10-21T06:59:00Z");
  assert.equal(selected[0].end.dateTime, "2026-10-21T07:14:00Z");
  assert.deepEqual(selectCalendarExportItems(input, "selected", events.find(item => item.kind === "class")!.id), []);
  assert.deepEqual(selectCalendarExportItems(input, "selected", "unknown"), []);
  assert.deepEqual(selectCalendarExportItems(input, "selected"), []);
});

test("export identities survive regeneration, interval offset formatting and scheduler ID changes", () => {
  const input = plan();
  const original = calendarExportItems(input).map(item => item.key);
  input.generatedAt = "2026-10-17T08:00:00Z";
  input.studyBlocks[0].id = "new-global-index";
  input.studyBlocks[0].summary = "Renamed study block";
  input.studyBlocks[0].start.dateTime = "2026-10-17T23:30:00-07:00";
  input.studyBlocks[0].end.dateTime = "2026-10-18T01:30:00-07:00";
  input.sourceData.assignments[0].description = "New instructions.";
  assert.deepEqual(calendarExportItems(input).map(item => item.key), original);
});

test("exports include saved instructions and manual assignment facts while keeping source data intact", () => {
  const input = plan();
  input.sourceData.assignments[0].userEdits = { description: "Updated instructions\nUse the new worksheet.", details: { pointsPossible: "25", allowedAttempts: "Two", lockedForUser: "Ask your teacher" } };
  const before = JSON.stringify(input);
  for (const item of calendarExportItems(input)) {
    assert.ok(item.description.startsWith("Source: https://school.instructure.com/"));
    assert.match(item.description, /Updated instructions\nUse the new worksheet/);
    assert.match(item.description, /Points: 25/);
    assert.match(item.description, /Allowed attempts: Two/);
    assert.match(item.description, /Access: Ask your teacher/);
    assert.match(item.description, /Submit as: Online text entry/);
  }
  assert.equal(JSON.stringify(input), before);
});

test("distinct tasks from one Gmail message retain separate study blocks and deadline reminders", () => {
  const input = plan();
  input.sourceData.assignments = [];
  for (const [index, item] of input.studyBlocks.entries()) {
    item.source = { provider: "gmail", id: "email-with-two-tasks", title: index ? "Quiz" : "Essay", dueAt: "2026-10-21T06:59:00Z", url: "https://mail.google.com/mail/u/0/#inbox/email-with-two-tasks" };
  }
  const items = calendarExportItems(input);
  assert.equal(items.length, 4);
  assert.equal(new Set(items.map(item => item.key)).size, 4);
  assert.equal(items.filter(item => item.kind === "due").length, 2);
});
