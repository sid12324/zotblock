import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calendarExportAuthorizationUrl, calendarExportReturnMessage, CalendarExportRequestError, GoogleCalendarExport, requestCalendarExport, type GoogleCalendarExportController } from "../src/components/calendar/google-calendar-export";
import type { CalendarExportItem, CalendarExportResult } from "../src/lib/calendar/export";
import type { StudyPlan } from "../src/lib/types";

const plan: StudyPlan = { schemaVersion: "1.0", generatedAt: "2026-10-17T12:00:00Z", mode: "demo", timeZone: "America/Los_Angeles", window: { start: "2026-10-17T07:00:00Z", end: "2026-10-24T07:00:00Z" }, orchestration: { framework: "langchain", model: null }, studyBlocks: [], unscheduledTasks: [], sourceData: { assignments: [], emails: [], calendarEvents: [] }, warnings: [] };
const items: CalendarExportItem[] = Array.from({ length: 6 }, (_, index) => ({ key: `item-${index}`, displayIds: [`display-${index}`], kind: index < 4 ? "study" : "due", summary: `Event ${index}`, description: "", start: { dateTime: "2026-10-18T17:00:00Z", timeZone: plan.timeZone }, end: { dateTime: "2026-10-18T18:00:00Z", timeZone: plan.timeZone } }));
const complete: CalendarExportResult = { total: 6, created: 6, existing: 0, failed: 0, pending: 0, failures: [], calendarUrl: "https://calendar.google.com/calendar/u/0/r" };
function controller(overrides: Partial<GoogleCalendarExportController> = {}): GoogleCalendarExportController {
  return { items, disabledReason: null, running: false, state: { planKey: `demo:${plan.generatedAt}`, scope: "all", running: false, result: null, issue: null }, returnMessage: null, exportItems: async () => {}, ...overrides };
}

test("export defaults to the whole saved plan and offers only-this-event for an academic selection", () => {
  const html = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller(), selectedId: "display-0" }));
  assert.match(html, /Whole plan \(6 events\)/);
  assert.match(html, /value="all" selected=""/);
  assert.match(html, /Only this event/);
  assert.match(html, /4 study blocks \+ 2 deadline reminders/);
  assert.match(html, /primary Google Calendar/);
  const existingGoogle = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller(), selectedId: "google-calendar:existing" }));
  assert.equal(existingGoogle.includes("Only this event"), false);
  const header = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller(), compact: true }));
  assert.match(header, /4 study blocks \+ 2 deadline reminders/);
  assert.equal(header.includes("<select"), false);
});

test("explicit export posts the chosen scope and saved plan; a permission error retains its grant information", async () => {
  const bodies: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/calendar/export");
    assert.equal(init?.method, "POST");
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(complete);
  };
  assert.deepEqual(await requestCalendarExport(plan, "all", "ignored-selection", fetcher), complete);
  await requestCalendarExport(plan, "selected", "display-0", fetcher);
  assert.deepEqual(bodies, [{ plan, scope: "all" }, { plan, scope: "selected", selectedId: "display-0" }]);
  await assert.rejects(requestCalendarExport(plan, "all", undefined, async () => Response.json({ error: "Allow calendar access.", code: "INSUFFICIENT_SCOPE", actionUrl: calendarExportAuthorizationUrl }, { status: 403 })), error => error instanceof CalendarExportRequestError && error.code === "INSUFFICIENT_SCOPE" && error.actionUrl === calendarExportAuthorizationUrl);
});

test("partial results show actual counts, retry remaining events, and escape failure text", () => {
  const result: CalendarExportResult = { ...complete, created: 2, existing: 1, failed: 1, pending: 2, failures: [{ title: "<script>title</script>", message: "Temporary provider error." }] };
  const base = controller();
  const html = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller({ state: { ...base.state, result } }) }));
  assert.match(html, /Retry 3 events/);
  assert.match(html, /2 added · 1 already exported · 1 failed · 2 remaining/);
  assert.match(html, /Retry skips events already added/);
  assert.match(html, /&lt;script&gt;title&lt;\/script&gt;/);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /href="https:\/\/calendar.google.com\/calendar\/u\/0\/r"/);
});

test("permission return requires another explicit export and incomplete plans stay disabled", () => {
  let requests = 0;
  const base = controller({ exportItems: async () => { requests += 1; } });
  const denied = controller({ ...base, state: { ...base.state, issue: { message: "Allow calendar access.", code: "AUTH_REQUIRED" } } });
  const html = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: denied }));
  assert.match(html, /Allow Google Calendar export/);
  assert.match(html, /access=export&amp;returnTo=calendar/);
  const ready = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller({ ...base, returnMessage: calendarExportReturnMessage("?calendarExport=ready") }) }));
  assert.match(ready, /Choose Export to add your events/);
  assert.equal(requests, 0);
  const blocked = renderToStaticMarkup(createElement(GoogleCalendarExport, { controller: controller({ disabledReason: "Finish generating the plan before exporting." }) }));
  assert.match(blocked, /class="google-calendar-export" disabled=""/);
  assert.match(blocked, /Finish generating the plan before exporting/);
});
