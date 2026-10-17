import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectCalendarExportItems } from "@/lib/calendar/export";
import { exportCalendarItems } from "@/lib/integrations/calendar-export";
import { googleAccess, hasGoogleCalendarExportAccess } from "@/lib/integrations/google";
import { IntegrationError } from "@/lib/integrations/http";
import { studyPlanSchema } from "@/lib/plan-validation";
import { assertSameOrigin } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 180;
const authorizationUrl = "/api/auth/google?provider=google-calendar&access=export&returnTo=calendar";
const headers = { "Cache-Control": "no-store" };
const requestSchema = z.object({
  plan: studyPlanSchema,
  scope: z.enum(["all", "selected"]),
  selectedId: z.string().min(1).max(5000).optional(),
}).strict().refine(input => input.scope !== "selected" || Boolean(input.selectedId));

async function requestBody(request: NextRequest) {
  const limit = 20 * 1024 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new IntegrationError("Send a valid JSON study plan.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new IntegrationError("This plan is too large to export. Generate a shorter planning window and try again.", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new IntegrationError("Send a valid JSON study plan.", 400); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  try { assertSameOrigin(request); }
  catch { return NextResponse.json({ error: "Open the app at the address configured in APP_URL to export your calendar." }, { status: 403, headers }); }
  try {
    const parsed = requestSchema.safeParse(await requestBody(request));
    if (!parsed.success) return NextResponse.json({ error: "Choose a complete study plan and an export option." }, { status: 400, headers });
    const items = selectCalendarExportItems(parsed.data.plan, parsed.data.scope, parsed.data.selectedId);
    if (!items.length) return NextResponse.json({ error: parsed.data.scope === "selected" ? "Choose a study block or deadline to export." : "This plan has no study blocks or deadlines to export." }, { status: 400, headers });
    const session = await googleAccess();
    if (!session?.enabled.includes("google-calendar")) throw new IntegrationError("Connect Google Calendar to export this plan.", 401, "AUTH_REQUIRED", authorizationUrl);
    if (!hasGoogleCalendarExportAccess(session)) throw new IntegrationError("Allow ZotBlock to add events to your Google Calendar, then export again.", 403, "INSUFFICIENT_SCOPE", authorizationUrl);
    return NextResponse.json(await exportCalendarItems(session, items), { headers });
  } catch (error) {
    if (error instanceof IntegrationError) {
      const actionUrl = ["AUTH_REQUIRED", "INSUFFICIENT_SCOPE"].includes(error.code || "") ? authorizationUrl : error.actionUrl;
      return NextResponse.json({ error: error.message, code: error.code, actionUrl }, { status: error.status, headers });
    }
    return NextResponse.json({ error: "Calendar export could not finish. Try again; items already added will be skipped." }, { status: 502, headers });
  }
}
