import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFocusStats, createFocusTimerStore, FOCUS_TIMER_STORAGE_KEY,
  focusSessionSchema, focusTargetSchema, mergeFocusHistory,
  type FocusRecord, type FocusTarget,
} from "../src/lib/focus-timer";

const baseline = Date.parse("2026-10-17T18:00:00Z");
const target = (overrides: Partial<FocusTarget> = {}): FocusTarget => ({
  title: "Practice integration", course: "Math 2B", description: "Finish the assigned examples.",
  durationMinutes: 2, timeZone: "America/Los_Angeles", ...overrides,
});

function fixture(initial?: string, blocked = false) {
  const values = new Map<string, string>(initial === undefined ? [] : [[FOCUS_TIMER_STORAGE_KEY, initial]]);
  let now = baseline;
  let writes = 0;
  const storage = {
    getItem(key: string) { if (blocked) throw new Error("Blocked storage"); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error("Blocked storage"); writes++; values.set(key, value); },
    removeItem(key: string) { if (blocked) throw new Error("Blocked storage"); values.delete(key); },
  };
  const createStore = (prefix = "session") => {
    let count = 0;
    return createFocusTimerStore({ storage: () => storage, now: () => now, createId: () => prefix + "-" + ++count });
  };
  return {
    values, createStore, writes: () => writes,
    advance(milliseconds: number) { now += milliseconds; },
    setNow(value: number) { now = value; },
    now: () => now,
    raw: () => values.get(FOCUS_TIMER_STORAGE_KEY)!,
  };
}

test("absolute deadlines exclude pauses and credit natural completion once at its deadline", () => {
  const env = fixture();
  const store = env.createStore();
  assert.equal(store.getSnapshot().ready, false);
  assert.equal(store.startSession(target()), true);
  const originalId = store.getSnapshot().session!.id;
  env.advance(40_250);
  store.refresh();
  assert.equal(store.getSnapshot().session!.remainingMs, 79_750);
  store.pauseSession();
  assert.equal(store.getSnapshot().session!.endsAt, null);
  env.advance(10 * 60_000);
  store.refresh();
  assert.equal(store.getSnapshot().session!.remainingMs, 79_750);
  assert.equal(store.getSnapshot().history.length, 0);
  store.resumeSession();
  const deadline = env.now() + 79_750;
  assert.equal(store.getSnapshot().session!.endsAt, deadline);
  env.advance(79_251);
  store.refresh();
  assert.equal(store.getSnapshot().session!.remainingMs, 499);
  env.advance(30 * 60_000);
  store.refresh();
  assert.equal(store.getSnapshot().session!.status, "completed");
  assert.equal(store.getSnapshot().session!.completedAt, deadline);
  assert.deepEqual(store.getSnapshot().history, [{
    id: originalId, title: target().title, course: "Math 2B",
    durationMinutes: 2, completedAt: deadline, timeZone: "America/Los_Angeles",
  }]);
  const writes = env.writes();
  store.refresh();
  store.pauseSession();
  store.resumeSession();
  assert.equal(store.getSnapshot().history.length, 1);
  assert.equal(env.writes(), writes);
});

test("start protects active sessions; reset has a fresh paused identity and cancel gives no credit", () => {
  const env = fixture();
  const store = env.createStore();
  store.startSession(target());
  const firstId = store.getSnapshot().session!.id;
  assert.equal(store.startSession(target({ title: "Replacement" })), false);
  env.advance(30_000);
  store.resetSession();
  const reset = store.getSnapshot().session!;
  assert.notEqual(reset.id, firstId);
  assert.deepEqual(reset.target, target());
  assert.equal(reset.status, "paused");
  assert.equal(reset.remainingMs, 120_000);
  assert.equal(reset.endsAt, null);
  assert.equal(store.startSession(target()), false);
  env.advance(60 * 60_000);
  store.refresh();
  assert.equal(store.getSnapshot().history.length, 0);
  store.resumeSession();
  env.advance(20_000);
  store.cancelSession();
  env.advance(120_000);
  store.refresh();
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().history.length, 0);
  assert.equal(store.startSession(target({ durationMinutes: 1 })), true);
  env.advance(60_000);
  store.refresh();
  assert.equal(store.getSnapshot().history.length, 1);
  assert.equal(store.startSession(target({ title: "Next session" })), true);
  assert.equal(store.getSnapshot().session!.target.title, "Next session");
  assert.equal(store.getSnapshot().history.length, 1);
});

test("reload recovers running deadlines and background completion without per-second writes", () => {
  const env = fixture();
  const first = env.createStore("first");
  first.startSession(target());
  const id = first.getSnapshot().session!.id;
  const writes = env.writes();
  for (let tick = 0; tick < 15; tick++) { env.advance(1_000); first.refresh(); }
  assert.equal(env.writes(), writes);
  const restored = env.createStore("restored");
  restored.refresh();
  assert.equal(restored.getSnapshot().session!.id, id);
  assert.equal(restored.getSnapshot().session!.remainingMs, 105_000);
  env.advance(20 * 60_000);
  const afterBackground = env.createStore("background");
  afterBackground.refresh();
  assert.equal(afterBackground.getSnapshot().session!.status, "completed");
  assert.equal(afterBackground.getSnapshot().history[0].completedAt, baseline + 120_000);
  assert.equal(afterBackground.getSnapshot().history[0].id, id);
  first.refresh();
  restored.refresh();
  assert.equal(JSON.parse(env.raw()).history.length, 1);
});

test("cross-tab changes sync before actions and simultaneous completion keeps one history entry", () => {
  const env = fixture();
  const first = env.createStore("first");
  const second = env.createStore("second");
  first.startSession(target({ durationMinutes: 1 }));
  second.refresh();
  env.advance(15_000);
  first.pauseSession();
  second.syncStorage(env.raw());
  assert.equal(second.getSnapshot().session!.status, "paused");
  second.resumeSession();
  first.syncStorage(env.raw());
  assert.equal(first.getSnapshot().session!.status, "running");
  const deadline = first.getSnapshot().session!.endsAt!;
  env.setNow(deadline);
  first.refresh();
  second.refresh();
  first.syncStorage(env.raw());
  assert.equal(first.getSnapshot().history.length, 1);
  assert.equal(second.getSnapshot().history.length, 1);
  assert.equal(JSON.parse(env.raw()).history.length, 1);
  first.cancelSession();
  second.pauseSession();
  assert.equal(second.getSnapshot().session, null);
});

test("cross-tab merges restore missing credits and repair stale session overwrites for reload", () => {
  const env = fixture();
  const first = env.createStore("z-winner");
  first.startSession(target({ durationMinutes: 1 }));
  const initial = env.raw();
  const otherEnv = fixture(initial);
  const second = otherEnv.createStore("a-stale");
  second.refresh();
  env.advance(5_000);
  otherEnv.advance(5_000);
  first.pauseSession();
  const winning = env.raw();
  second.cancelSession();
  const stale = otherEnv.raw();
  env.values.set(FOCUS_TIMER_STORAGE_KEY, stale);
  first.syncStorage(stale);
  assert.equal(first.getSnapshot().session!.status, "paused");
  assert.equal(JSON.parse(env.raw()).session.status, "paused");
  const reload = env.createStore("reload");
  reload.refresh();
  assert.equal(reload.getSnapshot().session!.status, "paused");

  // Two tab branches can each credit a different session before observing the other.
  const left = fixture(winning);
  const leftStore = left.createStore("left");
  leftStore.refresh();
  leftStore.resumeSession();
  left.advance(60_000);
  leftStore.refresh();
  const right = fixture();
  const rightStore = right.createStore("right");
  rightStore.startSession(target({ title: "Another task", durationMinutes: 1 }));
  right.advance(60_000);
  rightStore.refresh();
  const rightRaw = right.raw();
  left.values.set(FOCUS_TIMER_STORAGE_KEY, rightRaw);
  leftStore.syncStorage(rightRaw);
  assert.equal(leftStore.getSnapshot().history.length, 2);
  assert.equal(JSON.parse(left.raw()).history.length, 2);
  right.values.set(FOCUS_TIMER_STORAGE_KEY, left.raw());
  rightStore.syncStorage(left.raw());
  rightStore.syncStorage(right.raw());
  assert.equal(rightStore.getSnapshot().history.length, 2);
});

test("invalid targets and corrupt saved data cannot create completion credits", () => {
  const valid = fixture();
  const store = valid.createStore();
  for (const invalid of [
    { durationMinutes: 0 }, { durationMinutes: 241 }, { durationMinutes: 1.5 },
    { title: " " }, { title: "x".repeat(501) }, { course: "x".repeat(201) },
    { description: "x".repeat(20_001) }, { id: "x".repeat(1_001) },
    { timeZone: "America/Not_A_Zone" }, { timeZone: "+08:00" },
  ]) assert.equal(store.startSession(target(invalid)), false);
  assert.equal(valid.writes(), 0);
  assert.equal(focusTargetSchema.safeParse(target({ durationMinutes: 240, title: "x".repeat(500) })).success, true);
  store.startSession(target({ durationMinutes: 1 }));
  const saved = JSON.parse(valid.raw());
  const tooShort = { ...saved.session, endsAt: saved.session.startedAt + 1 };
  assert.equal(focusSessionSchema.safeParse(tooShort).success, false);
  for (const bad of ["{broken", "null", JSON.stringify({ ...saved, session: tooShort }), JSON.stringify({ ...saved, history: [{ id: "fake" }] })]) {
    const env = fixture(bad);
    const restored = env.createStore();
    restored.refresh();
    assert.equal(restored.getSnapshot().ready, true);
    assert.equal(restored.getSnapshot().session, null);
    assert.deepEqual(restored.getSnapshot().history, []);
    assert.match(restored.getSnapshot().storageNotice!, /could not be loaded/);
    assert.equal(env.values.has(FOCUS_TIMER_STORAGE_KEY), false);
    assert.equal(restored.startSession(target()), true);
  }
});

test("blocked browser storage keeps timer actions and natural completion usable in memory", () => {
  const env = fixture(undefined, true);
  const store = env.createStore();
  assert.equal(store.startSession(target({ durationMinutes: 1 })), true);
  assert.match(store.getSnapshot().storageNotice!, /storage is unavailable/);
  env.advance(10_000);
  store.pauseSession();
  env.advance(120_000);
  store.resumeSession();
  env.advance(50_000);
  store.refresh();
  assert.equal(store.getSnapshot().session!.status, "completed");
  assert.equal(store.getSnapshot().history.length, 1);
  assert.equal(env.writes(), 0);
});

const record = (id: string, completedAt: string, durationMinutes = 25): FocusRecord => ({
  id, title: "Completed study", durationMinutes, completedAt: Date.parse(completedAt), timeZone: "UTC",
});

test("streaks and last seven days use the requested local dates across midnight and DST", () => {
  const history = [
    record("fri", "2026-03-07T07:30:00Z"), // Friday 23:30 PST.
    record("sat", "2026-03-08T07:30:00Z"), // Saturday 23:30 PST.
    record("sun-before", "2026-03-08T09:30:00Z", 50),
    record("sun-after", "2026-03-08T10:30:00Z"), // DST skipped 02:00.
  ];
  const monday = Date.parse("2026-03-09T19:00:00Z");
  const stats = calculateFocusStats(history, monday, "America/Los_Angeles");
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.bestStreak, 3);
  assert.equal(stats.todayMinutes, 0);
  assert.equal(stats.todaySessions, 0);
  assert.equal(stats.totalSessions, 4);
  assert.deepEqual(stats.days.slice(-4), [
    { date: "2026-03-06", label: "Fri", completed: true },
    { date: "2026-03-07", label: "Sat", completed: true },
    { date: "2026-03-08", label: "Sun", completed: true },
    { date: "2026-03-09", label: "Mon", completed: false },
  ]);
  assert.equal(stats.days.length, 7);
  assert.equal(calculateFocusStats(history, Date.parse("2026-03-10T07:00:00Z"), "America/Los_Angeles").currentStreak, 0);
  const sunday = calculateFocusStats(history, Date.parse("2026-03-08T20:00:00Z"), "America/Los_Angeles");
  assert.equal(sunday.todayMinutes, 75);
  assert.equal(sunday.todaySessions, 2);
  assert.equal(calculateFocusStats(history, monday, "UTC").bestStreak, 2);
});

test("repeated DST hours share one date and duplicate IDs never add minutes or sessions", () => {
  const first = record("first", "2026-11-01T08:30:00Z");
  const history = [first, { ...first }, record("second", "2026-11-01T09:30:00Z", 50)];
  const stats = calculateFocusStats(history, Date.parse("2026-11-01T20:00:00Z"), "America/Los_Angeles");
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.bestStreak, 1);
  assert.equal(stats.todayMinutes, 75);
  assert.equal(stats.todaySessions, 2);
  assert.equal(stats.totalSessions, 2);
  assert.equal(mergeFocusHistory(history).length, 2);
  assert.equal(calculateFocusStats(history, Date.parse("2026-11-01T20:00:00Z"), "invalid").days.at(-1)!.date, "2026-11-01");
});
