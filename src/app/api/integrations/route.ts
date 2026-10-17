import { NextResponse } from "next/server";
import { getCanvasSession, getGoogleSession } from "@/lib/session";
import { checkGoogleCalendar, googleAccess, googleConfigured } from "@/lib/integrations/google";
import { canvasConfigured, canvasTokenConfigured } from "@/lib/integrations/canvas";
import { IntegrationError } from "@/lib/integrations/http";
import type { IntegrationResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [storedGoogle, canvas] = await Promise.all([getGoogleSession(), getCanvasSession()]);
  let google = storedGoogle;
  let calendarIssue: { message: string; code?: string; actionUrl?: string } | undefined;
  if (storedGoogle?.enabled.includes("google-calendar")) {
    try {
      google = await googleAccess();
      if (!google?.enabled.includes("google-calendar")) throw new IntegrationError("Reconnect Google Calendar and approve calendar access.", 401, "AUTH_REQUIRED");
      await checkGoogleCalendar(google);
    } catch (error) {
      calendarIssue = error instanceof IntegrationError
        ? { message: error.message, code: error.code, actionUrl: error.actionUrl }
        : { message: "Google Calendar could not be checked. Please try again.", code: "CHECK_FAILED" };
    }
  }
  const data: IntegrationResponse = {
    integrations: [
      { id: "gmail", configured: googleConfigured(), connected: Boolean(google?.enabled.includes("gmail")), ...(google?.enabled.includes("gmail") ? { account: google.account } : {}) },
      { id: "canvas", configured: canvasConfigured(), connected: Boolean(canvas), connectionMethod: canvasTokenConfigured() ? "personal-token" : "oauth", ...(canvas ? { account: canvas.account } : {}) },
      { id: "google-calendar", configured: googleConfigured(), connected: Boolean(google?.enabled.includes("google-calendar")), ...(google?.enabled.includes("google-calendar") ? { account: google.account } : {}), ...(calendarIssue ? { issue: calendarIssue } : {}) },
    ],
    modelConfigured: Boolean(process.env.OPENAI_API_KEY),
  };
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
