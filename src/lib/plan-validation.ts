import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { studyPreferencesSchema } from "./preferences";
import { assignmentEditsSchema } from "./assignment-edits";
import type { StudyPlan } from "./types";

const instant = z.string().refine(value => {
  try { Temporal.Instant.from(value); return true; } catch { return false; }
});
const timeZone = z.string().refine(value => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(value);
    return true;
  } catch { return false; }
});
const priority = z.enum(["high", "medium", "low"]);
const sourceProvider = z.enum(["gmail", "canvas"]);
const sourceUrl = z.string().nullable();
const assignmentDetails = z.object({
  pointsPossible: z.number().finite().optional(), submissionTypes: z.array(z.string()).optional(),
  allowedExtensions: z.array(z.string()).optional(), instructionsHtml: z.string().optional(),
  attachments: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
  unlockAt: instant.nullable().optional(), lockAt: instant.nullable().optional(),
  timeLimitMinutes: z.number().finite().optional(), questionCount: z.number().finite().optional(),
  allowedAttempts: z.number().finite().optional(), lockedForUser: z.boolean().optional(),
  lockExplanation: z.string().optional(), gradingType: z.string().optional(),
});
const assignment = z.object({
  id: z.string(), title: z.string(), course: z.string(), dueAt: instant,
  url: sourceUrl, description: z.string(), details: assignmentDetails.optional(),
  userEdits: assignmentEditsSchema.optional(),
});
const task = z.object({
  id: z.string(), source: sourceProvider, sourceId: z.string(), title: z.string(),
  course: z.string(), dueAt: instant, estimatedMinutes: z.number().finite().positive(),
  priority, url: sourceUrl,
});

function intervalWithin(start: string, end: string, maximumHours?: number) {
  try {
    const milliseconds = Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds;
    return milliseconds > 0 && (maximumHours === undefined || milliseconds <= maximumHours * 3_600_000);
  } catch { return false; }
}

// Browser storage and JSON responses are untrusted, even when TypeScript callers use StudyPlan.
export const sourceDataSchema = z.object({
    assignments: z.array(assignment),
    emails: z.array(z.object({
      id: z.string(), subject: z.string(), from: z.string(), receivedAt: instant, body: z.string(), url: z.string(),
    })),
    calendarEvents: z.array(z.object({
      id: z.string(), summary: z.string(), start: instant, end: instant, allDay: z.boolean().optional(),
    }).refine(value => intervalWithin(value.start, value.end))),
    collectionWarnings: z.array(z.string()).optional(),
  });

export const studyBlockSchema = z.object({
    id: z.string(), summary: z.string(), description: z.string(),
    start: z.object({ dateTime: instant, timeZone }),
    end: z.object({ dateTime: instant, timeZone }),
    source: z.object({ provider: sourceProvider, id: z.string(), title: z.string(), dueAt: instant, url: sourceUrl }),
    priority,
  }).refine(value => intervalWithin(value.start.dateTime, value.end.dateTime, 24));

export const studyPlanSchema = z.object({
  schemaVersion: z.literal("1.0"), generatedAt: instant, mode: z.enum(["live", "demo"]),
  timeZone, preferences: studyPreferencesSchema.optional(),
  window: z.object({ start: instant, end: instant }).refine(value => intervalWithin(value.start, value.end, 24 * 31)),
  orchestration: z.object({ framework: z.literal("langchain"), model: z.string().nullable() }),
  studyBlocks: z.array(studyBlockSchema),
  unscheduledTasks: z.array(z.object({ task, remainingMinutes: z.number().finite().nonnegative(), reason: z.string() })),
  sourceData: sourceDataSchema,
  warnings: z.array(z.string()),
});

export function isStudyPlan(value: unknown): value is StudyPlan {
  return studyPlanSchema.safeParse(value).success;
}
