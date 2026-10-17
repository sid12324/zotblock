import { z } from "zod";
import { sourceDataSchema, studyBlockSchema, studyPlanSchema } from "@/lib/plan-validation";
import { planningStages, type PlanningStreamEvent } from "@/lib/progress";

const count = z.number().int().nonnegative();
const progressSchema = z.object({
  stage: z.enum(planningStages), status: z.enum(["running", "complete", "skipped"]),
  message: z.string(), completed: count.optional(), total: count.optional(), detail: z.string().optional(),
}).refine(value => value.completed === undefined || value.total === undefined || value.completed <= value.total);
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), progress: progressSchema }),
  z.object({ type: z.literal("sources"), sources: sourceDataSchema }),
  z.object({ type: z.literal("block"), block: studyBlockSchema, completed: count.positive(), total: count.positive() }).refine(value => value.completed <= value.total),
  z.object({ type: z.literal("complete"), plan: studyPlanSchema }),
  z.object({ type: z.literal("error"), error: z.string(), code: z.string().optional(), actionUrl: z.string().optional() }),
]);

/** Decode HTTP stream frames across arbitrary UTF-8 and network chunk boundaries. */
export async function readPlanningStream(response: Response, onEvent: (event: PlanningStreamEvent) => void): Promise<void> {
  if (!response.body) throw new Error("Live planning updates are unavailable. Try generating again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let terminal = false;
  function line(value: string) {
    if (!value.trim()) return; // Server heartbeat, without fabricated progress.
    if (terminal) throw new Error("The planning stream continued after it finished.");
    let event: PlanningStreamEvent;
    try { event = eventSchema.parse(JSON.parse(value)); }
    catch { throw new Error("A planning update could not be read. Try generating again."); }
    if (event.type === "complete" || event.type === "error") terminal = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (done) break;
    }
    line(pending);
    if (!terminal) throw new Error("The connection ended before your plan finished. Try generating again.");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
