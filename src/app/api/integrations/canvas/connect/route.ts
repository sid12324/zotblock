import { NextRequest, NextResponse } from "next/server";
import { connectCanvasToken } from "@/lib/integrations/canvas";
import { IntegrationError } from "@/lib/integrations/http";
import { assertSameOrigin } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try { assertSameOrigin(request); }
  catch {
    return NextResponse.json({ error: "Open the app at the address configured in APP_URL to connect Canvas." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await connectCanvasToken();
    return NextResponse.json({ connected: "canvas" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "Canvas could not be connected. Check the server token and session configuration." }, { status: error instanceof IntegrationError ? error.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
