import { NextRequest, NextResponse } from "next/server";
import { appUrl, beginOAuth, getGoogleSession } from "@/lib/session";
import { googleAuthorizationUrl } from "@/lib/integrations/google";
import { IntegrationError } from "@/lib/integrations/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const exportRequested = request.nextUrl.searchParams.get("access") === "export";
  try {
    const provider = request.nextUrl.searchParams.get("provider");
    if (provider !== "gmail" && provider !== "google-calendar") throw new IntegrationError("Choose Gmail or Google Calendar to connect.", 400);
    if (exportRequested && provider !== "google-calendar") throw new IntegrationError("Calendar export permission requires Google Calendar.", 400);
    const returnTo = request.nextUrl.searchParams.get("returnTo");
    if (returnTo && returnTo !== "calendar") throw new IntegrationError("Choose a valid connection return page.", 400);
    const session = await getGoogleSession();
    const state = await beginOAuth(provider, undefined, exportRequested ? { access: "export", returnTo: "/calendar" } : {});
    return NextResponse.redirect(googleAuthorizationUrl(provider, state, session?.account, exportRequested ? "export" : "read"));
  } catch (error) {
    const url = new URL(exportRequested ? "/calendar" : "/integrations", appUrl());
    url.searchParams.set("error", error instanceof IntegrationError ? error.message : "Google could not be connected. Check the server OAuth and session configuration.");
    return NextResponse.redirect(url);
  }
}
