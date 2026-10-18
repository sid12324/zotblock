import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const dropTones = ["study", "class", "life", "build"] as const;
export type DropTone = (typeof dropTones)[number];

const instant = z.string().refine(value => {
  try { Temporal.Instant.from(value); return true; } catch { return false; }
}, "Enter a valid time.");

export const droppedBlockSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  tone: z.enum(dropTones),
  start: instant,
  end: instant,
});

export const droppedBlocksSchema = z.array(droppedBlockSchema).max(200);
export type DroppedBlock = z.infer<typeof droppedBlockSchema>;

/** Pulls a trailing duration such as "1 hr" or "45 min" out of the title. */
export function parseDropTitle(raw: string) {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  const stripped = raw.replace(/,?\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\s*$/i, "").trim();
  let minutes = 60;
  if (match) {
    const amount = Number(match[1]);
    minutes = match[2].toLowerCase().startsWith("h") ? amount * 60 : amount;
  }
  return {
    title: (stripped || raw.trim()).slice(0, 120),
    durationMinutes: Math.max(15, Math.min(240, Math.round(minutes))),
  };
}

export function dropWindow(date: string, startMinutes: number, durationMinutes: number, timeZone: string) {
  const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(startMinutes)));
  const start = Temporal.PlainDate.from(date).toPlainDateTime({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).toZonedDateTime(timeZone);
  const end = start.add({ minutes: durationMinutes });
  return { start: start.toInstant().toString(), end: end.toInstant().toString() };
}
