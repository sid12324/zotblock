import test from "node:test";
import assert from "node:assert/strict";
import { calendarEventTime, decodeEmailBody } from "../src/lib/integrations/google";
import { canvasNextPage, plannerAssignment, validateCanvasOrigin } from "../src/lib/integrations/canvas";

test("Canvas accepts institutional HTTPS hosts and rejects SSRF destinations", () => {
  const original = process.env.CANVAS_BASE_URL;
  delete process.env.CANVAS_BASE_URL;
  try {
    assert.equal(validateCanvasOrigin("school.instructure.com"), "https://school.instructure.com");
    for (const host of ["http://school.instructure.com", "https://127.0.0.1", "https://localhost", "https://school.instructure.com.evil.test", "https://evil.test@school.instructure.com", "https://school.instructure.com/api", "https://school.instructure.com:444"]) {
      assert.throws(() => validateCanvasOrigin(host));
    }
    process.env.CANVAS_BASE_URL = "https://canvas.university.edu";
    assert.equal(validateCanvasOrigin("canvas.university.edu"), "https://canvas.university.edu");
    assert.throws(() => validateCanvasOrigin("other.instructure.com"));
  } finally {
    if (original === undefined) delete process.env.CANVAS_BASE_URL;
    else process.env.CANVAS_BASE_URL = original;
  }
});

test("Canvas pagination never forwards authorization to a different origin", () => {
  const origin = "https://school.instructure.com";
  assert.equal(canvasNextPage('<https://school.instructure.com/api/v1/planner/items?page=2>; rel="next", <https://school.instructure.com/api/v1/planner/items?page=1>; rel="current"', origin)?.searchParams.get("page"), "2");
  assert.equal(canvasNextPage(null, origin), null);
  assert.throws(() => canvasNextPage('<https://attacker.test/api/v1/planner/items>; rel="next"', origin));
  assert.throws(() => canvasNextPage('<https://school.instructure.com/login>; rel="next"', origin));
});

test("Canvas skips completed work and maps assignment links safely", () => {
  const origin = "https://school.instructure.com";
  const item = { plannable_id: 12, plannable_type: "assignment", context_name: "Biology", plannable: { title: "Lab report", due_at: "2026-10-19T02:00:00Z", description: "<p>Read chapter 3.</p>" }, html_url: "/courses/2/assignments/12" };
  assert.deepEqual(plannerAssignment(item, origin), { id: "assignment:12", title: "Lab report", course: "Biology", dueAt: "2026-10-19T02:00:00.000Z", description: "Read chapter 3.", url: "https://school.instructure.com/courses/2/assignments/12" });
  assert.equal(plannerAssignment({ ...item, submissions: { submitted: true } }, origin), null);
  assert.equal(plannerAssignment({ ...item, planner_override: { marked_complete: true } }, origin), null);
  assert.equal(plannerAssignment({ ...item, html_url: "javascript:alert(1)" }, origin)?.url, null);
  assert.equal(plannerAssignment({ ...item, plannable_date: "2026-10-21T02:00:00Z" }, origin)?.dueAt, "2026-10-21T02:00:00.000Z");
  assert.throws(() => plannerAssignment({ ...item, plannable: { ...item.plannable, due_at: "invalid" } }, origin));
});

test("all-day calendar boundaries preserve the DST transition", () => {
  const start = calendarEventTime({ date: "2026-11-01" }, "America/Los_Angeles");
  const end = calendarEventTime({ date: "2026-11-02" }, "America/Los_Angeles");
  assert.equal(start, "2026-11-01T07:00:00Z");
  assert.equal(end, "2026-11-02T08:00:00Z");
  assert.equal(Date.parse(end) - Date.parse(start), 25 * 60 * 60 * 1000);
  assert.throws(() => calendarEventTime({ dateTime: "invalid" }, "America/Los_Angeles"));
  assert.throws(() => calendarEventTime(undefined, "America/Los_Angeles"));
});

test("MIME bodies prefer full plain text and ignore attachment files", () => {
  const data = (value: string) => Buffer.from(value).toString("base64url");
  assert.equal(decodeEmailBody({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: data("Assignment due Friday at 11:59 PM") } }, { mimeType: "text/html", body: { data: data("<b>duplicate</b>") } }] }), "Assignment due Friday at 11:59 PM");
  assert.equal(decodeEmailBody({ mimeType: "text/html", body: { data: data("<script>injected()</script><p>Quiz &amp; review</p>") } }), "Quiz & review");
  assert.equal(decodeEmailBody({ mimeType: "text/plain", filename: "attachment.txt", body: { data: data("Attachment content") } }), "");
});
