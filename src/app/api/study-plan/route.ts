import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateStudyPlan } from "@/lib/planner";
import { assertSameOrigin, getCanvasSession, getGoogleSession } from "@/lib/session";
import { canvasAccess } from "@/lib/integrations/canvas";
import { googleAccess } from "@/lib/integrations/google";
import { IntegrationError } from "@/lib/integrations/http";
import { studyPreferencesSchema } from "@/lib/preferences";
import { assignmentEditsMapSchema } from "@/lib/assignment-edits";
import type { PlanningStreamEvent } from "@/lib/progress";

export const runtime = "nodejs";
export const maxDuration = 180;
const requestSchema = z.object({ mode: z.enum(["live", "demo"]), preferences: studyPreferencesSchema, assignmentEdits: assignmentEditsMapSchema.optional() });

function planningError(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not generate a study plan. Please try again.";
  const safeMessage = /API key|api_key|sk-proj-|sk-/.test(message)
    ? "The model could not authenticate. Check OPENAI_API_KEY in .env.local."
    : message.length > 350 ? "Study planning failed. Check your provider setup and try again." : message;
  return { error: safeMessage, ...(error instanceof IntegrationError ? { code: error.code, actionUrl: error.actionUrl } : {}) };
}

/** Token refresh must finish while response headers can still carry Set-Cookie. */
async function prepareStreamSessions() {
  const [google, canvas] = await Promise.all([getGoogleSession(), getCanvasSession()]);
  if (!google?.enabled.includes("google-calendar")) throw new IntegrationError("Connect Google Calendar before generating study blocks.", 400);
  if (!google.enabled.includes("gmail") && !canvas) throw new IntegrationError("Connect Gmail or Canvas so the planner can find academic tasks.", 400);
  await Promise.all([googleAccess(), canvas ? canvasAccess() : Promise.resolve(null)]);
}

export async function POST(request: NextRequest) {
  try { assertSameOrigin(request); } catch {
    return NextResponse.json({ error: "Open the app at the address configured in APP_URL to generate a study plan." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check your study preferences." }, { status: 400 });
  const input = { ...parsed.data, now: new Date().toISOString() };
  const streaming = request.headers.get("accept")?.includes("application/x-ndjson");
  if (!streaming) {
    try {
      const plan = await generateStudyPlan(input);
      return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json(planningError(error), { status: error instanceof IntegrationError ? error.status : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  try { if (input.mode === "live") await prepareStreamSessions(); }
  catch (error) { return NextResponse.json(planningError(error), { status: error instanceof IntegrationError ? error.status : 502, headers: { "Cache-Control": "no-store" } }); }

  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(event: PlanningStreamEvent) {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
        catch { closed = true; stopHeartbeat(); }
      }
      heartbeat = setInterval(() => {
        if (!closed) { try { controller.enqueue(encoder.encode("\n")); } catch { closed = true; stopHeartbeat(); } }
      }, 10_000);
      const onAbort = () => { closed = true; stopHeartbeat(); try { controller.close(); } catch { /* Already closed by the HTTP client. */ } };
      request.signal.addEventListener("abort", onAbort, { once: true });
      send({ type: "progress", progress: { stage: "connections", status: "running", message: input.mode === "demo" ? "Preparing sample sources…" : "Checking connected sources…" } });
      void generateStudyPlan(input, {
        onProgress: progress => send({ type: "progress", progress }),
        onSources: sources => send({ type: "sources", sources }),
        onBlock: (block, completed, total) => send({ type: "block", block, completed, total }),
      }).then(plan => { send({ type: "complete", plan }); })
        .catch(error => { send({ type: "error", ...planningError(error) }); })
        .finally(() => {
          stopHeartbeat();
          request.signal.removeEventListener("abort", onAbort);
          if (!closed) { closed = true; controller.close(); }
        });
    },
    cancel() { closed = true; stopHeartbeat(); },
  });
  return new NextResponse(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
