"use client";

import { useSyncExternalStore } from "react";
import { droppedBlocksSchema, type DroppedBlock } from "@/lib/dropped-blocks";

const STORAGE_KEY = "zotblock-dropped-blocks-v1";
const STORAGE_NOTICE = "Dropped blocks are saved for this visit, but browser storage is unavailable.";
type Snapshot = { blocks: DroppedBlock[]; ready: boolean; storageNotice: string | null };
const initialSnapshot: Snapshot = { blocks: [], ready: false, storageNotice: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function publish(next: Snapshot) { snapshot = next; listeners.forEach(listener => listener()); }

function restore() {
  if (snapshot.ready) return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    publish({ blocks: stored ? droppedBlocksSchema.parse(JSON.parse(stored)) : [], ready: true, storageNotice: null });
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
    publish({ blocks: [], ready: true, storageNotice: "Saved dropped blocks could not be loaded. You can add them again." });
  }
}

function subscribe(listener: () => void) { listeners.add(listener); restore(); return () => { listeners.delete(listener); }; }

function write(blocks: DroppedBlock[]) {
  let storageNotice: string | null = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks)); } catch { storageNotice = STORAGE_NOTICE; }
  publish({ blocks, ready: true, storageNotice });
}

export function addDroppedBlock(block: Omit<DroppedBlock, "id">) {
  restore();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d${Date.now()}`;
  const next = droppedBlocksSchema.parse([...snapshot.blocks, { ...block, id }]);
  write(next);
  return id;
}

export function useDroppedBlocks() { return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot); }
