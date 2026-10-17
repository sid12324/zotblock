import { NextRequest, NextResponse } from "next/server";
import { appUrl, consumeOAuth } from "@/lib/session";
import { completeCanvasOAuth } from "@/lib/integrations/canvas";
import { IntegrationError } from "@/lib/integrations/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL("/integrations", appUrl());
  try {
    const state = await consumeOAuth(request.nextUrl.searchParams.get("state"));
    if (state.provider !== "canvas" || !state.origin) throw new IntegrationError("This connection request does not match Canvas. Please try again.", 400);
    if (request.nextUrl.searchParams.has("error")) throw new IntegrationError("Canvas connection was canceled or the requested permissions were declined.", 400);
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new IntegrationError("Canvas did not return an authorization code. Please try again.", 400);
    await completeCanvasOAuth(code, state.origin);
    url.searchParams.set("connected", "canvas");
  } catch (error) {
    url.searchParams.set("error", error instanceof IntegrationError ? error.message : "The Canvas connection request expired or could not be completed. Try connecting again.");
  }
  return NextResponse.redirect(url);
}
