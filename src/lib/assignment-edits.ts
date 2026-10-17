import { z } from "zod";
import type { Assignment, AssignmentDetailField, AssignmentDetails, AssignmentEditsMap, SourceData, StudyPlan } from "./types";

export const assignmentDetailFields = ["pointsPossible", "allowedAttempts", "gradingType", "submissionTypes", "allowedExtensions", "unlockAt", "lockAt", "lockedForUser", "timeLimitMinutes", "questionCount", "lockExplanation"] as const satisfies readonly AssignmentDetailField[];
export const assignmentDetailLabels: Record<AssignmentDetailField, string> = {
  pointsPossible: "Points", allowedAttempts: "Allowed attempts", gradingType: "Grading", submissionTypes: "Submit as",
  allowedExtensions: "File types", unlockAt: "Available from", lockAt: "Locks at", lockedForUser: "Access",
  timeLimitMinutes: "Time limit", questionCount: "Questions", lockExplanation: "Access note",
};
const editableText = z.string().max(2_000, "Keep assignment detail fields under 2,000 characters.");
export const assignmentEditsSchema = z.object({
  description: z.string().max(100_000, "Keep assignment instructions under 100,000 characters.").optional(),
  details: z.object({
    pointsPossible: editableText.optional(), allowedAttempts: editableText.optional(), gradingType: editableText.optional(),
    submissionTypes: editableText.optional(), allowedExtensions: editableText.optional(), unlockAt: editableText.optional(),
    lockAt: editableText.optional(), lockedForUser: editableText.optional(), timeLimitMinutes: editableText.optional(),
    questionCount: editableText.optional(), lockExplanation: editableText.optional(),
  }).optional(),
});
export const assignmentEditsMapSchema = z.record(z.string().max(600), assignmentEditsSchema).refine(value => Object.keys(value).length <= 1_000, "Too many saved assignment corrections.");

function setting(value: string) { return value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase()); }
function date(value: string | null, timeZone: string) {
  return value === null ? "Not set" : new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export function assignmentDetailValues(details: AssignmentDetails = {}, timeZone: string): Partial<Record<AssignmentDetailField, string>> {
  const values: Partial<Record<AssignmentDetailField, string>> = {};
  if (details.pointsPossible !== undefined) values.pointsPossible = String(details.pointsPossible);
  if (details.allowedAttempts !== undefined) values.allowedAttempts = details.allowedAttempts === -1 ? "Unlimited" : String(details.allowedAttempts);
  if (details.gradingType !== undefined) values.gradingType = setting(details.gradingType);
  if (details.submissionTypes !== undefined) values.submissionTypes = details.submissionTypes.map(setting).join(", ");
  if (details.allowedExtensions !== undefined) values.allowedExtensions = details.allowedExtensions.join(", ");
  if (details.unlockAt !== undefined) values.unlockAt = date(details.unlockAt, timeZone);
  if (details.lockAt !== undefined) values.lockAt = date(details.lockAt, timeZone);
  if (details.lockedForUser !== undefined) values.lockedForUser = details.lockedForUser ? "Locked" : "Not locked";
  if (details.timeLimitMinutes !== undefined) values.timeLimitMinutes = `${details.timeLimitMinutes} minutes`;
  if (details.questionCount !== undefined) values.questionCount = String(details.questionCount);
  if (details.lockExplanation !== undefined) values.lockExplanation = details.lockExplanation;
  return values;
}

/** Canvas IDs are scoped to the school; sample corrections stay separate from live accounts. */
export function assignmentEditKey(assignment: Pick<Assignment, "id" | "url" | "course">, mode: StudyPlan["mode"]) {
  let scope = assignment.course;
  try { if (assignment.url) scope = new URL(assignment.url).origin; } catch { /* Use course context when a source link is missing. */ }
  return `${mode}:${scope}:${assignment.id}`;
}

/** Keep Canvas facts intact and attach only corrections for assignments in this collection. */
export function applyAssignmentEdits(sources: SourceData, edits: AssignmentEditsMap, mode: StudyPlan["mode"]): SourceData {
  return { ...sources, assignments: sources.assignments.map(assignment => {
    const original = { ...assignment };
    delete original.userEdits;
    const saved = edits[assignmentEditKey(assignment, mode)];
    return saved ? { ...original, userEdits: saved } : original;
  }) };
}
export function applyPlanAssignmentEdits(plan: StudyPlan, edits: AssignmentEditsMap): StudyPlan {
  return { ...plan, sourceData: applyAssignmentEdits(plan.sourceData, edits, plan.mode) };
}
