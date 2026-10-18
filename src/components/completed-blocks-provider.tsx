"use client";

import { useSyncExternalStore } from "react";
import { completedBlocksSchema, toggleCompletedBlock } from "@/lib/completed-blocks";

const STORAGE_KEY = "zotblock-completed-blocks-v1";
const STORAGE_NOTICE = "Completed study blocks are saved for this visit, but browser storage is unavailable.";
type Snapshot = { completed: string[]; ready: boolean; storageNotice: string | null };
const initialSnapshot: Snapshot = { completed: [], ready: false, storageNotice: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function publish(next: Snapshot) { snapshot = next; listeners.forEach(listener => listener()); }

function restore() {
  if (snapshot.ready) return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    publish({ completed: stored ? completedBlocksSchema.parse(JSON.parse(stored)) : [], ready: true, storageNotice: null });
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
    publish({ completed: [], ready: true, storageNotice: "Saved completed study blocks could not be loaded. You can mark them again." });
  }
}

function subscribe(listener: () => void) { listeners.add(listener); restore(); return () => { listeners.delete(listener); }; }

export function getSavedCompletedBlocks() { restore(); return snapshot.completed; }

export function toggleSavedCompletedBlock(key: string) {
  restore();
  const completed = toggleCompletedBlock(snapshot.completed, key);
  let storageNotice: string | null = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(completed)); } catch { storageNotice = STORAGE_NOTICE; }
  publish({ completed, ready: true, storageNotice });
}

export function useCompletedBlocks() { return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot); }
