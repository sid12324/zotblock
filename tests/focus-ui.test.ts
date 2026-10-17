import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FocusExperience, focusClock, parseFocusDuration, type FocusTimerController } from "../src/components/focus/focus-experience";

function timer(overrides: Partial<FocusTimerController> = {}): FocusTimerController {
  return {
    ready: true, session: null, history: [], now: 1_792_281_600_000, storageNotice: null, remainingSeconds: 0,
    stats: { currentStreak: 2, bestStreak: 4, todayMinutes: 50, todaySessions: 1, totalSessions: 8, days: [{ date: "2026-10-17", label: "Sat", completed: true }] },
    startSession: () => true, pauseSession: () => {}, resumeSession: () => {}, resetSession: () => {}, cancelSession: () => {}, ...overrides,
  };
}

const target = { id: "task-1", title: "<script>Read chapter 3</script>", course: "BIO 101", description: "Read and take notes.", durationMinutes: 50, timeZone: "America/New_York" };
const session = { id: "session-1", target, startedAt: 1_792_281_600_000, durationMs: 3_000_000, remainingMs: 1_474_000, endsAt: 1_792_283_074_000, status: "running" as const };

test("direct focus visits offer a standalone timer without requiring a plan", () => {
  const html = renderToStaticMarkup(createElement(FocusExperience, { timer: timer(), timeZone: "America/Los_Angeles" }));
  assert.match(html, /25 <span>min/);
  assert.match(html, /50 <span>min/);
  assert.match(html, /Custom/);
  assert.match(html, /Start focusing/);
  assert.match(html, /What are you working on\?/);
  assert.match(html, /href="\/calendar"/);
  assert.doesNotMatch(html, /Integrations|Export to Google Calendar|Connect Gmail/);
});

test("running and paused sessions expose correct controls and an unannounced countdown", () => {
  const running = renderToStaticMarkup(createElement(FocusExperience, { timer: timer({ session, remainingSeconds: 1474 }), timeZone: "America/Los_Angeles" }));
  assert.match(running, /24:34/);
  assert.match(running, /role="timer" aria-live="off"/);
  assert.match(running, /Pause session/);
  assert.match(running, /Reset/);
  assert.match(running, /End session/);
  assert.match(running, /Your timer will stay with you/);
  assert.match(running, /America\/New York/);
  assert.match(running, /&lt;script&gt;Read chapter 3&lt;\/script&gt;/);
  assert.doesNotMatch(running, /<script>/);
  const paused = renderToStaticMarkup(createElement(FocusExperience, { timer: timer({ session: { ...session, status: "paused", endsAt: null }, remainingSeconds: 1474 }), timeZone: "UTC" }));
  assert.match(paused, /Session paused/);
  assert.match(paused, /Resume session/);
  assert.doesNotMatch(paused, /Pause session/);
});

test("completed sessions show earned credit and explicit next-session choices", () => {
  const html = renderToStaticMarkup(createElement(FocusExperience, { timer: timer({ session: { ...session, status: "completed", remainingMs: 0, endsAt: null, completedAt: 1_792_284_600_000 } }), timeZone: "UTC" }));
  assert.match(html, /Session complete\. Your focus time and streak have been credited/);
  assert.match(html, /50 minutes added to your focus history/);
  assert.match(html, /Start another 25/);
  assert.match(html, /Start another 50/);
  assert.match(html, /Return to calendar/);
  assert.doesNotMatch(html, /End session|Pause session/);
  const loading = renderToStaticMarkup(createElement(FocusExperience, { timer: timer({ ready: false }), timeZone: "UTC" }));
  assert.match(loading, /Loading your session/);
  assert.doesNotMatch(loading, /Start focusing/);
});

test("custom duration parsing rejects fractional or out-of-range sessions and clocks never go negative", () => {
  for (const input of ["", "0", "241", "1.5", "1e2", "-1", "abc"]) assert.equal(parseFocusDuration(input), null);
  assert.equal(parseFocusDuration(" 1 "), 1);
  assert.equal(parseFocusDuration("240"), 240);
  assert.equal(focusClock(-1), "00:00");
  assert.equal(focusClock(1474), "24:34");
  assert.equal(focusClock(14_400), "240:00");
});
