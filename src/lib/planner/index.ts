import "server-only";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import type { AssignmentEditsMap, SourceData, StudyPlan, StudyPreferences, StudyTask } from "@/lib/types";
import { applyAssignmentEdits } from "@/lib/assignment-edits";
import { reportProgress, type PlanningCallbacks } from "@/lib/progress";
import { collectSources } from "@/lib/integrations/sources";
import { demoData } from "./demo";
import { extractTasks } from "./extract";
import { scheduleTasks } from "./scheduler";
import { planningWindow } from "./time";

type Input = { mode: "live" | "demo"; preferences: StudyPreferences; now: string; assignmentEdits?: AssignmentEditsMap };
type Collected = Input & { sources: SourceData; demoTasks?: StudyTask[] };
type Prepared = Collected & { tasks: StudyTask[]; warnings: string[] };

/** LangChain runs collection, extraction, then conflict-free calendar placement. */
export async function generateStudyPlan(input: Input, callbacks: PlanningCallbacks = {}): Promise<StudyPlan> {
  const report: PlanningCallbacks["onProgress"] = progress => reportProgress(callbacks.onProgress, progress);
  const chain = RunnableSequence.from([
    RunnableLambda.from(async (context: Input): Promise<Collected> => {
      if (context.mode === "demo") {
        const { sources: sampleSources, tasks } = demoData(context.preferences, context.now);
        const sources = applyAssignmentEdits(sampleSources, context.assignmentEdits || {}, context.mode);
        report({ stage: "connections", status: "skipped", message: "Using sample sources; connected accounts are not read." });
        for (const stage of ["canvas", "gmail", "calendar"] as const) {
          report({ stage, status: "skipped", message: `Using sample ${stage === "canvas" ? "Canvas assignments" : stage === "gmail" ? "academic emails" : "calendar events"}.` });
        }
        callbacks.onSources?.(sources);
        return { ...context, sources, demoTasks: tasks };
      }
      if (!process.env.OPENAI_API_KEY) throw new Error("Add OPENAI_API_KEY to .env.local to generate a plan from connected accounts.");
      const collected = await collectSources(context.preferences, planningWindow(context.preferences, context.now), report,
        sources => callbacks.onSources?.(applyAssignmentEdits(sources, context.assignmentEdits || {}, context.mode)));
      const sources = applyAssignmentEdits(collected, context.assignmentEdits || {}, context.mode);
      return { ...context, sources };
    }).withConfig({ runName: "collect_connected_sources" }),
    RunnableLambda.from(async (context: Collected): Promise<Prepared> => {
      if (context.demoTasks) report({ stage: "extraction", status: "skipped", message: `Using ${context.demoTasks.length} sample tasks; no model request is made.`, completed: context.demoTasks.length, total: context.demoTasks.length });
      const extracted = context.demoTasks ? { tasks: context.demoTasks, warnings: [] } : await extractTasks(context.sources, context.preferences, context.now, report);
      return { ...context, ...extracted };
    }).withConfig({ runName: "extract_academic_tasks" }),
    RunnableLambda.from((context: Prepared): StudyPlan => {
      const scheduled = scheduleTasks(context.tasks, context.sources, context.preferences, context.now, report);
      scheduled.studyBlocks.forEach((block, index) => callbacks.onBlock?.(block, index + 1, scheduled.studyBlocks.length));
      const warnings = [...(context.sources.collectionWarnings || []), ...context.warnings];
      if (context.mode === "demo") warnings.push("Sample data only. Connect your accounts to generate a personal study plan.");
      if (!context.tasks.length) warnings.push("No upcoming academic tasks with deadlines were found in the connected sources.");
      if (scheduled.unscheduledTasks.length) warnings.push("Some study time could not fit before a deadline. Review unscheduledTasks or expand your study hours.");
      return {
        schemaVersion: "1.0", generatedAt: context.now, mode: context.mode,
        timeZone: context.preferences.timeZone, preferences: context.preferences,
        orchestration: { framework: "langchain", model: context.mode === "demo" ? null : process.env.OPENAI_MODEL || "gpt-4.1-mini" },
        ...scheduled, sourceData: context.sources, warnings,
      };
    }).withConfig({ runName: "place_study_blocks" }),
  ]).withConfig({ runName: "studyflow_plan", callbacks: [] });
  return chain.invoke(input);
}
