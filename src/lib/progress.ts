import type { SourceData, StudyBlock, StudyPlan } from "./types";

export const planningStages = ["connections", "canvas", "gmail", "calendar", "extraction", "scheduling"] as const;
export type PlanningStage = (typeof planningStages)[number];
export type PlanningProgress = {
  stage: PlanningStage;
  status: "running" | "complete" | "skipped";
  message: string;
  completed?: number;
  total?: number;
  detail?: string;
};
export type ProgressReporter = (progress: PlanningProgress) => void;
export type PlanningCallbacks = {
  onProgress?: ProgressReporter;
  onSources?: (sources: SourceData) => void;
  onBlock?: (block: StudyBlock, completed: number, total: number) => void;
};
export type PlanningStreamEvent =
  | { type: "progress"; progress: PlanningProgress }
  | { type: "sources"; sources: SourceData }
  | { type: "block"; block: StudyBlock; completed: number; total: number }
  | { type: "complete"; plan: StudyPlan }
  | { type: "error"; error: string; code?: string; actionUrl?: string };

/** Display callbacks never change whether a provider import succeeds. */
export function reportProgress(reporter: ProgressReporter | undefined, progress: PlanningProgress) {
  try { reporter?.(progress); } catch { /* A disconnected viewer must not corrupt source collection. */ }
}
