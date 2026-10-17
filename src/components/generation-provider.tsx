"use client";

import { useSyncExternalStore } from "react";
import { savePlan } from "@/components/plan-provider";
import { getSavedAssignmentEdits } from "@/components/assignment-edits-provider";
import { studyPreferencesSchema } from "@/lib/preferences";
import { planningWindow } from "@/lib/planner/time";
import { readPlanningStream } from "@/lib/planner/stream";
import type { PlanningProgress, PlanningStage, PlanningStreamEvent } from "@/lib/progress";
import type { StudyPlan, StudyPreferences } from "@/lib/types";

type GenerationSnapshot = {
  jobId: string | null;
  running: boolean;
  mode: "live" | "demo" | null;
  preview: StudyPlan | null;
  stages: Partial<Record<PlanningStage, PlanningProgress>>;
  activity: PlanningProgress[];
  error: string | null;
  actionUrl: string | null;
  completedBlocks: number;
  totalBlocks: number | null;
};
const initialSnapshot: GenerationSnapshot = { jobId: null, running: false, mode: null, preview: null, stages: {}, activity: [], error: null, actionUrl: null, completedBlocks: 0, totalBlocks: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();
function publish(next: GenerationSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function progress(value: PlanningProgress) {
  publish({ ...snapshot, stages: { ...snapshot.stages, [value.stage]: value }, activity: [...snapshot.activity.slice(-29), value] });
}

function accept(event: PlanningStreamEvent) {
  if (event.type === "progress") { progress(event.progress); return; }
  if (event.type === "error") throw Object.assign(new Error(event.error), { actionUrl: event.actionUrl });
  if (event.type === "complete") return;
  if (!snapshot.preview) throw new Error("The study calendar could not be initialized. Try again.");
  if (event.type === "sources") {
    publish({ ...snapshot, preview: { ...snapshot.preview, sourceData: event.sources } });
    return;
  }
  if (event.completed < 1 || event.completed > event.total || event.completed !== snapshot.completedBlocks + 1 || snapshot.preview.studyBlocks.some(block => block.id === event.block.id)) {
    throw new Error("Study blocks arrived out of order. Try generating again.");
  }
  publish({ ...snapshot, preview: { ...snapshot.preview, studyBlocks: [...snapshot.preview.studyBlocks, event.block] }, completedBlocks: event.completed, totalBlocks: event.total });
}

export function startGeneration(mode: "live" | "demo", rawPreferences: StudyPreferences, previousPlan: StudyPlan | null = null) {
  if (snapshot.running) return;
  const preferences = studyPreferencesSchema.parse(rawPreferences);
  const assignmentEdits = getSavedAssignmentEdits();
  const now = new Date().toISOString();
  const preview: StudyPlan = {
    schemaVersion: "1.0", generatedAt: now, mode, timeZone: preferences.timeZone, preferences,
    window: planningWindow(preferences, now), orchestration: { framework: "langchain", model: null },
    studyBlocks: [], unscheduledTasks: [], warnings: [],
    sourceData: { assignments: [], emails: [], calendarEvents: previousPlan?.mode === mode ? previousPlan.sourceData.calendarEvents : [] },
  };
  const jobId = `${Date.now()}`;
  publish({ ...initialSnapshot, jobId, running: true, mode, preview });
  progress({ stage: "connections", status: "running", message: mode === "demo" ? "Preparing sample study plan…" : "Checking your connections…" });
  void (async () => {
    try {
      const response = await fetch("/api/study-plan", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ mode, preferences, assignmentEdits }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw Object.assign(new Error(typeof result?.error === "string" ? result.error : "We couldn’t start your study plan. Try again."), { actionUrl: result?.actionUrl });
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("The server did not return live planning updates. Refresh the app and try again.");
      const terminal: { plan?: StudyPlan } = {};
      await readPlanningStream(response, event => {
        if (snapshot.jobId !== jobId) return;
        if (event.type === "complete") terminal.plan = event.plan;
        else accept(event);
      });
      if (snapshot.jobId !== jobId) return;
      if (!terminal.plan) throw new Error("The connection ended before your plan finished. Try generating again.");
      savePlan(terminal.plan);
      publish({ ...snapshot, running: false, preview: terminal.plan, completedBlocks: terminal.plan.studyBlocks.length, totalBlocks: terminal.plan.studyBlocks.length });
    } catch (error) {
      if (snapshot.jobId !== jobId) return;
      publish({ ...snapshot, running: false, error: error instanceof Error ? error.message : "Study planning failed. Please try again.", actionUrl: error && typeof error === "object" && "actionUrl" in error && typeof error.actionUrl === "string" ? error.actionUrl : null });
    }
  })();
}

export function clearGeneration() { if (!snapshot.running) publish(initialSnapshot); }
export function getGenerationSnapshot() { return snapshot; }
export function useGeneration() { return useSyncExternalStore(subscribe, getGenerationSnapshot, () => initialSnapshot); }
