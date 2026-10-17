import { NextRequest, NextResponse } from "next/server";
import { appUrl, beginOAuth } from "@/lib/session";
import { canvasAuthorizationUrl, validateCanvasOrigin } from "@/lib/integrations/canvas";
import { IntegrationError } from "@/lib/integrations/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const origin = validateCanvasOrigin(request.nextUrl.searchParams.get("domain"));
    const state = await beginOAuth("canvas", origin);
    return NextResponse.redirect(canvasAuthorizationUrl(origin, state));
  } catch (error) {
    const url = new URL("/integrations", appUrl());
    url.searchParams.set("error", error instanceof IntegrationError ? error.message : "Canvas could not be connected. Check the server OAuth and session configuration.");
    return NextResponse.redirect(url);
  }
}
