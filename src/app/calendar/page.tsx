"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlan } from "@/components/plan-provider";
import { useGeneration } from "@/components/generation-provider";
import { useStudyPreferences } from "@/components/preferences-provider";
import { saveAssignmentEdits, useAssignmentEdits } from "@/components/assignment-edits-provider";
import { applyPlanAssignmentEdits, assignmentEditKey } from "@/lib/assignment-edits";
import { calendarEventsFromPlan } from "@/lib/calendar/events";
import type { AssignmentEdits, StudyPlan } from "@/lib/types";
import { DayView, MonthView, WeekView } from "@/components/calendar/calendar-views";
import { DetailPanel } from "@/components/calendar/detail-panel";
import { GoogleCalendarExport, useGoogleCalendarExport, type GoogleCalendarExportController } from "@/components/calendar/google-calendar-export";
import { FocusTimerCard, StartFocusButton } from "@/components/calendar/focus-timer-card";
import { useCalendarClock } from "@/components/calendar/use-calendar-clock";
import { dayTitle, monthName, parseISODate, shiftCursor, weekTitle, type CalendarView } from "@/components/calendar/dates";
import "./calendar.css";
import "@/components/calendar/assignment-editor.css";
import "@/components/calendar/focus-timer-card.css";

function CalendarLinks() { return <nav className="calendar-links" aria-label="App navigation"><Link href="/integrations">Integrations</Link><Link href="/onboarding">Preferences</Link><Link href="/focus">Focus</Link><Link href="/output">Raw JSON</Link></nav>; }
function Chevron({ direction }: { direction: "left" | "right" }) { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d={direction === "left" ? "M10 3L5 8L10 13" : "M6 3L11 8L6 13"}/></svg>; }

export default function CalendarPage() {
  const { plan, ready, storageNotice } = usePlan();
  const generation = useGeneration();
  const { preferences } = useStudyPreferences();
  const corrections = useAssignmentEdits();
  const basePlan = generation.preview || plan;
  const effectivePlan = useMemo(() => basePlan ? applyPlanAssignmentEdits(basePlan, corrections.edits) : null, [basePlan, corrections.edits]);
  const exportBlocked = generation.running ? "Finish generating the plan before exporting." : generation.preview && generation.error ? "Close the incomplete preview in Integrations before exporting." : null;
  // The saved plan contains only a successful generation; streamed previews never enter this request.
  const calendarExport = useGoogleCalendarExport(ready ? plan : null, exportBlocked);
  if (!ready || !effectivePlan) return <div className="zot-calendar"><div className="app"><section className="calendar"><header className="topbar"><Link href="/calendar" className="wordmark"><span className="mark"/><span>ZOTBLOCK</span></Link><CalendarLinks/></header>{ready && <FocusTimerCard timeZone={preferences.timeZone} defaultMinutes={preferences.blockMinutes}/>}<main className="calendar-empty"><span className="empty-mark"/><p className="label">YOUR STUDY CALENDAR</p><h1>{!ready ? "Loading your plan…" : "Make room for what’s next."}</h1>{ready && <><p>Connect your accounts and generate a study plan to see your study blocks, calendar events, and deadlines together.</p>{storageNotice && <p role="status">{storageNotice}</p>}<Link href="/integrations" className="canvas-btn">Go to integrations <Chevron direction="right"/></Link><p className="empty-sample-note">You can also choose “Try sample data” on the integrations page.</p></>}</main></section></div></div>;
  return <CalendarWorkspace key={generation.jobId || `${effectivePlan.generatedAt}:${effectivePlan.mode}`} plan={effectivePlan} storageNotice={storageNotice} running={generation.running} calendarExport={calendarExport}/>;
}

function CalendarWorkspace({ plan, storageNotice, running, calendarExport }: { plan: StudyPlan; storageNotice: string | null; running: boolean; calendarExport: GoogleCalendarExportController }) {
  const events = useMemo(() => calendarEventsFromPlan(plan), [plan]);
  // This workspace mounts only after the browser plan store hydrates; no server/client clock mismatch.
  const now = useCalendarClock(plan.timeZone);
  const today = useMemo(() => parseISODate(now.date), [now.date]);
  const firstStudy = events.find(event => event.kind === "study");
  const [cursor, setCursor] = useState(() => today);
  const [view, setView] = useState<CalendarView>("week");
  const [selectedId, setSelectedId] = useState<string | null>(firstStudy?.id || events[0]?.id || null);
  const [panelOpen, setPanelOpen] = useState(() => events.length > 0 && window.matchMedia("(min-width: 901px)").matches);
  const triggerRef = useRef<HTMLElement | null>(null);
  const selected = events.find(event => event.id === selectedId) || null;
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { setPanelOpen(false); triggerRef.current?.focus(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function selectEvent(id: string) { triggerRef.current = document.activeElement as HTMLElement | null; setSelectedId(id); setPanelOpen(true); }
  function closePanel() { setPanelOpen(false); triggerRef.current?.focus(); }
  function saveSelectedAssignment(edits: AssignmentEdits | null) {
    if (selected?.assignment) saveAssignmentEdits(assignmentEditKey(selected.assignment, plan.mode), edits);
  }
  const title = view === "month" ? { primary: monthName(cursor), secondary: String(cursor.getFullYear()) } : view === "week" ? weekTitle(cursor) : dayTitle(cursor);
  const shared = { cursor, today, events, selectedId: panelOpen ? selectedId : null, onSelect: selectEvent, now, timeZone: plan.timeZone };
  return <div className="zot-calendar"><div className="app"><main className="calendar" aria-label="Study calendar"><header className="topbar"><Link href="/calendar" className="wordmark"><span className="mark"/><span>ZOTBLOCK</span></Link><CalendarLinks/><span className="status"><span className="status-dot"/>{plan.mode === "demo" ? "Sample plan" : "Your study plan"}</span></header><div className="mast"><div className="mast-title"><h1>{title.primary}</h1><p>{title.secondary}</p></div><div className="mast-actions"><button type="button" className="today-button" onClick={() => setCursor(today)}>Today</button><div className="nav"><button type="button" aria-label={`Previous ${view}`} onClick={() => setCursor(shiftCursor(cursor, view, -1))}><Chevron direction="left"/></button><button type="button" aria-label={`Next ${view}`} onClick={() => setCursor(shiftCursor(cursor, view, 1))}><Chevron direction="right"/></button></div><div className="switch" role="group" aria-label="Calendar view">{(["month", "week", "day"] as const).map(option => <button key={option} type="button" aria-pressed={view === option} className={view === option ? "on" : ""} onClick={() => setView(option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</button>)}</div></div></div><div className="calendar-context"><div className="calendar-legend">{plan.mode === "demo" && <span className="sample-plan-label">Sample data</span>}<span><i className="study-key"/>Study blocks</span><span><i className="busy-key"/>Calendar events</span><span><i className="due-key"/>Deadlines</span></div><span className="calendar-timezone">{plan.timeZone.replaceAll("_", " ")}</span></div><FocusTimerCard timeZone={plan.timeZone} defaultMinutes={plan.preferences?.blockMinutes ?? 25}/><div className="calendar-export-toolbar"><GoogleCalendarExport controller={calendarExport} compact/></div>{storageNotice && <p className="calendar-storage-note" role="status">{storageNotice}</p>}{plan.warnings.length > 0 && <details className="calendar-warnings"><summary>{plan.warnings.length} plan {plan.warnings.length === 1 ? "note" : "notes"}</summary><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}{!running && events.length === 0 && <p className="calendar-storage-note">No events or study blocks were found in this plan. <Link href="/integrations">Review your connections</Link> or adjust your preferences.</p>}<div className="calendar-view-scroll">{view === "month" ? <MonthView {...shared} onShowWeek={date => { setCursor(date); setView("week"); }} onShowDay={date => { setCursor(date); setView("day"); }}/> : view === "week" ? <WeekView {...shared}/> : <DayView {...shared}/>}</div></main>{panelOpen && selected && <DetailPanel key={selected.id} event={selected} timeZone={plan.timeZone} onClose={closePanel} onSaveAssignment={selected.assignment ? saveSelectedAssignment : undefined} editsNotice={storageNotice} calendarExport={calendarExport} focusAction={selected.kind !== "class" ? <StartFocusButton event={selected} timeZone={plan.timeZone} defaultMinutes={plan.preferences?.blockMinutes ?? 25}/> : undefined}/>}</div></div>;
}
