import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type FocusTarget = {
  id?: string;
  title: string;
  course?: string;
  description?: string;
  durationMinutes: number;
  timeZone: string;
};

export type FocusSession = {
  id: string;
  target: FocusTarget;
  startedAt: number;
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
  status: "running" | "paused" | "completed";
  completedAt?: number;
};

export type FocusRecord = {
  id: string;
  title: string;
  course?: string;
  durationMinutes: number;
  completedAt: number;
  timeZone: string;
};

export type FocusStats = {
  currentStreak: number;
  bestStreak: number;
  todayMinutes: number;
  todaySessions: number;
  totalSessions: number;
  days: { date: string; label: string; completed: boolean }[];
};

const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
export function isFocusTimeZone(value: string) {
  try {
    if (!value || /^[+-]/.test(value)) return false;
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch { return false; }
}
const timeZone = z.string().max(100).refine(isFocusTimeZone, "Choose a valid time zone.");
export const focusTargetSchema = z.object({
  id: z.string().max(1_000).optional(),
  title: z.string().trim().min(1).max(500),
  course: z.string().max(200).optional(),
  description: z.string().max(20_000).optional(),
  durationMinutes: z.number().int().min(1).max(240),
  timeZone,
});

export const focusSessionSchema = z.object({
  id: z.string().min(1).max(200),
  target: focusTargetSchema,
  startedAt: timestamp,
  durationMs: z.number().int().min(60_000).max(240 * 60_000),
  remainingMs: z.number().min(0).max(240 * 60_000),
  endsAt: timestamp.nullable(),
  status: z.enum(["running", "paused", "completed"]),
  completedAt: timestamp.optional(),
}).superRefine((session, context) => {
  if (session.durationMs !== session.target.durationMinutes * 60_000 || session.remainingMs > session.durationMs) {
    context.addIssue({ code: "custom", message: "Invalid focus duration." });
  }
  if (session.status === "running") {
    if (session.endsAt === null || session.endsAt < session.startedAt + session.durationMs || session.remainingMs <= 0 || session.completedAt !== undefined) {
      context.addIssue({ code: "custom", message: "Invalid running focus session." });
    }
  } else if (session.endsAt !== null) {
    context.addIssue({ code: "custom", message: "An inactive timer cannot have a deadline." });
  }
  if (session.status === "completed") {
    if (session.remainingMs !== 0 || session.completedAt === undefined || session.completedAt < session.startedAt + session.durationMs) {
      context.addIssue({ code: "custom", message: "Invalid completed focus session." });
    }
  } else if (session.status === "paused" && (session.remainingMs <= 0 || session.completedAt !== undefined)) {
    context.addIssue({ code: "custom", message: "Invalid paused focus session." });
  }
});

export const focusRecordSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  course: z.string().max(200).optional(),
  durationMinutes: z.number().int().min(1).max(240),
  completedAt: timestamp,
  timeZone,
});

const persistedSchema = z.object({
  version: z.literal(1),
  session: focusSessionSchema.nullable(),
  history: z.array(focusRecordSchema).max(50_000),
  updatedAt: timestamp,
  changeId: z.string().min(1).max(200),
});
type PersistedFocusTimer = z.infer<typeof persistedSchema>;

/** Completion IDs are session IDs, including when two tabs observe the same deadline. */
export function mergeFocusHistory(...histories: readonly FocusRecord[][]): FocusRecord[] {
  const records = new Map<string, FocusRecord>();
  for (const record of histories.flat()) {
    const previous = records.get(record.id);
    if (!previous || record.completedAt < previous.completedAt || (record.completedAt === previous.completedAt && JSON.stringify(record) < JSON.stringify(previous))) {
      records.set(record.id, record);
    }
  }
  return [...records.values()].sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id));
}

export function focusRemainingMs(session: FocusSession | null, now: number) {
  if (!session || session.status === "completed") return 0;
  return session.status === "paused" ? session.remainingMs : Math.max(0, Math.min(session.durationMs, session.endsAt! - now));
}

/** Count local dates rather than elapsed 24-hour intervals, including DST transitions. */
export function calculateFocusStats(history: FocusRecord[], now: number, requestedTimeZone: string): FocusStats {
  const zone = isFocusTimeZone(requestedTimeZone) ? requestedTimeZone : "UTC";
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate();
  const records = mergeFocusHistory(history).filter(record => record.completedAt <= now);
  const dated = records.map(record => ({ record, date: Temporal.Instant.fromEpochMilliseconds(record.completedAt).toZonedDateTimeISO(zone).toPlainDate().toString() }));
  const dates = new Set(dated.map(entry => entry.date));
  let currentStreak = 0;
  let cursor = dates.has(today.toString()) ? today : today.subtract({ days: 1 });
  while (dates.has(cursor.toString())) { currentStreak++; cursor = cursor.subtract({ days: 1 }); }
  let bestStreak = 0;
  let run = 0;
  let previous: Temporal.PlainDate | null = null;
  for (const date of [...dates].sort()) {
    const day = Temporal.PlainDate.from(date);
    run = previous && previous.add({ days: 1 }).equals(day) ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    previous = day;
  }
  const todayRecords = dated.filter(entry => entry.date === today.toString());
  return {
    currentStreak,
    bestStreak,
    todayMinutes: todayRecords.reduce((total, entry) => total + entry.record.durationMinutes, 0),
    todaySessions: todayRecords.length,
    totalSessions: records.length,
    days: Array.from({ length: 7 }, (_, index) => {
      const date = today.subtract({ days: 6 - index });
      return { date: date.toString(), label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][date.dayOfWeek - 1], completed: dates.has(date.toString()) };
    }),
  };
}

export const FOCUS_TIMER_STORAGE_KEY = "zotblock-focus-timer-v1";
const STORAGE_NOTICE = "Your focus timer works for this visit, but browser storage is unavailable. Keep this tab open to retain your session and streak.";
const CORRUPT_NOTICE = "Saved focus timer data could not be loaded. You can start a new session.";
type FocusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type FocusTimerSnapshot = {
  ready: boolean;
  session: FocusSession | null;
  history: FocusRecord[];
  now: number;
  storageNotice: string | null;
};
type FocusTimerStoreOptions = {
  storage?: () => FocusStorage | undefined;
  now?: () => number;
  createId?: () => string;
};
const serverSnapshot: FocusTimerSnapshot = { ready: false, session: null, history: [], now: 0, storageNotice: null };

/** A browser-independent store lets countdowns recover from reloads without writing every second. */
export function createFocusTimerStore(options: FocusTimerStoreOptions = {}) {
  const clock = options.now ?? (() => Date.now());
  const newId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const storage = options.storage ?? (() => typeof localStorage === "undefined" ? undefined : localStorage);
  let data: PersistedFocusTimer = { version: 1, session: null, history: [], updatedAt: 0, changeId: "initial" };
  let snapshot = serverSnapshot;
  let storageNotice: string | null = null;
  const listeners = new Set<() => void>();

  function publish(now: number) {
    const session = data.session?.status === "running" ? { ...data.session, remainingMs: focusRemainingMs(data.session, now) } : data.session;
    snapshot = { ready: true, session, history: data.history, now, storageNotice };
    listeners.forEach(listener => listener());
  }

  function readStored(raw?: string | null): PersistedFocusTimer | null {
    let value = raw;
    if (value === undefined) {
      try {
        const browserStorage = storage();
        if (!browserStorage) { storageNotice = STORAGE_NOTICE; return null; }
        value = browserStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
      } catch { storageNotice = STORAGE_NOTICE; return null; }
    }
    if (value === null) return null;
    try {
      if (value.length > 8_000_000) throw new Error("Saved focus data is too large.");
      const parsed = persistedSchema.parse(JSON.parse(value));
      return { ...parsed, history: mergeFocusHistory(parsed.history) };
    } catch {
      storageNotice = CORRUPT_NOTICE;
      try { storage()?.removeItem(FOCUS_TIMER_STORAGE_KEY); } catch { /* Memory remains usable when storage is blocked. */ }
      return null;
    }
  }

  function latest(a: PersistedFocusTimer, b: PersistedFocusTimer) {
    return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.changeId >= b.changeId) ? a : b;
  }

  function merge(remote: PersistedFocusTimer) {
    const newer = latest(data, remote);
    data = { ...newer, history: mergeFocusHistory(data.history, remote.history) };
    const completion = data.session && data.history.find(record => record.id === data.session!.id);
    if (completion && data.session?.status !== "completed") {
      data = { ...data, session: { ...data.session!, status: "completed", remainingMs: 0, endsAt: null, completedAt: completion.completedAt } };
    }
  }

  function changed(now: number) {
    data = { ...data, updatedAt: Math.max(now, data.updatedAt + 1), changeId: newId() };
  }

  function persist() {
    try {
      const browserStorage = storage();
      if (!browserStorage) { storageNotice = STORAGE_NOTICE; return; }
      // Another tab may have completed a different session since our last read.
      const remote = readStored();
      if (remote) merge(remote);
      browserStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(data));
      if (storageNotice === STORAGE_NOTICE) storageNotice = null;
    } catch { storageNotice = STORAGE_NOTICE; }
  }

  function completeIfDue(now: number) {
    const session = data.session;
    if (!session || session.status !== "running" || session.endsAt! > now) return false;
    const completedAt = session.endsAt!;
    const record: FocusRecord = { id: session.id, title: session.target.title, ...(session.target.course !== undefined ? { course: session.target.course } : {}), durationMinutes: session.target.durationMinutes, completedAt, timeZone: session.target.timeZone };
    data = { ...data, session: { ...session, status: "completed", remainingMs: 0, endsAt: null, completedAt }, history: mergeFocusHistory(data.history, [record]) };
    changed(now);
    return true;
  }

  function reconcile(now: number, raw?: string | null) {
    const remote = readStored(raw);
    if (remote) merge(remote);
    const completed = completeIfDue(now);
    // Repair stale session writes as well as missing credits, without a feedback loop.
    if (completed || (remote && JSON.stringify(data) !== JSON.stringify(remote))) persist();
    publish(now);
  }

  function refresh() { reconcile(clock()); }

  function mutate(action: (now: number) => boolean) {
    const now = clock();
    reconcile(now);
    if (!action(now)) return;
    changed(now);
    persist();
    publish(now);
  }

  function sessionFor(target: FocusTarget, now: number, paused = false): FocusSession {
    const durationMs = target.durationMinutes * 60_000;
    return { id: newId(), target, startedAt: now, durationMs, remainingMs: durationMs, endsAt: paused ? null : now + durationMs, status: paused ? "paused" : "running" };
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot.ready) refresh();
      return () => { listeners.delete(listener); };
    },
    refresh,
    syncStorage(raw?: string | null) { reconcile(clock(), raw); },
    startSession(target: FocusTarget) {
      const parsed = focusTargetSchema.safeParse(target);
      if (!parsed.success) return false;
      const now = clock();
      reconcile(now);
      if (data.session && data.session.status !== "completed") return false;
      data = { ...data, session: sessionFor(parsed.data, now) };
      changed(now); persist(); publish(now);
      return true;
    },
    pauseSession() {
      mutate(now => {
        const session = data.session;
        if (session?.status !== "running") return false;
        data = { ...data, session: { ...session, remainingMs: focusRemainingMs(session, now), endsAt: null, status: "paused" } };
        return true;
      });
    },
    resumeSession() {
      mutate(now => {
        const session = data.session;
        if (session?.status !== "paused") return false;
        data = { ...data, session: { ...session, endsAt: now + session.remainingMs, status: "running" } };
        return true;
      });
    },
    resetSession() {
      mutate(now => {
        if (!data.session) return false;
        data = { ...data, session: sessionFor(data.session.target, now, true) };
        return true;
      });
    },
    cancelSession() {
      mutate(() => {
        if (!data.session) return false;
        data = { ...data, session: null };
        return true;
      });
    },
  };
}
