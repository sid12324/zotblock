import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clearSession, getGoogleSession, saveGoogleSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); }
  catch { return NextResponse.json({ error: "This action must be requested from the app." }, { status: 403 }); }
  const { id } = await context.params;
  if (id === "canvas") await clearSession("canvas");
  else if (id === "gmail" || id === "google-calendar") {
    const session = await getGoogleSession();
    if (session) {
      session.enabled = session.enabled.filter(provider => provider !== id);
      if (session.enabled.length) await saveGoogleSession(session);
      else await clearSession("google");
    }
  } else return NextResponse.json({ error: "Unknown integration." }, { status: 404 });
  return NextResponse.json({ disconnected: id });
}
