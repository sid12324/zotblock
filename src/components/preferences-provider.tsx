"use client";

import { useSyncExternalStore } from "react";
import { defaultStudyPreferences, studyPreferencesSchema } from "@/lib/preferences";
import type { StudyPreferences } from "@/lib/types";

const STORAGE_KEY = "zotblock-preferences-v1";
type Snapshot = { preferences: StudyPreferences; completed: boolean; ready: boolean; storageNotice: string | null };
const initialSnapshot: Snapshot = { preferences: defaultStudyPreferences(), completed: false, ready: false, storageNotice: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function browserDefaults() {
  try { return defaultStudyPreferences(Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { return defaultStudyPreferences(); }
}

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function readSavedPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return publish({ preferences: browserDefaults(), completed: false, ready: true, storageNotice: null });
    const saved = JSON.parse(raw);
    const parsed = studyPreferencesSchema.safeParse(saved.preferences);
    if (!parsed.success) throw new Error("Invalid saved preferences");
    publish({ preferences: parsed.data, completed: saved.completed === true, ready: true, storageNotice: null });
  } catch {
    publish({ preferences: browserDefaults(), completed: false, ready: true, storageNotice: "Saved preferences could not be loaded. You can set them again." });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!snapshot.ready) readSavedPreferences();
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) readSavedPreferences(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function savePreferences(preferences: StudyPreferences) {
  const parsed = studyPreferencesSchema.parse(preferences);
  let storageNotice: string | null = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferences: parsed, completed: true })); }
  catch { storageNotice = "Preferences are available for this visit. Browser storage is unavailable, so they may need to be entered again after leaving the app."; }
  publish({ preferences: parsed, completed: true, ready: true, storageNotice });
}

export function useStudyPreferences() {
  return { ...useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot), savePreferences };
}
