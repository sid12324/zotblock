"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Flame, Play, Timer } from "lucide-react";
import { useFocusTimer } from "@/components/focus-timer-provider";
import type { CalendarDisplayEvent } from "@/lib/calendar/events";
import type { FocusTarget } from "@/lib/focus-timer";

function clock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function focusTargetFromEvent(event: CalendarDisplayEvent | null | undefined, timeZone: string, fallbackMinutes = 25): FocusTarget {
  const start = Date.parse(event?.exportStart ?? event?.start ?? "");
  const end = Date.parse(event?.exportEnd ?? event?.end ?? "");
  const minutes = event?.kind === "study" && Number.isFinite(end - start) ? (end - start) / 60_000 : fallbackMinutes;
  const description = event?.assignment?.userEdits?.description ?? event?.assignment?.description ?? event?.description;
  return {
    ...(event ? { id: event.id.slice(0, 1000) } : {}),
    title: (event?.title.trim() || "Independent study").slice(0, 500),
    ...(event?.courseName ? { course: event.courseName.slice(0, 200) } : {}),
    ...(description ? { description: description.length > 20_000 ? `${description.slice(0, 19_900)}\n\n[Open the calendar for the full instructions.]` : description } : {}),
    durationMinutes: Math.max(1, Math.min(240, Math.round(minutes))), timeZone,
  };
}

export function StartFocusButton({ event, timeZone, defaultMinutes = 25 }: { event: CalendarDisplayEvent; timeZone: string; defaultMinutes?: number }) {
  const timer = useFocusTimer(timeZone);
  const router = useRouter();
  const active = timer.session && timer.session.status !== "completed";
  const target = focusTargetFromEvent(event, timeZone, defaultMinutes);
  function start() {
    if (active || timer.startSession(target)) router.push("/focus");
  }
  return <div className="panel-focus-action"><button type="button" className="calendar-focus-start" onClick={start} disabled={!timer.ready}><Play aria-hidden="true"/><span>{active ? "Return to focus" : "Start focus"}</span><span className="focus-start-duration">{active ? clock(timer.remainingSeconds) : `${target.durationMinutes} min`}</span></button></div>;
}

export function FocusTimerCard({ timeZone, defaultMinutes = 25 }: { timeZone: string; defaultMinutes?: number }) {
  const timer = useFocusTimer(timeZone);
  const router = useRouter();
  const [minutes, setMinutes] = useState(defaultMinutes);
  const active = timer.session && timer.session.status !== "completed";
  const options = [...new Set([25, 50, defaultMinutes])].sort((a, b) => a - b);
  function start() {
    if (active || timer.startSession(focusTargetFromEvent(null, timeZone, minutes))) router.push("/focus");
  }
  return <section className="calendar-focus-toolbar" aria-label="Study timer and streak">
    <div className="calendar-focus-heading"><span className="focus-timer-mark"><Timer aria-hidden="true"/></span><div><p>{active ? timer.session!.target.title : "Make a little progress."}</p><span>{active ? `${timer.session!.status === "paused" ? "Paused" : "In progress"} · ${clock(timer.remainingSeconds)} left` : `${timer.stats.todayMinutes} minutes focused today`}</span></div></div>
    <div className="calendar-focus-streak" aria-label={`${timer.stats.currentStreak} day streak`}><Flame aria-hidden="true"/><strong>{timer.stats.currentStreak}</strong><span>day streak</span></div>
    <div className="calendar-focus-controls">{!active && <label><span className="focus-sr-only">Timer duration</span><select value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{options.map(option => <option key={option} value={option}>{option} min</option>)}</select></label>}<button type="button" className="calendar-focus-start" disabled={!timer.ready} onClick={start}><Play aria-hidden="true"/>{active ? "Return to focus" : "Start timer"}</button><Link href="/focus" className="calendar-focus-details">{active ? "View session" : "Timer & streaks"}</Link></div>
    {timer.storageNotice && <p className="calendar-focus-notice" role="status">{timer.storageNotice}</p>}
  </section>;
}
