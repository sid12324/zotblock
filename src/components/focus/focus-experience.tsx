"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { useFocusTimer } from "@/components/focus-timer-provider";

export type FocusTimerController = ReturnType<typeof useFocusTimer>;

export function parseFocusDuration(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : null;
}

export function focusClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function Arrow({ back = false }: { back?: boolean }) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={back ? "M16 10H4m5-5-5 5 5 5" : "M4 10h12m-5-5 5 5-5 5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function PlayPause({ paused }: { paused: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true">{paused ? <path d="m7 4 9 6-9 6V4Z" fill="currentColor"/> : <><path d="M6 4v12M14 4v12" stroke="currentColor" strokeWidth="3" strokeLinecap="square"/></>}</svg>;
}

function Check() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7 16 6 6L25 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function FocusRing({ seconds, totalSeconds, status }: { seconds: number; totalSeconds: number; status: "ready" | "running" | "paused" | "completed" }) {
  const remaining = Math.max(0, Math.min(1, seconds / Math.max(1, totalSeconds)));
  const spoken = `${Math.floor(Math.max(0, seconds) / 60)} minutes ${Math.max(0, seconds) % 60} seconds remaining`;
  return <div className={`focus-ring focus-ring-${status}`}>
    <svg className="focus-ring-art" viewBox="0 0 400 400" fill="none" aria-hidden="true"><circle className="focus-ring-track" cx="200" cy="200" r="188"/><circle className="focus-ring-progress" cx="200" cy="200" r="188" pathLength="100" strokeDasharray="100" strokeDashoffset={status === "completed" ? 0 : (1 - remaining) * 100}/></svg>
    <div className="focus-ring-content">{status === "completed" ? <><span className="focus-complete-check"><Check/></span><p className="focus-complete-minutes">{Math.round(totalSeconds / 60)}<span>minutes focused</span></p></> : <><span className="focus-ring-label">{status === "ready" ? "MAKE A LITTLE ROOM" : status === "paused" ? "TAKE YOUR TIME" : "STAY WITH IT"}</span><div className="focus-countdown" role="timer" aria-live="off" aria-label={spoken}><span aria-hidden="true">{focusClock(seconds)}</span></div><span className="focus-ring-subtitle">{status === "ready" ? "one session, one thing" : status === "paused" ? "ready when you are" : "nothing else right now"}</span></>}</div>
  </div>;
}

function FocusStreak({ timer }: { timer: FocusTimerController }) {
  const { stats } = timer;
  return <section className="focus-streak" aria-label="Your focus activity"><div className="focus-streak-copy"><span className="focus-streak-symbol" aria-hidden="true">✳</span><div><p><strong>{stats.currentStreak}</strong> day streak <small>Best {stats.bestStreak}</small></p><span>{stats.todayMinutes} focused {stats.todayMinutes === 1 ? "minute" : "minutes"} today</span></div></div><ol className="focus-week" aria-label="Completed focus sessions over the last seven days">{stats.days.map(day => <li key={day.date} className={day.completed ? "is-complete" : ""} aria-label={`${day.date}: ${day.completed ? "completed a focus session" : "no completed focus session"}`}><span aria-hidden="true">{day.completed ? <Check/> : <i/>}</span><small aria-hidden="true">{day.label.charAt(0)}</small></li>)}</ol></section>;
}

export function FocusExperience({ timer, timeZone }: { timer: FocusTimerController; timeZone: string }) {
  const [duration, setDuration] = useState<"25" | "50" | "custom">("25");
  const [customMinutes, setCustomMinutes] = useState("90");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const session = timer.session;
  const completed = session?.status === "completed";
  const active = session && !completed;
  const selectedMinutes = duration === "custom" ? parseFocusDuration(customMinutes) : Number(duration);
  const displaySeconds = session ? timer.remainingSeconds : (selectedMinutes ?? 25) * 60;
  const status = session?.status ?? "ready";
  const zone = session?.target.timeZone || timeZone;

  function start(minutes: number, repeatTask = false) {
    const previous = repeatTask ? session?.target : undefined;
    const success = timer.startSession({ ...(previous ?? {}), title: previous?.title || title.trim() || "Focus session", durationMinutes: minutes, timeZone: previous?.timeZone || timeZone });
    if (!success) { setError("This session could not start. End your current session, then try again."); return; }
    setEnded(false);
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedMinutes === null) { setError("Choose a whole number of minutes between 1 and 240."); return; }
    start(selectedMinutes);
  }

  function endSession() {
    timer.cancelSession();
    setEnded(true);
    setError(null);
  }

  return <div className="zot-focus"><header className="focus-header"><Link href="/calendar" className="focus-brand" aria-label="ZotBlock calendar"><span aria-hidden="true"/>ZOTBLOCK</Link><span className="focus-header-label">A LITTLE SPACE TO FOCUS</span><Link href="/calendar" className="focus-exit"><span>{active ? "Exit focus" : "Back to calendar"}</span><Arrow/></Link></header>
    <main className="focus-main">{!timer.ready ? <div className="focus-loading" role="status"><span className="focus-eyebrow">FOCUS MODE</span><h1>Making a little <em>space.</em></h1><p>Loading your session…</p></div> : <>
      <div className="focus-heading"><p className="focus-eyebrow">{session?.target.course || (completed ? "A LITTLE PROGRESS, WELL EARNED" : "YOUR TIME, WELL SPENT")}</p><h1>{completed ? <>That’s a <em>wrap.</em></> : session ? session.target.title : <>One thing at a <em>time.</em></>}</h1>{completed && <p className="focus-task-finished">{session.target.title}</p>}<p className="focus-session-status" role="status">{completed ? "Session complete. Your focus time and streak have been credited." : active ? session.status === "paused" ? "Session paused." : "Session in progress." : ended ? "Session ended. Only completed sessions count toward your streak." : "Choose a little time. Give it your full attention."}</p></div>
      <FocusRing seconds={displaySeconds} totalSeconds={session ? session.durationMs / 1000 : (selectedMinutes ?? 25) * 60} status={status}/>
      {active ? <div className="focus-session-controls"><div className="focus-main-actions"><button className="focus-secondary focus-reset" type="button" onClick={timer.resetSession}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 8a6 6 0 1 1 0 5M4 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Reset</button><button className="focus-primary" type="button" onClick={session.status === "paused" ? timer.resumeSession : timer.pauseSession}><PlayPause paused={session.status === "paused"}/>{session.status === "paused" ? "Resume session" : "Pause session"}</button></div><button type="button" className="focus-end" onClick={endSession}>End session</button><p className="focus-leave-note">You can leave focus mode. Your timer will stay with you.</p></div> : completed ? <div className="focus-completion-actions"><p className="focus-credit"><Check/>{Math.round(session.durationMs / 60_000)} minutes added to your focus history</p><p className="focus-next-label">Ready for another?</p><div className="focus-next-actions"><button type="button" className="focus-primary" onClick={() => start(25, true)}>Start another 25 <span>min</span></button><button type="button" className="focus-secondary" onClick={() => start(50, true)}>Start another 50 <span>min</span></button></div><Link href="/calendar" className="focus-return"><Arrow back/>Return to calendar</Link></div> : <form className="focus-setup" onSubmit={submit} noValidate><fieldset><legend>HOW LONG HAVE YOU GOT?</legend><div className="focus-duration-options">{(["25", "50", "custom"] as const).map(option => <button key={option} type="button" aria-pressed={duration === option} className={duration === option ? "selected" : ""} onClick={() => { setDuration(option); setError(null); }}>{option === "custom" ? "Custom" : <>{option} <span>min</span></>}</button>)}</div></fieldset>{duration === "custom" && <div className="focus-custom-field"><label htmlFor="focus-minutes">Duration in minutes</label><input id="focus-minutes" type="number" min="1" max="240" step="1" inputMode="numeric" value={customMinutes} onChange={event => { setCustomMinutes(event.target.value); setError(null); }} aria-describedby="focus-duration-help" aria-invalid={selectedMinutes === null || undefined}/><span id="focus-duration-help">1–240 minutes</span></div>}<label className="focus-title-label" htmlFor="focus-task">What are you working on? <span>Optional</span></label><input className="focus-task-input" id="focus-task" value={title} onChange={event => setTitle(event.target.value)} maxLength={300} placeholder="One thing you want to make progress on"/><button className="focus-primary focus-start" type="submit">Start focusing<Arrow/></button></form>}
      {error && <p className="focus-error" role="alert">{error}</p>}
      <FocusStreak timer={timer}/>
    </>}
    {timer.storageNotice && <p className="focus-storage-note" role="status">{timer.storageNotice}</p>}
    </main><footer className="focus-footer"><span><i aria-hidden="true"/>A little focus goes a long way.</span><span>{zone.replaceAll("_", " ")}</span></footer>
  </div>;
}
