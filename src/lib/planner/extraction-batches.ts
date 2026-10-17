import type { AcademicEmail, Assignment, SourceData } from "@/lib/types";

export const EXTRACTION_TARGET_CHARS = 50_000;
export const EXTRACTION_MAX_CHARS = 180_000;
const CANVAS_REFERENCE_CHARS = 20_000;
type CanvasReference = Pick<Assignment, "id" | "title" | "course" | "dueAt">;
export type ExtractionBatch = { assignments: Assignment[]; emails: AcademicEmail[]; canvasReferences: CanvasReference[] };

/** Source items are indivisible: long messages get their own request, never truncated bodies. */
function chunkItems<T>(items: T[], references: CanvasReference[], context: (items: T[], references: CanvasReference[]) => ExtractionBatch) {
  const batches: ExtractionBatch[] = [];
  const oversized: T[] = [];
  let current: T[] = [];
  let currentReferences = references;
  let referencesOmitted = false;
  const flush = () => { if (current.length) batches.push(context(current, currentReferences)); current = []; };
  for (const item of items) {
    let itemReferences = references;
    if (references.length && JSON.stringify(context([item], references)).length > EXTRACTION_MAX_CHARS) { itemReferences = []; referencesOmitted = true; }
    if (JSON.stringify(context([item], itemReferences)).length > EXTRACTION_MAX_CHARS) { oversized.push(item); continue; }
    if (current.length && (currentReferences !== itemReferences || JSON.stringify(context([...current, item], currentReferences)).length > EXTRACTION_TARGET_CHARS)) flush();
    if (!current.length) currentReferences = itemReferences;
    current.push(item);
  }
  flush();
  return { batches, oversized, referencesOmitted };
}

export function makeExtractionBatches(sources: SourceData) {
  const references = sources.assignments.map(({ id, title, course, dueAt }) => ({ id, title, course, dueAt }));
  const referencesTooLarge = JSON.stringify(references).length > CANVAS_REFERENCE_CHARS;
  const canvas = chunkItems(sources.assignments, [], (assignments, canvasReferences) => ({ assignments, emails: [], canvasReferences }));
  const gmail = chunkItems(sources.emails, referencesTooLarge ? [] : references, (emails, canvasReferences) => ({ assignments: [], emails, canvasReferences }));
  return { batches: [...canvas.batches, ...gmail.batches], oversizedAssignments: canvas.oversized, oversizedEmails: gmail.oversized, referencesOmitted: sources.emails.length > 0 && (referencesTooLarge || gmail.referencesOmitted) };
}
