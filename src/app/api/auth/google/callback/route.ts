import { NextRequest, NextResponse } from "next/server";
import { appUrl, consumeOAuth } from "@/lib/session";
import { completeGoogleOAuth } from "@/lib/integrations/google";
import { IntegrationError } from "@/lib/integrations/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL("/integrations", appUrl());
  try {
    const state = await consumeOAuth(request.nextUrl.searchParams.get("state"));
    if (state.returnTo === "/calendar") url.pathname = "/calendar";
    if (state.provider !== "gmail" && state.provider !== "google-calendar") throw new IntegrationError("This connection request does not match Google. Please try again.", 400);
    if (request.nextUrl.searchParams.has("error")) throw new IntegrationError("Google connection was canceled or the requested permissions were declined.", 400);
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new IntegrationError("Google did not return an authorization code. Please try again.", 400);
    await completeGoogleOAuth(code, state.provider, state.access === "export" ? "export" : "read");
    url.searchParams.set("connected", state.provider);
    if (state.access === "export") url.searchParams.set("calendarExport", "ready");
  } catch (error) {
    url.searchParams.set("error", error instanceof IntegrationError ? error.message : "The Google connection request expired or could not be completed. Try connecting again.");
  }
  return NextResponse.redirect(url);
}
