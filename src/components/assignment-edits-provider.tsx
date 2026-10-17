"use client";

import { useSyncExternalStore } from "react";
import { assignmentEditsMapSchema, assignmentEditsSchema } from "@/lib/assignment-edits";
import type { AssignmentEdits, AssignmentEditsMap } from "@/lib/types";

const STORAGE_KEY = "zotblock-assignment-edits-v1";
const STORAGE_NOTICE = "Assignment corrections are available for this visit, but browser storage is unavailable. Copy your JSON to keep them.";
type Snapshot = { edits: AssignmentEditsMap; ready: boolean; storageNotice: string | null };
const initialSnapshot: Snapshot = { edits: {}, ready: false, storageNotice: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();
function publish(next: Snapshot) { snapshot = next; listeners.forEach(listener => listener()); }
function restore() {
  if (snapshot.ready) return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    publish({ edits: stored ? assignmentEditsMapSchema.parse(JSON.parse(stored)) : {}, ready: true, storageNotice: null });
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
    publish({ edits: {}, ready: true, storageNotice: "Saved assignment corrections could not be loaded. You can enter them again." });
  }
}
function subscribe(listener: () => void) { listeners.add(listener); restore(); return () => { listeners.delete(listener); }; }
export function getSavedAssignmentEdits() { restore(); return snapshot.edits; }
export function saveAssignmentEdits(key: string, value: AssignmentEdits | null) {
  restore();
  const edits = { ...snapshot.edits };
  if (value === null) delete edits[key];
  else edits[key] = assignmentEditsSchema.parse(value);
  const validated = assignmentEditsMapSchema.parse(edits);
  let storageNotice: string | null = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); } catch { storageNotice = STORAGE_NOTICE; }
  publish({ edits: validated, ready: true, storageNotice });
}
export function useAssignmentEdits() { return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot); }
