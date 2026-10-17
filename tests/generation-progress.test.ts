import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationProgressPanel } from "../src/components/generation-progress";
import { getGenerationSnapshot } from "../src/components/generation-provider";
import type { PlanningProgress } from "../src/lib/progress";

type GenerationState = ReturnType<typeof getGenerationSnapshot>;
const update = (stage: PlanningProgress["stage"], completed: number, total: number, message: string, detail?: string): PlanningProgress => ({ stage, status: "running", completed, total, message, detail });
function state(overrides: Partial<GenerationState> = {}): GenerationState {
  return { jobId: "test-job", running: true, mode: "live", preview: null, stages: {}, activity: [], error: null, actionUrl: null, completedBlocks: 0, totalBlocks: null, ...overrides };
}
const render = (generation: GenerationState) => renderToStaticMarkup(createElement(GenerationProgressPanel, { generation, onClear() {} }));

test("one accessible status area shows simultaneous provider states and real counts without bars or a checklist", () => {
  const canvas = update("canvas", 3, 8, "Reading coursework", "Biology 101: loading assignment instructions");
  const gmail = update("gmail", 24, 60, "Reading academic email");
  const calendar = update("calendar", 12, 20, "Reading existing events");
  const html = render(state({ stages: { canvas, gmail, calendar }, activity: [canvas, gmail, calendar] }));
  assert.equal(html.match(/role="status"/g)?.length, 1);
  assert.equal(html.match(/<pre\b/g)?.length, 1);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Canvas \(3\/8\): Reading coursework — Biology 101: loading assignment instructions/);
  assert.match(html, /Gmail \(24\/60\): Reading academic email/);
  assert.match(html, /Google Calendar \(12\/20\): Reading existing events/);
  assert.doesNotMatch(html, /<progress\b|role="progressbar"|<ol\b|<li\b|Waiting to start|href="\/calendar"/);
});

test("a newer stage update replaces its counts in the same area and completed stages do not duplicate activity", () => {
  const canvas = update("canvas", 6, 8, "Reading assignment details", "Chemistry 1");
  const gmail: PlanningProgress = { stage: "gmail", status: "complete", message: "Finished reading email", completed: 60, total: 60 };
  const html = render(state({ stages: { canvas, gmail }, activity: [update("canvas", 1, 8, "Old Canvas update"), gmail, canvas] }));
  assert.match(html, /Canvas \(6\/8\): Reading assignment details — Chemistry 1/);
  assert.doesNotMatch(html, /Old Canvas update|Finished reading email/);
  assert.equal(html.match(/Canvas \(6\/8\)/g)?.length, 1);
});

test("a completed plan offers an explicit calendar link and a dismiss action without progress bars", () => {
  const html = render(state({ running: false, mode: "demo", completedBlocks: 7, totalBlocks: 7 }));
  assert.match(html, /Your plan is ready: 7 study blocks/);
  assert.match(html, /href="\/calendar"[^>]*>View calendar/);
  assert.match(html, /<button[^>]*>Dismiss status<\/button>/);
  assert.doesNotMatch(html, /<progress\b|role="progressbar"|<ol\b|<details\b/);
});

test("an error keeps recovery inside the status panel and never renders unsafe setup links or raw markup", () => {
  const failed = state({ running: false, error: "<b>Provider access failed.</b>", actionUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" });
  const html = render(failed);
  assert.match(html, /&lt;b&gt;Provider access failed\.&lt;\/b&gt;/);
  assert.match(html, /last completed plan is still saved/);
  assert.match(html, /preview is incomplete/);
  assert.match(html, /Open provider setup/);
  assert.match(html, /Dismiss status and try again/);
  assert.doesNotMatch(html, /href="\/calendar"/);
  for (const actionUrl of ["javascript:alert(1)", "http://unsafe.example", "https://user:password@school.example"]) {
    assert.doesNotMatch(render({ ...failed, actionUrl }), /Open provider setup|javascript:|user:password/);
  }
});

test("cleared generation has no progress markup", () => {
  assert.equal(render(state({ mode: null, running: false })), "");
});
