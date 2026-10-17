import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventsFromPlan } from "../src/lib/calendar/events";
import { readCalendarEvents } from "../src/lib/integrations/google";
import type { AssignmentDetails, StudyBlock, StudyPlan } from "../src/lib/types";

function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return { schemaVersion: "1.0", generatedAt: "2026-10-17T07:00:00Z", mode: "live", timeZone: "America/Los_Angeles", window: { start: "2026-10-17T07:00:00Z", end: "2026-10-21T07:00:00Z" }, orchestration: { framework: "langchain", model: "test-model" }, studyBlocks: [], unscheduledTasks: [], sourceData: { assignments: [], emails: [], calendarEvents: [] }, warnings: [], ...overrides };
}

function block(id: string, source: Partial<StudyBlock["source"]> = {}, start = "2026-10-18T01:00:00Z", end = "2026-10-18T01:45:00Z"): StudyBlock {
  return { id, summary: "Study: Lab report", description: "45 minutes of focused study.", start: { dateTime: start, timeZone: "America/Los_Angeles" }, end: { dateTime: end, timeZone: "America/Los_Angeles" }, source: { provider: "canvas", id: "shared", title: "Lab report", dueAt: "2026-10-20T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/2", ...source }, priority: "high" };
}

test("calendar mapping preserves source relationships, deadlines and effort without duplicating notices", () => {
  const input = plan();
  input.sourceData.assignments = [{ id: "shared", title: "Lab report", course: "Biology", dueAt: "2026-10-20T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/2", description: "Compare the recorded samples." }];
  input.sourceData.emails = [{ id: "shared", subject: "Quiz deadline", from: "teacher@example.edu", receivedAt: "2026-10-17T09:00:00Z", body: "Quiz is due Tuesday at noon.", url: "https://mail.google.com/mail/u/0/#inbox/shared" }, { id: "canvas-notice", subject: "Lab report reminder", from: "canvas@example.edu", receivedAt: "2026-10-17T10:00:00Z", body: "Lab report is due Monday night.", url: "https://mail.google.com/mail/u/0/#inbox/canvas-notice" }];
  const gmail = { provider: "gmail" as const, id: "shared", title: "Quiz review", dueAt: "2026-10-20T19:00:00Z", url: input.sourceData.emails[0].url };
  input.studyBlocks = [block("shared"), block("canvas-second"), block("gmail-first", gmail, "2026-10-18T04:00:00Z", "2026-10-18T04:30:00Z"), block("gmail-second", gmail, "2026-10-18T05:00:00Z", "2026-10-18T05:30:00Z")];
  input.unscheduledTasks = [
    { task: { id: "canvas-task", source: "canvas", sourceId: "shared", title: "Lab report", course: "Biology", dueAt: input.sourceData.assignments[0].dueAt, estimatedMinutes: 120, priority: "high", url: input.sourceData.assignments[0].url }, remainingMinutes: 30, reason: "No free time." },
    { task: { id: "gmail-task", source: "gmail", sourceId: "shared", title: "Quiz review", course: "Chemistry", dueAt: gmail.dueAt, estimatedMinutes: 90, priority: "medium", url: gmail.url }, remainingMinutes: 30, reason: "No free time." },
  ];
  input.sourceData.calendarEvents = [{ id: "shared", summary: "Office hours", start: "2026-10-18T17:00:00Z", end: "2026-10-18T18:00:00Z" }];
  const events = calendarEventsFromPlan(input);
  const dues = events.filter(event => event.kind === "due");
  assert.equal(dues.length, 2);
  const canvasDue = dues.find(event => event.sourceProvider === "canvas")!;
  assert.equal(canvasDue.date, "2026-10-19");
  assert.equal(canvasDue.timeLabel, "11:59 pm");
  assert.equal(canvasDue.estimate, "2:00");
  assert.equal(canvasDue.courseName, "Biology");
  assert.equal(canvasDue.description, "Compare the recorded samples.");
  assert.match(canvasDue.summary, /90 minutes scheduled; 30 minutes remain unscheduled/);
  assert.equal(canvasDue.resources[0].href, input.sourceData.assignments[0].url);
  const gmailDue = dues.find(event => event.sourceProvider === "gmail")!;
  assert.equal(gmailDue.estimate, "1:30");
  assert.equal(gmailDue.courseName, "Chemistry");
  assert.equal(gmailDue.htmlUrl, gmail.url);
  assert.equal(gmailDue.durationMinutes, null);
  assert.equal(events.filter(event => event.kind === "study").length, 4);
  assert.equal(events.find(event => event.kind === "study")?.durationMinutes, 45);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
});

test("dates and clock positions use the plan timezone even across a UTC date boundary", () => {
  const dueAt = "2026-10-17T16:30:00Z";
  const input = plan({ timeZone: "Asia/Tokyo", window: { start: "2026-10-17T00:00:00Z", end: "2026-10-19T00:00:00Z" }, studyBlocks: [block("tokyo", { dueAt }, "2026-10-17T16:00:00Z", dueAt)] });
  const events = calendarEventsFromPlan(input);
  const study = events.find(event => event.kind === "study")!;
  const due = events.find(event => event.kind === "due")!;
  assert.equal(study.date, "2026-10-18");
  assert.equal(study.startMinutes, 60);
  assert.equal(study.endMinutes, 90);
  assert.equal(study.durationMinutes, 30);
  assert.equal(due.date, "2026-10-18");
  assert.equal(due.timeLabel, "1:30 am");
  assert.equal(due.dueAt, dueAt);
});

test("Canvas study blocks and deadlines retain real instructions and complete assignment metadata", () => {
  const input = plan({ studyBlocks: [block("details")] });
  const description = "Compare the recorded samples.\nSubmit your results and a discussion of the limitations.";
  const details: AssignmentDetails = {
    pointsPossible: 0, submissionTypes: ["online_upload", "online_text_entry"], allowedExtensions: ["pdf", "docx"],
    instructionsHtml: "<p>Compare the recorded samples.</p>",
    attachments: [{ title: "Lab rubric", url: "https://school.instructure.com/files/123/download" }],
    unlockAt: null, lockAt: "2026-10-20T07:00:00Z", timeLimitMinutes: 0, questionCount: 0,
    allowedAttempts: 0, lockedForUser: false, lockExplanation: "Available until the course closes.", gradingType: "pass_fail",
  };
  input.sourceData.assignments = [{ id: "shared", title: "Lab report", course: "Biology", dueAt: "2026-10-20T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/2", description, details }];
  const before = JSON.stringify(input);
  const events = calendarEventsFromPlan(input);
  assert.deepEqual(events.map(event => event.kind).sort(), ["due", "study"]);
  for (const event of events) {
    assert.equal(event.description, description);
    assert.doesNotMatch(event.description, /45 minutes of focused study/);
    assert.deepEqual(event.assignmentDetails, details);
    assert.equal(event.assignmentDetails?.pointsPossible, 0);
    assert.equal(event.assignmentDetails?.lockedForUser, false);
    assert.deepEqual(event.resources.map(resource => [resource.title, resource.href]), [["Canvas assignment", input.sourceData.assignments[0].url], ["Lab rubric", details.attachments![0].url]]);
  }
  assert.equal(JSON.stringify(input), before);
});

test("Canvas attachment resources reject unsafe links even without an assignment source URL", () => {
  const input = plan({ studyBlocks: [block("attachments", { url: null })] });
  const attachments = [
    { title: "HTTPS handout", url: "https://school.instructure.com/files/1/download?download=1" },
    { title: "HTTP notes", url: "http://school.example/files/2" },
    { title: "Script", url: "javascript:alert(1)" },
    { title: "Credentials", url: "https://username:password@school.example/files/3" },
    { title: "Inline file", url: "data:text/html,unsafe" },
    { title: "Relative file", url: "/files/4" },
  ];
  input.sourceData.assignments = [{ id: "shared", title: "Lab report", course: "Biology", dueAt: "2026-10-20T06:59:00Z", url: null, description: "Use the attached handout.", details: { pointsPossible: 10, lockedForUser: true, lockExplanation: "Not available until the module opens.", attachments } }];
  for (const event of calendarEventsFromPlan(input)) {
    assert.equal(event.htmlUrl, undefined);
    assert.deepEqual(event.resources.map(resource => resource.href), attachments.slice(0, 2).map(attachment => attachment.url));
    assert.deepEqual(event.assignmentDetails?.attachments, attachments.slice(0, 2));
    assert.equal(event.assignmentDetails?.lockedForUser, true);
    assert.equal(event.assignmentDetails?.lockExplanation, "Not available until the module opens.");
  }
  assert.equal(input.sourceData.assignments[0].details?.attachments?.length, 6);
});

test("overnight busy intervals split at local midnight with an exclusive end boundary", () => {
  const input = plan();
  input.sourceData.calendarEvents = [
    { id: "overnight", summary: "Overnight shift", start: "2026-10-18T06:30:00Z", end: "2026-10-18T08:30:00Z" },
    { id: "midnight-end", summary: "Late meeting", start: "2026-10-19T06:00:00Z", end: "2026-10-19T07:00:00Z" },
  ];
  const events = calendarEventsFromPlan(input);
  const overnight = events.filter(event => event.title === "Overnight shift");
  assert.deepEqual(overnight.map(event => [event.date, event.startMinutes, event.endMinutes, event.durationMinutes]), [["2026-10-17", 1410, 1440, 30], ["2026-10-18", 0, 90, 90]]);
  const midnight = events.filter(event => event.title === "Late meeting");
  assert.equal(midnight.length, 1);
  assert.equal(midnight[0].date, "2026-10-18");
  assert.equal(midnight[0].endMinutes, 1440);
});

test("explicit all-day events preserve the 25-hour DST day without reclassifying timed events", () => {
  const input = plan({ window: { start: "2026-11-01T07:00:00Z", end: "2026-11-03T08:00:00Z" } });
  input.sourceData.calendarEvents = [
    { id: "all-day", summary: "Campus closure", start: "2026-11-01T07:00:00Z", end: "2026-11-02T08:00:00Z", allDay: true },
    { id: "timed", summary: "Timed coverage", start: "2026-11-01T07:00:00Z", end: "2026-11-02T08:00:00Z" },
  ];
  const events = calendarEventsFromPlan(input);
  const allDay = events.find(event => event.title === "Campus closure")!;
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.date, "2026-11-01");
  assert.equal(allDay.startMinutes, null);
  assert.equal(allDay.endMinutes, null);
  assert.equal(allDay.timeLabel, "All day");
  assert.equal(allDay.durationMinutes, 1500);
  const timed = events.find(event => event.title === "Timed coverage")!;
  assert.equal(timed.allDay, false);
  assert.equal(timed.startMinutes, 0);
  assert.equal(timed.endMinutes, 1440);
  assert.equal(timed.durationMinutes, 1500);
});

test("DST repeated clock times retain actual elapsed duration and distinct timezone labels", () => {
  const input = plan({ window: { start: "2026-11-01T07:00:00Z", end: "2026-11-02T08:00:00Z" } });
  input.sourceData.calendarEvents = [{ id: "fold", summary: "Early shift", start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:30:00Z" }];
  const [event] = calendarEventsFromPlan(input);
  assert.equal(event.startMinutes, 90);
  assert.equal(event.endMinutes, 90);
  assert.equal(event.durationMinutes, 60);
  assert.match(event.timeLabel, /pdt.*pst/);
});

test("source links accept HTTP and HTTPS while rejecting scripts and embedded credentials", () => {
  const input = plan();
  input.sourceData.assignments = [
    { id: "safe", title: "Safe assignment", course: "", dueAt: "2026-10-20T06:59:00Z", url: "https://school.instructure.com/assignments/1", description: "" },
    { id: "http", title: "HTTP assignment", course: "", dueAt: "2026-10-20T06:59:00Z", url: "http://school.example/assignments/2", description: "" },
    { id: "script", title: "Script URL", course: "", dueAt: "2026-10-20T06:59:00Z", url: "javascript:alert(1)", description: "" },
    { id: "credential", title: "Credential URL", course: "", dueAt: "2026-10-20T06:59:00Z", url: "https://username:password@school.example/assignments/4", description: "" },
  ];
  const events = calendarEventsFromPlan(input);
  assert.equal(events.find(event => event.title === "Safe assignment")?.htmlUrl, input.sourceData.assignments[0].url);
  assert.equal(events.find(event => event.title === "HTTP assignment")?.htmlUrl, input.sourceData.assignments[1].url);
  for (const title of ["Script URL", "Credential URL"]) {
    const event = events.find(event => event.title === title)!;
    assert.equal(event.htmlUrl, undefined);
    assert.deepEqual(event.resources, []);
    assert.equal(event.estimate, "—");
  }
});

test("long busy intervals are limited to the plan's visible local dates", () => {
  const input = plan();
  input.sourceData.calendarEvents = [{ id: "long", summary: "Extended absence", start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z", allDay: true }];
  const events = calendarEventsFromPlan(input);
  assert.deepEqual(events.map(event => event.date), ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
});

test("Google collection preserves date-only all-day provenance", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ items: [
      { id: "date-only", summary: "All day", start: { date: "2026-11-01" }, end: { date: "2026-11-02" } },
      { id: "date-time", summary: "Timed", start: { dateTime: "2026-11-01T12:00:00Z" }, end: { dateTime: "2026-11-01T13:00:00Z" } },
    ] });
    const events = await readCalendarEvents({ accessToken: "test-token", expiresAt: 0, account: "test@example.edu", scopes: [], enabled: ["google-calendar"] }, { start: "2026-11-01T07:00:00Z", end: "2026-11-03T08:00:00Z" }, "America/Los_Angeles");
    assert.equal(events[0].allDay, true);
    assert.equal(events[0].start, "2026-11-01T07:00:00Z");
    assert.equal(events[0].end, "2026-11-02T08:00:00Z");
    assert.equal(events[1].allDay, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
