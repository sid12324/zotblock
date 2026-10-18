"use client";

import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePlan } from "@/components/plan-provider";
import { useGeneration } from "@/components/generation-provider";
import { useStudyPreferences } from "@/components/preferences-provider";
import { saveAssignmentEdits, useAssignmentEdits } from "@/components/assignment-edits-provider";
import { toggleSavedCompletedBlock, useCompletedBlocks } from "@/components/completed-blocks-provider";
import { addDroppedBlock, useDroppedBlocks } from "@/components/dropped-blocks-provider";
import { applyPlanAssignmentEdits, assignmentEditKey } from "@/lib/assignment-edits";
import { paintLookup } from "@/lib/calendar/colors";
import { calendarEventsFromPlan, type CalendarDisplayEvent } from "@/lib/calendar/events";
import { dropWindow, parseDropTitle, type DroppedBlock, type DropTone } from "@/lib/dropped-blocks";
import type { AssignmentEdits, StudyPlan } from "@/lib/types";
import { DayView, MonthView, WeekView } from "@/components/calendar/calendar-views";
import { DetailPanel } from "@/components/calendar/detail-panel";
import { GoogleCalendarExport, useGoogleCalendarExport, type GoogleCalendarExportController } from "@/components/calendar/google-calendar-export";
import { FocusTimerCard, StartFocusButton } from "@/components/calendar/focus-timer-card";
import { useCalendarClock } from "@/components/calendar/use-calendar-clock";
import { addDays, dayTitle, formatISO, monthName, parseISODate, shiftCursor, startOfWeek, WEEKDAYS, weekDays, type CalendarView } from "@/components/calendar/dates";
import "./calendar.css";
import "@/components/calendar/assignment-editor.css";
import "@/components/calendar/focus-timer-card.css";

const tones: { id: DropTone; label: string }[] = [
  { id: "study", label: "Study" },
  { id: "class", label: "Class" },
  { id: "life", label: "Life" },
  { id: "build", label: "Build" },
];
const durationChoices = [15, 30, 45, 60, 90, 120, 180, 240];

function durationChoiceLabel(minutes: number) {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hr" : `${minutes / 60} hr`;
  if (minutes === 90) return "1.5 hr";
  return `${minutes} min`;
}

function clockValue(totalMinutes: number) {
  const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(totalMinutes)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function Chevron({ direction }: { direction: "left" | "right" }) { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d={direction === "left" ? "M10 3L5 8L10 13" : "M6 3L11 8L6 13"}/></svg>; }

function firstName(value: string | undefined) {
  const name = value?.trim().split(/\s+/)[0];
  return name || "";
}

function durationLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function clockLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(Date.parse(iso)).replace(/\u202f/g, " ");
}

function droppedToEvents(blocks: DroppedBlock[], timeZone: string): CalendarDisplayEvent[] {
  return blocks.map(block => {
    const start = Temporal.Instant.from(block.start).toZonedDateTimeISO(timeZone);
    const end = Temporal.Instant.from(block.end).toZonedDateTimeISO(timeZone);
    const date = start.toPlainDate().toString();
    const endsSameDay = end.toPlainDate().toString() === date;
    const duration = (Temporal.Instant.from(block.end).epochMilliseconds - Temporal.Instant.from(block.start).epochMilliseconds) / 60_000;
    return {
      id: `drop:${block.id}:${date}`,
      kind: "study",
      tone: block.tone,
      completionKey: `drop:${block.id}@${block.start}`,
      title: block.title,
      shortLabel: block.title,
      date,
      timeLabel: `${clockLabel(block.start, timeZone)} – ${clockLabel(block.end, timeZone)}`,
      startMinutes: start.hour * 60 + start.minute + start.second / 60,
      endMinutes: endsSameDay ? end.hour * 60 + end.minute + end.second / 60 : 1440,
      allDay: false,
      durationMinutes: duration,
      courseCode: "",
      courseName: "",
      estimate: durationLabel(duration) || "",
      estimateNote: "hours · dropped block",
      description: "A block you added on this calendar.",
      summary: "A block you added on this calendar.",
      sourceProvider: "google-calendar",
      sourceLabel: "You",
      resources: [],
      start: block.start,
      end: block.end,
      exportStart: block.start,
      exportEnd: block.end,
    };
  });
}

function CalendarTop({ name, exportControl }: { name: string; exportControl?: ReactNode }) {
  const initial = (name || "Z").charAt(0).toUpperCase();
  return <header className="cal-top">
    <Link href="/" className="cal-brand" aria-label="ZotBlock home"><img src="/zotblock-mark.png" alt="" /><span>ZotBlock</span></Link>
    <nav className="cal-nav" aria-label="App navigation">
      <Link href="/calendar" aria-current="page">Calendar</Link>
      <Link href="/onboarding">Preferences</Link>
      <Link href="/integrations">Integrations</Link>
    </nav>
    <div className="cal-top-actions">
      {exportControl}
      <Link href="/onboarding" className="cal-avatar" aria-label={name ? `${name} preferences` : "Preferences"}>{initial}</Link>
    </div>
  </header>;
}

export default function CalendarPage() {
  const { plan, ready, storageNotice } = usePlan();
  const generation = useGeneration();
  const { preferences } = useStudyPreferences();
  const corrections = useAssignmentEdits();
  const basePlan = generation.preview || plan;
  const effectivePlan = useMemo(() => basePlan ? applyPlanAssignmentEdits(basePlan, corrections.edits) : null, [basePlan, corrections.edits]);
  const exportBlocked = generation.running ? "Finish generating the plan before exporting." : generation.preview && generation.error ? "Close the incomplete preview in Integrations before exporting." : null;
  const calendarExport = useGoogleCalendarExport(ready ? plan : null, exportBlocked);
  const name = firstName(preferences.onboardingAnswers?.name);
  if (!ready || !effectivePlan) return <div className="zot-calendar"><CalendarTop name={name}/><div className="app"><section className="calendar">{ready && <FocusTimerCard timeZone={preferences.timeZone} defaultMinutes={preferences.blockMinutes}/>}<main className="calendar-empty"><span className="empty-mark"/><p className="label">YOUR STUDY CALENDAR</p><h1>{!ready ? "Loading your plan…" : "Make room for what’s next."}</h1>{ready && <><p>Connect your accounts and generate a study plan to see your study blocks, calendar events, and deadlines together.</p>{storageNotice && <p role="status">{storageNotice}</p>}<Link href="/integrations" className="canvas-btn">Go to integrations <Chevron direction="right"/></Link><p className="empty-sample-note">You can also choose “Try sample data” on the integrations page.</p></>}</main></section></div></div>;
  return <CalendarWorkspace key={generation.jobId || `${effectivePlan.generatedAt}:${effectivePlan.mode}`} plan={effectivePlan} name={name} storageNotice={storageNotice} running={generation.running} calendarExport={calendarExport}/>;
}

function CalendarWorkspace({ plan, name, storageNotice, running, calendarExport }: { plan: StudyPlan; name: string; storageNotice: string | null; running: boolean; calendarExport: GoogleCalendarExportController }) {
  const dropped = useDroppedBlocks();
  const events = useMemo(() => [...calendarEventsFromPlan(plan), ...droppedToEvents(dropped.blocks, plan.timeZone)].sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startMinutes ?? 1440) - (b.startMinutes ?? 1440) || a.id.localeCompare(b.id)), [plan, dropped.blocks]);
  const completed = useCompletedBlocks();
  const completedKeys = useMemo(() => new Set(completed.completed), [completed.completed]);
  const now = useCalendarClock(plan.timeZone);
  const today = useMemo(() => parseISODate(now.date), [now.date]);
  const firstStudy = events.find(event => event.kind === "study");
  const [cursor, setCursor] = useState(() => today);
  const [view, setView] = useState<CalendarView>("week");
  const [selectedId, setSelectedId] = useState<string | null>(firstStudy?.id || events[0]?.id || null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<DropTone>("study");
  const [startTime, setStartTime] = useState(() => clockValue(Math.min(23 * 60 + 45, Math.ceil(now.minutes / 30) * 30 || 8 * 60)));
  const [duration, setDuration] = useState(60);
  const [durationTouched, setDurationTouched] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const selected = events.find(event => event.id === selectedId) || null;
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { setPanelOpen(false); triggerRef.current?.focus(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function selectEvent(id: string) { triggerRef.current = document.activeElement as HTMLElement | null; setSelectedId(id); }
  function closePanel() { setPanelOpen(false); triggerRef.current?.focus(); }
  function saveSelectedAssignment(edits: AssignmentEdits | null) {
    if (selected?.assignment) saveAssignmentEdits(assignmentEditKey(selected.assignment, plan.mode), edits);
  }
  function onDraft(value: string) {
    setDraft(value);
    if (durationTouched || !/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(value)) return;
    setDuration(parseDropTitle(value).durationMinutes);
  }
  function dropBlock() {
    const parsed = parseDropTitle(draft);
    if (!parsed.title) return;
    const [hour, minute] = startTime.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    const startMinutes = Math.min(23 * 60 + 45, Math.max(0, hour * 60 + minute));
    const durationMinutes = Math.min(duration, 24 * 60 - startMinutes);
    const slot = dropWindow(now.date, startMinutes, durationMinutes, plan.timeZone);
    const id = addDroppedBlock({ title: parsed.title, tone, start: slot.start, end: slot.end });
    setDraft("");
    setCursor(parseISODate(now.date));
    setView("week");
    setSelectedId(`drop:${id}:${now.date}`);
  }
  const thisWeek = weekSummary(today, events, completedKeys);
  const viewedWeek = weekSummary(cursor, events, completedKeys);
  const totalBlocks = thisWeek.total;
  const left = thisWeek.total - thisWeek.stacked;
  const nextUp = events.filter(event => event.completionKey && !completedKeys.has(event.completionKey) && event.start && Date.parse(event.start) >= now.epochMilliseconds - 60_000).sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!))[0];
  const spotlight = selected || nextUp || null;
  const greeting = totalBlocks === 0
    ? `Hey ${name || "there"}, your week is open.`
    : `Hey ${name || "there"}, ${thisWeek.stacked} of ${thisWeek.total} blocks stacked!`;
  const followup = totalBlocks === 0
    ? "Drop a block, or generate a plan from your connections."
    : `${left} left this week.${nextUp ? ` Next up: ${nextUp.title}.` : " Nothing else is waiting."}`;
  const heading = view === "month"
    ? { primary: monthName(cursor), year: String(cursor.getFullYear()) }
    : view === "day"
      ? { primary: dayTitle(cursor).secondary, year: "" }
      : boardWeekTitle(cursor);
  const shared = { cursor, today, events, selectedId, completedKeys, onSelect: selectEvent, now, timeZone: plan.timeZone };
  const notice = storageNotice || completed.storageNotice || dropped.storageNotice;
  const paint = useMemo(() => paintLookup(events), [events]);
  const durationOptions = durationChoices.includes(duration) ? durationChoices : [...durationChoices, duration].sort((a, b) => a - b);
  return <div className="zot-calendar">
    <CalendarTop name={name} exportControl={<GoogleCalendarExport controller={calendarExport} pill/>}/>
    <div className="cal-page">
      <section className="cal-hero">
        <article className="hello-card">
          <img src="/zotblock-mark.png" alt="" className="hello-mark"/>
          <div>
            <p className="hello-date">{today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
            <h1>{greeting}</h1>
            <p className="hello-next">{followup}</p>
            <div className="hello-stats">
              <span><strong>{thisWeek.total}</strong> blocks this week</span>
              <span><strong>{thisWeek.hours}</strong> hrs planned</span>
              <span><strong>{thisWeek.stacked}</strong> stacked</span>
            </div>
          </div>
        </article>
        <form className="drop-card" onSubmit={event => { event.preventDefault(); dropBlock(); }}>
          <div className="drop-head"><h2>Drop a block</h2><span>lands on today</span></div>
          <label htmlFor="drop-title">What are you stacking?</label>
          <div className="drop-row">
            <input id="drop-title" value={draft} onChange={event => onDraft(event.target.value)} placeholder="e.g. Econ problem set" maxLength={120}/>
            <button type="submit" disabled={!draft.trim()}>Drop it</button>
          </div>
          <div className="drop-when">
            <label htmlFor="drop-start">Starts<input id="drop-start" type="time" step={900} value={startTime} onChange={event => setStartTime(event.target.value)}/></label>
            <label htmlFor="drop-duration">Duration<select id="drop-duration" value={duration} onChange={event => { setDurationTouched(true); setDuration(Number(event.target.value)); }}>{durationOptions.map(minutes => <option key={minutes} value={minutes}>{durationChoiceLabel(minutes)}</option>)}</select></label>
          </div>
          <div className="drop-tones" role="group" aria-label="Block type">
            {tones.map(option => <button key={option.id} type="button" className={tone === option.id ? `on tone-${option.id}` : `tone-${option.id}`} aria-pressed={tone === option.id} onClick={() => setTone(option.id)}>{option.label}</button>)}
          </div>
        </form>
      </section>
      {(notice || plan.mode === "demo" || plan.warnings.length > 0 || (!running && events.length === 0)) && <div className="cal-notes">
        {plan.mode === "demo" && <span className="sample-plan-label">Sample data</span>}
        {notice && <p role="status">{notice}</p>}
        {!running && events.length === 0 && <p>No events or study blocks were found in this plan. <Link href="/integrations">Review your connections</Link>.</p>}
        {plan.warnings.length > 0 && <details><summary>{plan.warnings.length} plan {plan.warnings.length === 1 ? "note" : "notes"}</summary><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      </div>}
      <div className="cal-stage">
        <section className="board" aria-label="Study calendar">
          <div className="board-bar">
            <div className="board-title"><h2>{heading.primary}</h2>{heading.year && <span>{heading.year}</span>}</div>
            <div className="board-tools">
              <div className="nav"><button type="button" aria-label={`Previous ${view}`} onClick={() => setCursor(shiftCursor(cursor, view, -1))}><Chevron direction="left"/></button><button type="button" aria-label={`Next ${view}`} onClick={() => setCursor(shiftCursor(cursor, view, 1))}><Chevron direction="right"/></button></div>
              <button type="button" className="today-button" onClick={() => setCursor(today)}>Today</button>
              <div className="switch" role="group" aria-label="Calendar view">{(["day", "week", "month"] as const).map(option => <button key={option} type="button" aria-pressed={view === option} className={view === option ? "on" : ""} onClick={() => setView(option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</button>)}</div>
            </div>
          </div>
          <div className="calendar-view-scroll">{view === "month" ? <MonthView {...shared} onShowWeek={date => { setCursor(date); setView("week"); }} onShowDay={date => { setCursor(date); setView("day"); }}/> : view === "week" ? <WeekView {...shared}/> : <DayView {...shared}/>}</div>
        </section>
        <aside className="cal-side">
          <UpNext event={spotlight} timeZone={plan.timeZone} paint={spotlight ? paint(spotlight) : undefined} done={Boolean(spotlight?.completionKey && completedKeys.has(spotlight.completionKey))} upcoming={spotlight?.id === nextUp?.id} onToggle={() => { if (spotlight?.completionKey) toggleSavedCompletedBlock(spotlight.completionKey); }} onDetails={() => setPanelOpen(true)} defaultMinutes={plan.preferences?.blockMinutes ?? 25}/>
          <WeekStack cursor={cursor} events={events} completedKeys={completedKeys} stacked={viewedWeek.stacked} total={viewedWeek.total}/>
        </aside>
      </div>
    </div>
    {panelOpen && selected && <DetailPanel key={selected.id} event={selected} timeZone={plan.timeZone} onClose={closePanel} onSaveAssignment={selected.assignment ? saveSelectedAssignment : undefined} editsNotice={storageNotice} calendarExport={calendarExport} completed={Boolean(selected.completionKey && completedKeys.has(selected.completionKey))} onToggleComplete={selected.completionKey ? () => toggleSavedCompletedBlock(selected.completionKey!) : undefined} focusAction={selected.kind !== "class" ? <StartFocusButton event={selected} timeZone={plan.timeZone} defaultMinutes={plan.preferences?.blockMinutes ?? 25}/> : undefined}/>}
  </div>;
}

function weekSummary(anchor: Date, events: CalendarDisplayEvent[], completedKeys: ReadonlySet<string>) {
  const dates = new Set(weekDays(anchor).map(formatISO));
  const blocks = events.filter(event => event.completionKey && dates.has(event.date));
  const keys = [...new Set(blocks.map(event => event.completionKey!))];
  return {
    total: keys.length,
    stacked: keys.filter(key => completedKeys.has(key)).length,
    hours: Math.round(blocks.reduce((sum, event) => sum + (event.durationMinutes || 0), 0) / 60),
  };
}

function boardWeekTitle(cursor: Date) {
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  const primary = start.getMonth() === end.getMonth()
    ? `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}–${end.getDate()}`
    : `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()} – ${end.toLocaleDateString("en-US", { month: "short" })} ${end.getDate()}`;
  return { primary, year: String(end.getFullYear()) };
}

function UpNext({ event, timeZone, paint, done, upcoming, onToggle, onDetails, defaultMinutes }: { event: CalendarDisplayEvent | null; timeZone: string; paint?: CSSProperties; done: boolean; upcoming: boolean; onToggle: () => void; onDetails: () => void; defaultMinutes: number }) {
  const tone = event?.tone || (event?.kind === "due" ? "due" : "study");
  const when = event ? `${parseISODate(event.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${event.timeLabel ? ` · ${event.timeLabel}` : ""}` : "";
  const hours = durationLabel(event?.durationMinutes);
  return <section className={`up-next tone-${tone}`} style={paint} aria-label="Selected block">
    <div className="up-next-top"><span>{upcoming || !event ? "Up next" : "Selected"}</span>{event && <em>{tone === "due" ? "Due" : tone}</em>}</div>
    {event ? <>
      <h2 className={done ? "is-complete" : undefined}>{event.title}</h2>
      <p>{when}</p>
      {hours && <div className="up-next-time"><strong>{hours}</strong><span>hours scheduled</span></div>}
      {event.kind !== "class" && <StartFocusButton event={event} timeZone={timeZone} defaultMinutes={defaultMinutes}/>}
      <div className="up-next-actions">
        {event.completionKey && <button type="button" className={done ? "is-done" : ""} aria-pressed={done} onClick={onToggle}>{done ? "Stacked" : "Mark stacked"}</button>}
        {event.htmlUrl && <a href={event.htmlUrl} target="_blank" rel="noopener noreferrer">Open in {event.sourceLabel}</a>}
        <button type="button" onClick={onDetails}>Details</button>
      </div>
    </> : <p className="up-next-empty">Select a block, or drop one on today.</p>}
  </section>;
}

function WeekStack({ cursor, events, completedKeys, stacked, total }: { cursor: Date; events: CalendarDisplayEvent[]; completedKeys: ReadonlySet<string>; stacked: number; total: number }) {
  return <section className="stack-card" aria-label="Your week, stacked">
    <header><h2>Your week, stacked</h2><span>{stacked}/{total}</span></header>
    <div className="stack-days">{weekDays(cursor).map(day => {
      const iso = formatISO(day);
      const items = events.filter(event => event.completionKey && event.date === iso).slice(0, 4);
      return <div key={iso}><span>{WEEKDAYS[(day.getDay() + 6) % 7].slice(0, 1)}</span><div>{items.length === 0 ? <i className="stack-gap"/> : items.map(item => <i key={item.id} className={item.completionKey && completedKeys.has(item.completionKey) ? "stack-done" : "stack-open"}/>)}</div></div>;
    })}</div>
    <p>Filled bricks are done. Outlined ones are still waiting for you.</p>
  </section>;
}
