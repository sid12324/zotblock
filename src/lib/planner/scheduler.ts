import { Temporal } from "@js-temporal/polyfill";
import type { SourceData, StudyBlock, StudyPreferences, StudyTask, StudyPlan } from "@/lib/types";
import { planningWindow } from "./time";
import { preferencesFromOnboarding } from "@/lib/preferences";
import { reportProgress, type ProgressReporter } from "@/lib/progress";

const MINUTE = 60_000;
const BREAK_MINUTES = 10;
type Interval = { start: number; end: number };

function epoch(value: string) {
  return Temporal.Instant.from(value).epochMilliseconds;
}

/** A deterministic scheduler owns time placement, so model output cannot double-book a calendar. */
function legacyScheduleTasks(
  tasks: StudyTask[], sources: SourceData, preferences: StudyPreferences, now: string,
): Pick<StudyPlan, "studyBlocks" | "unscheduledTasks" | "window"> {
  const window = planningWindow(preferences, now);
  const nowMs = epoch(now);
  const endMs = epoch(window.end);
  const occupied: Interval[] = sources.calendarEvents.map(event => {
    const start = epoch(event.start);
    const end = epoch(event.end);
    if (end <= start) throw new Error("A calendar event has an invalid time range. Please correct it and try again.");
    return { start, end };
  });
  const studyBlocks: StudyBlock[] = [];
  const unscheduledTasks: StudyPlan["unscheduledTasks"] = [];
  const firstDay = Temporal.Instant.from(now).toZonedDateTimeISO(preferences.timeZone).startOfDay();
  const priority = { high: 0, medium: 1, low: 2 };
  const ordered = [...tasks].sort((a, b) => epoch(a.dueAt) - epoch(b.dueAt)
    || priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id));

  for (const task of ordered) {
    let remaining = task.estimatedMinutes;
    const deadline = Math.min(epoch(task.dueAt), endMs);
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 600) {
      throw new Error("A task has an invalid study duration.");
    }
    for (let day = 0; day < preferences.days && remaining > 0; day++) {
      const date = firstDay.add({ days: day }).toPlainDate();
      const begin = date.toZonedDateTime({ timeZone: preferences.timeZone, plainTime: { hour: preferences.dayStart } });
      const finish = preferences.dayEnd === 24
        ? date.add({ days: 1 }).toZonedDateTime({ timeZone: preferences.timeZone, plainTime: "00:00" })
        : date.toZonedDateTime({ timeZone: preferences.timeZone, plainTime: { hour: preferences.dayEnd } });
      let cursor = Math.ceil(Math.max(begin.epochMilliseconds, nowMs) / (15 * MINUTE)) * 15 * MINUTE;
      const dayEnd = Math.min(finish.epochMilliseconds, deadline);
      while (remaining > 0 && cursor < dayEnd) {
        occupied.sort((a, b) => a.start - b.start);
        const conflict = occupied.find(interval => interval.end > cursor && interval.start <= cursor);
        if (conflict) { cursor = conflict.end; continue; }
        const nextEvent = occupied.find(interval => interval.start > cursor);
        const gapEnd = Math.min(dayEnd, nextEvent?.start ?? dayEnd);
        const available = Math.floor((gapEnd - cursor) / (5 * MINUTE)) * 5;
        const duration = Math.min(remaining, preferences.blockMinutes, available);
        if (duration < Math.min(25, remaining)) {
          cursor = nextEvent ? nextEvent.end : dayEnd;
          continue;
        }
        const end = cursor + duration * MINUTE;
        studyBlocks.push({
          id: `study-${task.source}-${task.sourceId}-${studyBlocks.length + 1}`,
          summary: `Study: ${task.title}`,
          description: `${task.course ? `${task.course} · ` : ""}${duration} minutes of focused study.${task.url ? `\nSource: ${task.url}` : ""}`,
          start: { dateTime: new Date(cursor).toISOString(), timeZone: preferences.timeZone },
          end: { dateTime: new Date(end).toISOString(), timeZone: preferences.timeZone },
          source: { provider: task.source, id: task.sourceId, title: task.title, dueAt: task.dueAt, url: task.url },
          priority: task.priority,
        });
        occupied.push({ start: cursor, end: end + BREAK_MINUTES * MINUTE });
        remaining -= duration;
        cursor = end + BREAK_MINUTES * MINUTE;
      }
    }
    if (remaining > 0) unscheduledTasks.push({
      task, remainingMinutes: remaining,
      reason: deadline <= nowMs ? "The deadline has already passed." : "Not enough free time before the deadline within your study hours.",
    });
  }
  studyBlocks.sort((a, b) => epoch(a.start.dateTime) - epoch(b.start.dateTime));
  return { studyBlocks, unscheduledTasks, window };
}

type Availability = Interval & { date: string };
type Candidate = Availability & { duration: number; leadPenalty: number; focusPenalty: number; focusDistance: number };

function localMinute(date: Temporal.PlainDate, minute: number, timeZone: string) {
  if (minute === 1440) return date.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: "00:00" }).epochMilliseconds;
  return date.toZonedDateTime({ timeZone, plainTime: { hour: Math.floor(minute / 60), minute: minute % 60 } }).epochMilliseconds;
}

function inFocusPeriod(minute: number, period: NonNullable<StudyPreferences["routine"]>["focusPeriod"]) {
  if (period === "Morning") return minute >= 360 && minute < 720;
  if (period === "Afternoon") return minute >= 720 && minute < 1020;
  if (period === "Evening") return minute >= 1020 && minute < 1260;
  return minute >= 1260 || minute < 360;
}

/** Availability is split at local midnight so the daily cap counts real study minutes per date. */
function awakeAvailability(preferences: StudyPreferences, now: string): Availability[] {
  const routine = preferences.routine!;
  const first = Temporal.Instant.from(now).toZonedDateTimeISO(preferences.timeZone).toPlainDate();
  const result: Availability[] = [];
  for (let day = 0; day < preferences.days; day++) {
    const date = first.add({ days: day });
    const begin = localMinute(date, 0, preferences.timeZone);
    const finish = localMinute(date, 1440, preferences.timeZone);
    const boundaries = new Set([begin, finish]);
    // Repeated clock times have two instants. Splitting at both, and at the UTC
    // offset change, prevents a fall-back block from crossing sleeping minutes.
    for (const minute of [routine.wakeMinutes, routine.sleepMinutes, preferences.dayStart * 60, preferences.dayEnd * 60]) {
      if (minute === 1440) continue;
      const local = date.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 });
      for (const disambiguation of ["earlier", "later"] as const) {
        const instant = local.toZonedDateTime(preferences.timeZone, { disambiguation }).epochMilliseconds;
        if (instant > begin && instant < finish) boundaries.add(instant);
      }
    }
    let transition = Temporal.Instant.fromEpochMilliseconds(begin).toZonedDateTimeISO(preferences.timeZone).getTimeZoneTransition("next");
    while (transition && transition.epochMilliseconds < finish) {
      boundaries.add(transition.epochMilliseconds);
      transition = transition.getTimeZoneTransition("next");
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    for (let index = 1; index < ordered.length; index++) {
      const start = ordered[index - 1];
      const end = ordered[index];
      const midpoint = Temporal.Instant.fromEpochMilliseconds(Math.floor((start + end) / 2)).toZonedDateTimeISO(preferences.timeZone);
      const minute = midpoint.hour * 60 + midpoint.minute;
      const awake = routine.wakeMinutes < routine.sleepMinutes
        ? minute >= routine.wakeMinutes && minute < routine.sleepMinutes
        : minute >= routine.wakeMinutes || minute < routine.sleepMinutes;
      if (!awake || minute < preferences.dayStart * 60 || minute >= preferences.dayEnd * 60) continue;
      const previous = result.at(-1);
      if (previous?.date === date.toString() && previous.end === start) previous.end = end;
      else result.push({ date: date.toString(), start, end });
    }
  }
  return result;
}

function freeGaps(start: number, end: number, occupied: Interval[]): Interval[] {
  const result: Interval[] = [];
  let cursor = start;
  for (const interval of occupied) {
    if (interval.end <= cursor) continue;
    if (interval.start >= end) break;
    if (interval.start > cursor) result.push({ start: cursor, end: Math.min(interval.start, end) });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) break;
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}

function scheduleRoutine(tasks: StudyTask[], sources: SourceData, preferences: StudyPreferences, now: string, useSoftPreferences: boolean) {
  const routine = preferences.routine!;
  const window = planningWindow(preferences, now);
  const occupied = sources.calendarEvents.map(event => {
    const interval = { start: epoch(event.start), end: epoch(event.end) };
    if (interval.end <= interval.start) throw new Error("A calendar event has an invalid time range. Please correct it and try again.");
    return interval;
  });
  const availability = awakeAvailability(preferences, now);
  const usedByDate = new Map<string, number>();
  const studyBlocks: StudyBlock[] = [];
  const unscheduledTasks: StudyPlan["unscheduledTasks"] = [];
  const ordered = [...tasks].sort((a, b) => epoch(a.dueAt) - epoch(b.dueAt)
    || ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority])
    || b.estimatedMinutes - a.estimatedMinutes || a.id.localeCompare(b.id));
  const maximumBlock = Math.min(preferences.blockMinutes, routine.breakEveryMinutes ?? preferences.blockMinutes);
  for (const task of ordered) {
    let remaining = task.estimatedMinutes;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 600) throw new Error("A task has an invalid study duration.");
    const deadline = Math.min(epoch(task.dueAt), epoch(window.end));
    const preferredStart = Temporal.Instant.from(task.dueAt).toZonedDateTimeISO(preferences.timeZone)
      .startOfDay().subtract({ days: routine.deadlineLeadDays }).epochMilliseconds;
    const harder = task.priority === "high" || task.estimatedMinutes >= 100;
    while (remaining > 0) {
      occupied.sort((a, b) => a.start - b.start);
      const desired = Math.min(remaining, maximumBlock);
      const candidates: Candidate[] = [];
      for (const available of availability) {
        const dailyRemaining = routine.dailyStudyMinutes - (usedByDate.get(available.date) || 0);
        if (dailyRemaining <= 0) continue;
        const start = Math.ceil(Math.max(available.start, epoch(now)) / MINUTE) * MINUTE;
        const end = Math.min(available.end, deadline);
        if (end <= start) continue;
        const date = Temporal.PlainDate.from(available.date);
        for (const gap of freeGaps(start, end, occupied)) {
          const starts = new Set([gap.start]);
          if (useSoftPreferences) {
            // Include the chosen focus time and period edges, without scanning every minute.
            for (const minute of [routine.focusMinutes, 0, 360, 720, 1020, 1260]) {
              const target = localMinute(date, minute, preferences.timeZone);
              if (target >= gap.start && target < gap.end) starts.add(target);
            }
          }
          for (const begin of starts) {
            const duration = Math.min(desired, dailyRemaining, Math.floor((gap.end - begin) / MINUTE));
            if (duration < 1) continue;
            const local = Temporal.Instant.fromEpochMilliseconds(begin).toZonedDateTimeISO(preferences.timeZone);
            const minute = local.hour * 60 + local.minute;
            const focused = inFocusPeriod(minute, routine.focusPeriod);
            const distance = Math.abs(minute - routine.focusMinutes);
            candidates.push({ date: available.date, start: begin, end: begin + duration * MINUTE, duration,
              leadPenalty: useSoftPreferences && begin < preferredStart ? 1 : 0,
              focusPenalty: !useSoftPreferences ? 0 : harder ? Number(!focused) : Number(focused),
              focusDistance: useSoftPreferences && harder ? Math.min(distance, 1440 - distance) : 0 });
          }
        }
      }
      candidates.sort((a, b) => Number(b.duration === desired) - Number(a.duration === desired)
        || (a.duration !== desired && b.duration !== desired ? b.duration - a.duration : 0)
        || a.leadPenalty - b.leadPenalty || a.focusPenalty - b.focusPenalty || a.focusDistance - b.focusDistance || a.start - b.start);
      const chosen = candidates[0];
      if (!chosen) break;
      studyBlocks.push({
        id: `study-${task.source}-${task.sourceId}-${studyBlocks.length + 1}`, summary: `Study: ${task.title}`,
        description: `${task.course ? `${task.course} · ` : ""}${chosen.duration} minutes of focused study.${task.url ? `\nSource: ${task.url}` : ""}`,
        start: { dateTime: new Date(chosen.start).toISOString(), timeZone: preferences.timeZone },
        end: { dateTime: new Date(chosen.end).toISOString(), timeZone: preferences.timeZone },
        source: { provider: task.source, id: task.sourceId, title: task.title, dueAt: task.dueAt, url: task.url }, priority: task.priority,
      });
      // Reserve both sides because focus preferences can place blocks out of chronological order.
      occupied.push({ start: chosen.start - routine.breakMinutes * MINUTE, end: chosen.end + routine.breakMinutes * MINUTE });
      usedByDate.set(chosen.date, (usedByDate.get(chosen.date) || 0) + chosen.duration);
      remaining -= chosen.duration;
    }
    if (remaining > 0) unscheduledTasks.push({ task, remainingMinutes: remaining,
      reason: deadline <= epoch(now) ? "The deadline has already passed."
        : routine.dailyStudyMinutes === 0 ? "Your daily study limit is zero."
        : "Not enough awake, free study time before the deadline within your daily study limit." });
  }
  studyBlocks.sort((a, b) => epoch(a.start.dateTime) - epoch(b.start.dateTime));
  return { studyBlocks, unscheduledTasks, window };
}

/** Soft focus and lead-time preferences never override sleep, deadlines, or feasible capacity. */
export function scheduleTasks(tasks: StudyTask[], sources: SourceData, preferences: StudyPreferences, now: string, onProgress?: ProgressReporter): Pick<StudyPlan, "studyBlocks" | "unscheduledTasks" | "window"> {
  const report: ProgressReporter = progress => reportProgress(onProgress, progress);
  report({ stage: "scheduling", status: "running", message: "Finding study time around your calendar and routine.", completed: 0, total: tasks.length });
  let result: Pick<StudyPlan, "studyBlocks" | "unscheduledTasks" | "window">;
  if (!preferences.onboardingAnswers) result = legacyScheduleTasks(tasks, sources, preferences, now);
  else {
    const normalized = preferencesFromOnboarding(preferences.onboardingAnswers, preferences);
    const preferred = scheduleRoutine(tasks, sources, normalized, now, true);
    const baseline = scheduleRoutine(tasks, sources, normalized, now, false);
    const remaining = new Map(baseline.unscheduledTasks.map(item => [item.task.id, item.remainingMinutes]));
    result = preferred.unscheduledTasks.some(item => item.remainingMinutes > (remaining.get(item.task.id) || 0)) ? baseline : preferred;
  }
  // Report only the chosen schedule. A trial focus placement may be replaced by
  // the capacity-preserving fallback, and must never appear as a final result.
  const remaining = new Map(result.unscheduledTasks.map(item => [item.task.id, item.remainingMinutes]));
  tasks.forEach((task, index) => {
    const unplaced = remaining.get(task.id) || 0;
    report({ stage: "scheduling", status: "running", message: `Reviewed ${index + 1} of ${tasks.length} task placements.`, completed: index + 1, total: tasks.length,
      detail: `${task.title}: ${task.estimatedMinutes - unplaced} study minutes placed${unplaced ? `; ${unplaced} minutes could not fit before the deadline` : ""}.` });
  });
  report({ stage: "scheduling", status: "complete", message: `Created ${result.studyBlocks.length} study blocks.`, completed: tasks.length, total: tasks.length,
    detail: result.unscheduledTasks.length ? `${result.unscheduledTasks.length} tasks have study time that could not fit.` : "All identified study time fits before its deadlines." });
  return result;
}
