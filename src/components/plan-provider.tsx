"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { useAssignmentEdits } from "@/components/assignment-edits-provider";
import { applyPlanAssignmentEdits } from "@/lib/assignment-edits";
import { isStudyPlan } from "@/lib/plan-validation";
export { isStudyPlan } from "@/lib/plan-validation";
import type { StudyPlan } from "@/lib/types";

const STORAGE_KEY = "studyflow-plan";
const RESTORE_NOTICE = "Your saved plan couldn’t be loaded. Generate a new plan from Integrations.";


type PlanContextValue = {
  plan: StudyPlan | null;
  ready: boolean;
  storageNotice: string | null;
  savePlan: (plan: StudyPlan) => void;
};
const PlanContext = createContext<PlanContextValue | null>(null);
type PlanSnapshot = Pick<PlanContextValue, "plan" | "ready" | "storageNotice">;
type PlanStorage = Pick<Storage, "getItem" | "removeItem">;
const initialSnapshot: PlanSnapshot = { plan: null, ready: false, storageNotice: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function publish(nextSnapshot: PlanSnapshot) {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!snapshot.ready) {
    try {
      publish(restoreSavedPlan(sessionStorage));
    } catch {
      publish({ plan: null, ready: true, storageNotice: RESTORE_NOTICE });
    }
  }
  return () => { listeners.delete(listener); };
}

export function restoreSavedPlan(storage: PlanStorage): PlanSnapshot {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return { plan: null, ready: true, storageNotice: null };
    const parsed: unknown = JSON.parse(stored);
    if (!isStudyPlan(parsed)) throw new Error("Invalid saved plan");
    return { plan: parsed, ready: true, storageNotice: null };
  } catch {
    try { storage.removeItem(STORAGE_KEY); } catch { /* Storage can be disabled. */ }
    return { plan: null, ready: true, storageNotice: RESTORE_NOTICE };
  }
}

export function savePlan(plan: StudyPlan) {
  if (!isStudyPlan(plan)) throw new Error("The generated plan could not be read. Try generating it again.");
  let storageNotice: string | null = null;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    storageNotice = "Browser storage is unavailable. You can copy or download this plan before leaving the page.";
  }
  publish({ plan, ready: true, storageNotice });
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => initialSnapshot;

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const corrections = useAssignmentEdits();
  const plan = useMemo(() => state.plan ? applyPlanAssignmentEdits(state.plan, corrections.edits) : null, [state.plan, corrections.edits]);
  const storageNotice = [state.storageNotice, corrections.storageNotice].filter(Boolean).join(" ") || null;
  return <PlanContext.Provider value={{ plan, ready: state.ready && corrections.ready, storageNotice, savePlan }}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) throw new Error("usePlan must be used within PlanProvider");
  return context;
}
