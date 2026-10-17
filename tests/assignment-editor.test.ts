import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assignmentDetailFields } from "../src/lib/assignment-edits";
import type { Assignment } from "../src/lib/types";
import type { CalendarDisplayEvent } from "../src/lib/calendar/events";
import { AssignmentEditor, assignmentDraftFrom, assignmentEditsFromDraft } from "../src/components/calendar/assignment-editor";
import { DetailPanel } from "../src/components/calendar/detail-panel";

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return { id: "assignment-1", title: "Essay", course: "Writing", dueAt: "2026-10-21T06:59:00Z", url: "https://school.instructure.com/courses/1/assignments/1", description: "Read all instructions.\nKeep each paragraph.", details: { pointsPossible: 0, allowedAttempts: -1, gradingType: "pass_fail", submissionTypes: ["online_upload", "online_text_entry"], allowedExtensions: ["pdf", "docx"], unlockAt: null, lockAt: null, lockedForUser: false, timeLimitMinutes: 0, questionCount: 0, lockExplanation: "Ask your teacher if details change." }, ...overrides };
}
const zone = "America/Los_Angeles";

test("editor prefills every text field and full instructions with zero, false, and null Canvas values preserved", () => {
  const html = renderToStaticMarkup(createElement(AssignmentEditor, { assignment: assignment(), timeZone: zone, onSave: () => {} }));
  assert.equal(html.match(/type="text"/g)?.length, assignmentDetailFields.length);
  assert.match(html, /name="pointsPossible"[^>]*value="0"/);
  assert.match(html, /name="allowedAttempts"[^>]*value="Unlimited"/);
  assert.match(html, /name="lockedForUser"[^>]*value="Not locked"/);
  assert.match(html, /name="unlockAt"[^>]*value="Not set"/);
  assert.match(html, /name="submissionTypes"[^>]*value="Online upload, Online text entry"/);
  assert.match(html, /Read all instructions\.\nKeep each paragraph\./);
  assert.match(html, /Corrections stay in this browser/);
  assert.match(html, /Reset to Canvas/);
  assert.equal(html.includes('name="dueAt"'), false);
});

test("saved text overrides take precedence, including deliberate blanks, and HTML remains escaped text", () => {
  const input = assignment({ userEdits: { description: '</textarea><script>alert("instructions")</script>', details: { pointsPossible: "", lockedForUser: "false", gradingType: '<img src=x onerror="alert(1)">' } } });
  const draft = assignmentDraftFrom(input, zone);
  assert.equal(draft.details.pointsPossible, "");
  assert.equal(draft.details.lockedForUser, "false");
  const html = renderToStaticMarkup(createElement(AssignmentEditor, { assignment: input, timeZone: zone, onSave: () => {} }));
  assert.match(html, /name="pointsPossible"[^>]*value=""/);
  assert.match(html, /name="lockedForUser"[^>]*value="false"/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(html, /value="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img '), false);
});

test("saving normalizes outer whitespace, preserves blank corrections, and stores only differences from original Canvas facts", () => {
  const input = assignment({ userEdits: { details: { pointsPossible: "20" } } });
  const original = structuredClone(input);
  const draft = assignmentDraftFrom(input, zone);
  draft.description = "  Updated instructions\n\nKeep the full second paragraph.  ";
  draft.details.pointsPossible = " 30 ";
  draft.details.allowedAttempts = "  Unlimited  ";
  draft.details.lockedForUser = "";
  assert.deepEqual(assignmentEditsFromDraft(input, draft, zone), { description: "Updated instructions\n\nKeep the full second paragraph.", details: { pointsPossible: "30", lockedForUser: "" } });
  assert.deepEqual(input, original, "editing must leave canonical Canvas metadata and the due date intact");
  const blank = assignmentDraftFrom(assignment(), zone);
  blank.description = "";
  assert.deepEqual(assignmentEditsFromDraft(assignment(), blank, zone), { description: "" });
  assert.equal(assignmentEditsFromDraft(input, assignmentDraftFrom({ ...input, userEdits: undefined }, zone), zone), null, "returning every field to Canvas removes the stored corrections");
});

test("detail panel uses corrected text even without an editor callback and enables the editable form when a handler is provided", () => {
  const item = assignment({ userEdits: { description: "Corrected teacher instructions", details: { pointsPossible: "25", lockedForUser: "false", unlockAt: "Ask the teacher" } } });
  const event: CalendarDisplayEvent = { id: "due:1", kind: "due", title: item.title, shortLabel: item.title, date: "2026-10-20", timeLabel: "11:59 pm", startMinutes: null, endMinutes: null, allDay: false, durationMinutes: null, courseCode: "", courseName: item.course, estimate: "—", estimateNote: "", description: "Outdated generated description", assignment: item, assignmentDetails: item.details, summary: "", sourceProvider: "canvas", sourceLabel: "Canvas", resources: [] };
  const props = { event, timeZone: zone, onClose: () => {} };
  const view = renderToStaticMarkup(createElement(DetailPanel, props));
  assert.match(view, /Corrected teacher instructions/);
  assert.match(view, /<dt>Points<\/dt><dd>25<\/dd>/);
  assert.match(view, /<dt>Access<\/dt><dd>false<\/dd>/);
  assert.match(view, /Ask the teacher/);
  assert.equal(view.includes("Outdated generated description"), false);
  const editable = renderToStaticMarkup(createElement(DetailPanel, { ...props, onSaveAssignment: () => {} }));
  assert.match(editable, /<form class="assignment-editor"/);
  assert.match(editable, /name="pointsPossible"[^>]*value="25"/);
  assert.match(editable, /Corrected teacher instructions/);
});
