"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { calculateFocusStats, createFocusTimerStore, FOCUS_TIMER_STORAGE_KEY, type FocusTarget } from "@/lib/focus-timer";

export type { FocusTarget, FocusSession, FocusRecord, FocusStats } from "@/lib/focus-timer";

const store = createFocusTimerStore();
let mounts = 0;
let stopLifecycle: (() => void) | null = null;

function mountTimer() {
  mounts++;
  if (mounts === 1) {
    store.refresh();
    const interval = window.setInterval(store.refresh, 1_000);
    const onVisibility = () => { if (document.visibilityState === "visible") store.refresh(); };
    const onFocus = () => store.refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === FOCUS_TIMER_STORAGE_KEY || event.key === null) store.syncStorage(event.newValue);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    stopLifecycle = () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => {
    mounts--;
    if (mounts === 0) { stopLifecycle?.(); stopLifecycle = null; }
  };
}

export function FocusTimerProvider({ children }: { children: ReactNode }) {
  useEffect(mountTimer, []);
  return children;
}

export function startFocusSession(target: FocusTarget): boolean {
  return typeof window !== "undefined" && store.startSession(target);
}

function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
}

export function useFocusTimer(timeZone?: string) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const zone = snapshot.session?.target.timeZone || timeZone || browserTimeZone();
  const stats = useMemo(() => calculateFocusStats(snapshot.history, snapshot.now, zone), [snapshot.history, snapshot.now, zone]);
  return {
    ...snapshot,
    remainingSeconds: Math.ceil((snapshot.session?.remainingMs ?? 0) / 1_000),
    stats,
    startSession: startFocusSession,
    pauseSession: store.pauseSession,
    resumeSession: store.resumeSession,
    resetSession: store.resetSession,
    cancelSession: store.cancelSession,
  };
}
