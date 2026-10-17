"use client";

import { useId, useState, type FormEvent } from "react";
import { assignmentDetailFields, assignmentDetailLabels, assignmentDetailValues } from "@/lib/assignment-edits";
import type { Assignment, AssignmentDetailField, AssignmentEdits } from "@/lib/types";

export type AssignmentDraft = { description: string; details: Record<AssignmentDetailField, string> };

/** Use nullish checks so an intentional blank correction stays blank. */
export function assignmentDraftFrom(assignment: Assignment, timeZone: string): AssignmentDraft {
  const original = assignmentDetailValues(assignment.details, timeZone);
  return {
    description: assignment.userEdits?.description ?? assignment.description,
    details: Object.fromEntries(assignmentDetailFields.map(field => [field, assignment.userEdits?.details?.[field] ?? original[field] ?? ""])) as AssignmentDraft["details"],
  };
}

/** Persist only changed text, keeping the original Canvas facts and due date intact. */
export function assignmentEditsFromDraft(assignment: Assignment, draft: AssignmentDraft, timeZone: string): AssignmentEdits | null {
  const original = assignmentDetailValues(assignment.details, timeZone);
  const edits: AssignmentEdits = {};
  const description = draft.description.trim();
  if (description !== assignment.description.trim()) edits.description = description;
  const details: NonNullable<AssignmentEdits["details"]> = {};
  for (const field of assignmentDetailFields) {
    const value = draft.details[field].trim();
    if (value !== (original[field] ?? "").trim()) details[field] = value;
  }
  if (Object.keys(details).length) edits.details = details;
  return Object.keys(edits).length ? edits : null;
}

const wideFields = new Set<AssignmentDetailField>(["submissionTypes", "allowedExtensions", "unlockAt", "lockAt", "lockExplanation"]);

export function AssignmentEditor({ assignment, timeZone, onSave, notice }: {
  assignment: Assignment;
  timeZone: string;
  onSave: (edits: AssignmentEdits | null) => void;
  notice?: string | null;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => assignmentDraftFrom(assignment, timeZone));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saved = assignmentDraftFrom(assignment, timeZone);
  const original = assignmentDetailValues(assignment.details, timeZone);
  const dirty = draft.description !== saved.description || assignmentDetailFields.some(field => draft.details[field] !== saved.details[field]);
  const hasSavedEdits = assignment.userEdits?.description !== undefined || Object.keys(assignment.userEdits?.details || {}).length > 0;

  function updateField(field: AssignmentDetailField, value: string) {
    setDraft(previous => ({ ...previous, details: { ...previous.details, [field]: value } }));
    setMessage("");
    setError("");
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const edits = assignmentEditsFromDraft(assignment, draft, timeZone);
      onSave(edits);
      setDraft(assignmentDraftFrom({ ...assignment, userEdits: edits ?? undefined }, timeZone));
      setMessage(edits ? "Corrections saved in this browser for your next study plan." : "Canvas values restored for your next study plan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your changes could not be saved. Please try again.");
    }
  }
  function cancel() {
    setDraft(saved);
    setError("");
    setMessage("Unsaved changes discarded.");
  }
  function reset() {
    setError("");
    try {
      onSave(null);
      setDraft(assignmentDraftFrom({ ...assignment, userEdits: undefined }, timeZone));
      setMessage("Canvas values restored for your next study plan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Canvas values could not be restored. Please try again.");
    }
  }

  return <form className="assignment-editor" onSubmit={save} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-help`}>
    <div className="assignment-editor-heading"><h3 id={`${id}-heading`} className="label">Assignment details</h3><span>{hasSavedEdits ? "Locally edited" : "Local copy"}</span></div>
    <p className="assignment-editor-help" id={`${id}-help`}>Corrections stay in this browser and guide your next generated plan. Scheduling uses the Canvas due date.</p>
    <label className="assignment-editor-field" htmlFor={`${id}-description`}><span>Assignment instructions</span><textarea id={`${id}-description`} name="description" rows={8} maxLength={100_000} value={draft.description} onChange={event => { setDraft(previous => ({ ...previous, description: event.target.value })); setError(""); setMessage(""); }}/></label>
    <div className="assignment-editor-fields">{assignmentDetailFields.map(field => <label key={field} className={`assignment-editor-field ${wideFields.has(field) ? "wide" : ""}`} htmlFor={`${id}-${field}`}><span>{assignmentDetailLabels[field]}</span><input id={`${id}-${field}`} type="text" name={field} maxLength={2_000} value={draft.details[field]} placeholder={original[field] === undefined ? "Not provided by Canvas" : undefined} onChange={event => updateField(field, event.target.value)}/></label>)}</div>
    <div className="assignment-editor-actions"><button type="submit" className="assignment-save" disabled={!dirty}>Save</button><button type="button" onClick={cancel} disabled={!dirty}>Cancel</button><button type="button" className="assignment-reset" onClick={reset} disabled={!dirty && !hasSavedEdits}>Reset to Canvas</button></div>
    {error ? <p className="assignment-editor-error" role="alert">{error}</p> : (notice || message) && <p className="assignment-editor-notice" role="status">{notice || message}</p>}
  </form>;
}
