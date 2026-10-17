"use client";

import Link from "next/link";
import { clearGeneration, useGeneration } from "@/components/generation-provider";
import { planningStages, type PlanningProgress } from "@/lib/progress";

type GenerationState = ReturnType<typeof useGeneration>;
const labels = { connections: "Connections", canvas: "Canvas", gmail: "Gmail", calendar: "Google Calendar", extraction: "Task analysis", scheduling: "Study blocks" };

function safeActionUrl(value: string | null) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

function statusLine(value: PlanningProgress) {
  const count = value.completed === undefined ? "" : value.total === undefined ? ` (${value.completed})` : ` (${value.completed}/${value.total})`;
  return `${labels[value.stage]}${count}: ${value.message}${value.detail ? ` — ${value.detail}` : ""}`;
}

function statusText(generation: GenerationState) {
  const active = planningStages.flatMap(stage => generation.stages[stage]?.status === "running" ? [generation.stages[stage]!] : []);
  const updates = active.length ? active : generation.activity.slice(-1);
  if (generation.error) {
    return ["Planning stopped.", generation.error, "Your last completed plan is still saved. Any new calendar preview is incomplete.", ...updates.map(value => `Last update — ${statusLine(value)}`)].join("\n\n");
  }
  if (!generation.running) {
    const sources = generation.preview?.sourceData;
    return [`Your plan is ready: ${generation.completedBlocks} study blocks.`, sources ? `${sources.assignments.length} Canvas items · ${sources.emails.length} academic emails · ${sources.calendarEvents.length} existing calendar events.` : ""].filter(Boolean).join("\n");
  }
  return updates.length ? updates.map(statusLine).join("\n\n") : "Preparing your study plan…";
}

/** One text area keeps concurrent provider updates together without invented percentages. */
export function GenerationProgressPanel({ generation, onClear = clearGeneration }: { generation: GenerationState; onClear?: () => void }) {
  if (!generation.mode) return null;
  const ready = !generation.running && !generation.error;
  const actionUrl = safeActionUrl(generation.actionUrl);
  return <section className={`generation-progress${generation.error ? " has-error" : ""}${ready ? " is-ready" : ""}`} aria-label="Study plan status">
    <div className="generation-progress-heading"><span className="generation-eyebrow">{generation.mode === "demo" ? "SAMPLE PLAN" : "YOUR STUDY PLAN"}</span><h2>{generation.error ? "Planning stopped" : ready ? "Ready when you are." : "Building your study plan"}</h2></div>
    <pre className="generation-status-text" role="status" aria-live="polite" aria-atomic="true" aria-label="Planning updates">{statusText(generation)}</pre>
    {!generation.running && <div className="generation-status-actions">
      {ready && <Link href="/calendar">View calendar <span aria-hidden="true">↗</span></Link>}
      {generation.error && actionUrl && <a href={actionUrl} target="_blank" rel="noopener noreferrer">Open provider setup <span aria-hidden="true">↗</span></a>}
      <button type="button" onClick={onClear}>{generation.error ? "Dismiss status and try again" : "Dismiss status"}</button>
    </div>}
  </section>;
}

export function GenerationProgress() {
  const generation = useGeneration();
  return <GenerationProgressPanel generation={generation}/>;
}
