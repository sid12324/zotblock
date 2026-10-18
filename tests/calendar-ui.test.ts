import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarDisplayEvent } from "../src/lib/calendar/events";
import { DayView, WeekView } from "../src/components/calendar/calendar-views";
import { DetailPanel } from "../src/components/calendar/detail-panel";
import { calendarNow, eventIsOngoing, HOUR_HEIGHT, layoutTimedEvents } from "../src/components/calendar/time-grid";

function event(id: string, startMinutes: number, endMinutes: number, overrides: Partial<CalendarDisplayEvent> = {}): CalendarDisplayEvent {
  return { id, kind: "class", title: id, shortLabel: id, date: "2026-10-17", timeLabel: "", startMinutes, endMinutes, durationMinutes: endMinutes - startMinutes, allDay: false, courseCode: "", courseName: "", estimate: "", estimateNote: "", description: "", summary: "", sourceProvider: "google-calendar", sourceLabel: "Google Calendar", resources: [], ...overrides };
}

test("the calendar entry imports the layout CSS required to turn Week and Day markup into a timeline", () => {
  const entry = readFileSync(path.join(process.cwd(), "src/app/calendar/page.tsx"), "utf8");
  assert.match(entry, /import\s+["']\.\/calendar\.css["']/);
  const css = readFileSync(path.join(process.cwd(), "src/app/calendar/calendar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
  function declarations(selector: string) {
    return rules.filter(([, selectors]) => selectors.split(",").some(value => value.trim() === `.zot-calendar ${selector}`)).map(([, , body]) => body).join(" ").replace(/\s/g, "");
  }
  assert.match(declarations(".time-grid"), /position:relative;/);
  for (const selector of [".time-grid-heading", ".time-grid-rail", ".time-grid-body"]) {
    assert.match(declarations(selector), /display:grid;/, `${selector} must use shared day columns`);
    assert.match(declarations(selector), /grid-template-columns:var\(--time-gutter\)repeat\(var\(--day-count\),minmax\(0,1fr\)\);/);
  }
  assert.match(declarations(".time-grid-body"), /height:calc\(var\(--hour-height\)\*24\);/);
  assert.equal(HOUR_HEIGHT * 24, 1824);
  assert.match(declarations(".time-day-track"), /position:relative;/);
  assert.match(declarations(".time-day-track"), /height:100%;/);
  assert.match(declarations(".time-event"), /position:absolute;/);
  assert.match(declarations(".time-event"), /min-height:0;/, "event duration must not be inflated by a card minimum height");
  assert.match(declarations(".time-grid-heading"), /position:sticky;/);
  assert.match(declarations(".time-grid-rail"), /position:sticky;/);
  assert.match(declarations(".current-time-line"), /position:absolute;/);
  assert.match(declarations(".current-time-line"), /height:1px;/);
  assert.match(declarations(".rail-day"), /overflow-y:auto;/);
  assert.match(declarations(".time-grid-week"), /min-width:/);
  assert.match(declarations(".time-grid-day"), /min-width:/);
});

test("Google events and study blocks retain exact times and share lanes only when overlapping", () => {
  const input = [event("meeting", 540, 600), event("study", 570, 630, { kind: "study", sourceProvider: "canvas" }), event("next", 630, 635)];
  const placed = layoutTimedEvents(input, "America/Los_Angeles");
  assert.deepEqual(placed.map(item => [item.event.id, item.startMinutes, item.endMinutes, item.lane, item.laneCount]), [["meeting", 540, 600, 0, 2], ["study", 570, 630, 1, 2], ["next", 630, 635, 0, 1]]);
  assert.equal(input[1].startMinutes, 570);
  assert.equal(placed[2].endMinutes - placed[2].startMinutes, 5, "short events must not acquire a card minimum duration");
});

test("transitive overlap groups use stable lanes while touching end/start boundaries do not overlap", () => {
  const input = [event("c", 600, 660), event("a", 540, 600), event("b", 570, 630), event("d", 660, 720)];
  const placed = layoutTimedEvents(input, "UTC");
  assert.deepEqual(placed.map(item => [item.event.id, item.lane, item.laneCount]), [["a", 0, 2], ["b", 1, 2], ["c", 0, 2], ["d", 0, 1]]);
  assert.deepEqual(layoutTimedEvents([...input].reverse(), "UTC"), placed);
});

test("all-day events and deadlines are excluded from timed lanes", () => {
  const placed = layoutTimedEvents([event("all-day", 0, 1440, { allDay: true }), event("due", 720, 720, { kind: "due" }), event("unknown", 0, 0, { startMinutes: null }), event("late", 1435, 1440)], "UTC");
  assert.deepEqual(placed.map(item => [item.event.id, item.startMinutes, item.endMinutes]), [["late", 1435, 1440]]);
});

test("current-time date and position use the plan timezone across date boundaries and DST", () => {
  const instant = Temporal.Instant.from("2026-10-18T02:17:00Z");
  const la = calendarNow("America/Los_Angeles", instant);
  const tokyo = calendarNow("Asia/Tokyo", instant);
  assert.equal(la.date, "2026-10-17");
  assert.equal(la.minutes, 19 * 60 + 17);
  assert.equal(tokyo.date, "2026-10-18");
  assert.equal(tokyo.minutes, 11 * 60 + 17);
  const before = calendarNow("America/Los_Angeles", Temporal.Instant.from("2026-11-01T08:30:00Z"));
  const after = calendarNow("America/Los_Angeles", Temporal.Instant.from("2026-11-01T09:30:00Z"));
  assert.equal(before.minutes, 90);
  assert.equal(after.minutes, 90);
});

test("ongoing state follows actual instants and uses an exclusive end", () => {
  const item = event("fold", 90, 90, { start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:30:00Z" });
  assert.equal(eventIsOngoing(item, calendarNow("America/Los_Angeles", Temporal.Instant.from("2026-11-01T09:00:00Z"))), true);
  assert.equal(eventIsOngoing(item, calendarNow("America/Los_Angeles", Temporal.Instant.from(item.end!))), false);
  assert.equal(eventIsOngoing({ ...item, allDay: true }, calendarNow("America/Los_Angeles", Temporal.Instant.from(item.start!))), false);
});

test("clock changes split actual event intervals without inventing a minimum duration or spanning a skipped hour", () => {
  const fall = event("fall", 90, 90, { date: "2026-11-01", durationMinutes: 60, start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:30:00Z" });
  const spring = event("spring", 90, 210, { date: "2026-03-08", durationMinutes: 60, start: "2026-03-08T09:30:00Z", end: "2026-03-08T10:30:00Z" });
  assert.deepEqual(layoutTimedEvents([fall], "America/Los_Angeles").map(item => [item.startMinutes, item.endMinutes, item.clockChange]), [[60, 90, true], [90, 120, true]]);
  assert.deepEqual(layoutTimedEvents([spring], "America/Los_Angeles").map(item => [item.startMinutes, item.endMinutes, item.clockChange]), [[90, 120, true], [180, 210, true]]);
});

test("Week and Day render one current-time marker only when that local date is visible", () => {
  const now = calendarNow("America/Los_Angeles", Temporal.Instant.from("2026-10-18T02:17:00Z"));
  const props = { cursor: new Date(2026, 9, 17), today: new Date(2026, 9, 17), events: [], selectedId: null, completedKeys: new Set<string>(), onSelect: () => {}, now, timeZone: "America/Los_Angeles" };
  for (const View of [WeekView, DayView]) {
    const current = renderToStaticMarkup(createElement(View, props));
    const future = renderToStaticMarkup(createElement(View, { ...props, cursor: new Date(2026, 9, 26) }));
    assert.equal(current.match(/class="current-time-line"/g)?.length, 1);
    assert.match(current, /Current time:.*America\/Los_Angeles/);
    assert.equal(future.includes('class="current-time-line"'), false);
  }
});

test("assignment details retain zero/false facts and full plain-text instructions without rendering raw HTML or unsafe attachments", () => {
  const item = event("Canvas study", 540, 600, { kind: "study", sourceProvider: "canvas", description: "Read every section.\n<b>Literal text</b>", assignmentDetails: { pointsPossible: 0, questionCount: 0, lockedForUser: false, allowedAttempts: -1, unlockAt: null, instructionsHtml: "<script>raw-metadata-only</script>", attachments: [{ title: "Rubric", url: "https://school.example/rubric.pdf" }, { title: "Unsafe", url: "javascript:alert(1)" }] } });
  const html = renderToStaticMarkup(createElement(DetailPanel, { event: item, timeZone: "America/Los_Angeles", onClose: () => {} }));
  assert.match(html, /Read every section\.\n&lt;b&gt;Literal text&lt;\/b&gt;/);
  assert.match(html, /<dt>Points<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Questions<\/dt><dd>0<\/dd>/);
  assert.match(html, /Not locked/);
  assert.match(html, /Unlimited/);
  assert.match(html, /href="https:\/\/school.example\/rubric.pdf"/);
  assert.equal(html.includes("raw-metadata-only"), false);
  assert.equal(html.includes("javascript:"), false);
});
