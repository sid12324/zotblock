import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import type { GoogleSession } from "../src/lib/session";

const cookieValues = new Map<string, string>();
const cookieJar = {
  get(name: string) { const value = cookieValues.get(name); return value ? { name, value } : undefined; },
  set(name: string, value: string) { cookieValues.set(name, value); },
  delete(name: string) { cookieValues.delete(name); },
};
const requireForTest = createRequire(import.meta.url);
const headersPath = requireForTest.resolve("next/headers");
const originalHeaders = requireForTest.cache[headersPath];
requireForTest.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => cookieJar } } as NodeModule;
let session: typeof import("../src/lib/session");
let google: typeof import("../src/lib/integrations/google");
let authRoute: typeof import("../src/app/api/auth/google/route");
let callbackRoute: typeof import("../src/app/api/auth/google/callback/route");
const envNames = ["SESSION_SECRET", "APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const originalEnvironment = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const redirect = (response: Response) => new URL(response.headers.get("location")!);
const existingConnection = (): GoogleSession => ({ accessToken: "test-old-access", refreshToken: "test-same-account-refresh", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES.gmail, google.GOOGLE_SCOPES["google-calendar"]], enabled: ["gmail", "google-calendar"] });
const exportState = () => session.beginOAuth("google-calendar", undefined, { access: "export", returnTo: "/calendar" });

before(async () => {
  [session, google, authRoute, callbackRoute] = await Promise.all([
    import("../src/lib/session"), import("../src/lib/integrations/google"),
    import("../src/app/api/auth/google/route"), import("../src/app/api/auth/google/callback/route"),
  ]);
});
beforeEach(() => {
  cookieValues.clear();
  process.env.SESSION_SECRET = "test-session-secret-longer-than-thirty-two-characters";
  process.env.APP_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  globalThis.fetch = async () => { throw new Error("Unexpected network request in Google export auth test"); };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  }
  if (originalHeaders) requireForTest.cache[headersPath] = originalHeaders;
  else delete requireForTest.cache[headersPath];
});

function tokenAndProfile(scopes: string[], email = "student@example.edu") {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (String(input) === "https://oauth2.googleapis.com/token") {
      assert.equal(new URLSearchParams(init?.body as URLSearchParams).get("grant_type"), "authorization_code");
      return Response.json({ access_token: "test-upgraded-access", expires_in: 3600, scope: scopes.join(" ") });
    }
    assert.equal(String(input), "https://www.googleapis.com/oauth2/v2/userinfo");
    return Response.json({ email, verified_email: true });
  };
  return calls;
}

test("normal authorization stays readonly and only the explicit export flow requests owned event writes", () => {
  for (const provider of ["gmail", "google-calendar"] as const) {
    const normal = google.googleAuthorizationUrl(provider, "test-state");
    assert.ok(normal.searchParams.get("scope")!.split(" ").includes(google.GOOGLE_SCOPES[provider]));
    assert.ok(!normal.searchParams.get("scope")!.split(" ").includes(google.GOOGLE_CALENDAR_EXPORT_SCOPE));
  }
  const upgrade = google.googleAuthorizationUrl("google-calendar", "test-state", "student@example.edu", "export");
  assert.ok(upgrade.searchParams.get("scope")!.split(" ").includes(google.GOOGLE_CALENDAR_EXPORT_SCOPE));
  assert.equal(upgrade.searchParams.get("include_granted_scopes"), "true");
  assert.equal(upgrade.searchParams.get("access_type"), "offline");
  assert.equal(upgrade.searchParams.get("login_hint"), "student@example.edu");
  assert.throws(() => google.googleAuthorizationUrl("gmail", "test-state", undefined, "export"), /requires Google Calendar/);
});

test("export intent and its fixed return page are encrypted while existing Canvas state remains compatible", async () => {
  const state = await exportState();
  assert.equal(cookieValues.get("zoa_oauth")!.split(".").length, 5);
  assert.ok(!cookieValues.get("zoa_oauth")!.includes(state));
  assert.deepEqual(await session.consumeOAuth(state), { state, provider: "google-calendar", access: "export", returnTo: "/calendar" });
  await assert.rejects(session.consumeOAuth(state), /expired/);
  const canvas = await session.beginOAuth("canvas", "https://school.instructure.com");
  assert.deepEqual(await session.consumeOAuth(canvas), { state: canvas, provider: "canvas", origin: "https://school.instructure.com" });
  await assert.rejects(session.beginOAuth("google-calendar", undefined, { returnTo: "https://outside.example" as "/calendar" }), /valid connection return/);
});

test("the export authorization URL records Calendar intent and preserves the current account hint", async () => {
  await session.saveGoogleSession(existingConnection());
  const url = redirect(await authRoute.GET(request("/api/auth/google?provider=google-calendar&access=export&returnTo=calendar")));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("login_hint"), "student@example.edu");
  assert.ok(url.searchParams.get("scope")!.split(" ").includes(google.GOOGLE_CALENDAR_EXPORT_SCOPE));
  const state = url.searchParams.get("state")!;
  assert.deepEqual(await session.consumeOAuth(state), { state, provider: "google-calendar", access: "export", returnTo: "/calendar" });
});

test("an export callback preserves Gmail and the same account refresh token without creating events", async () => {
  await session.saveGoogleSession(existingConnection());
  const state = await exportState();
  const calls = tokenAndProfile([google.GOOGLE_SCOPES.gmail, google.GOOGLE_CALENDAR_EXPORT_SCOPE]);
  const url = redirect(await callbackRoute.GET(request(`/api/auth/google/callback?state=${state}&code=test-code`)));
  assert.equal(url.origin + url.pathname, "http://localhost:3000/calendar");
  assert.equal(url.searchParams.get("connected"), "google-calendar");
  assert.equal(url.searchParams.get("calendarExport"), "ready");
  assert.deepEqual(calls, ["https://oauth2.googleapis.com/token", "https://www.googleapis.com/oauth2/v2/userinfo"]);
  const connected = await session.getGoogleSession();
  assert.equal(connected?.refreshToken, "test-same-account-refresh");
  assert.deepEqual(connected?.enabled.sort(), ["gmail", "google-calendar"]);
  assert.equal(google.hasGoogleCalendarExportAccess(connected), true);
});

test("declined export permissions return to Calendar without changing the old connection", async () => {
  const previous = existingConnection();
  await session.saveGoogleSession(previous);
  const state = await exportState();
  const url = redirect(await callbackRoute.GET(request(`/api/auth/google/callback?state=${state}&error=access_denied&returnTo=https://outside.example`)));
  assert.equal(url.origin + url.pathname, "http://localhost:3000/calendar");
  assert.match(url.searchParams.get("error")!, /canceled|declined/);
  assert.deepEqual(await session.getGoogleSession(), previous);
});

test("a partial readonly grant cannot complete the export upgrade or replace an existing session", async () => {
  const previous = existingConnection();
  await session.saveGoogleSession(previous);
  const state = await exportState();
  tokenAndProfile([google.GOOGLE_SCOPES.gmail, google.GOOGLE_SCOPES["google-calendar"]]);
  const url = redirect(await callbackRoute.GET(request(`/api/auth/google/callback?state=${state}&code=test-code`)));
  assert.equal(url.pathname, "/calendar");
  assert.match(url.searchParams.get("error")!, /permission was not granted/);
  assert.equal(url.searchParams.has("calendarExport"), false);
  assert.deepEqual(await session.getGoogleSession(), previous);
  assert.equal(google.hasGoogleCalendarExportAccess(await session.getGoogleSession()), false);
});

test("broader Calendar write grants count as readable primary-calendar access during normal connection and refresh", async () => {
  for (const scope of [google.GOOGLE_CALENDAR_EXPORT_SCOPE, "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"]) {
    await session.saveGoogleSession(existingConnection());
    tokenAndProfile([google.GOOGLE_SCOPES.gmail, scope]);
    await google.completeGoogleOAuth("test-code", "google-calendar");
    let connected = await session.getGoogleSession();
    assert.ok(connected?.enabled.includes("google-calendar"));
    assert.equal(google.hasGoogleCalendarExportAccess(connected), true);
    await session.saveGoogleSession({ ...connected!, expiresAt: Date.now() - 1000 });
    globalThis.fetch = async input => {
      assert.equal(String(input), "https://oauth2.googleapis.com/token");
      return Response.json({ access_token: "test-refreshed-access", expires_in: 3600, scope: `${google.GOOGLE_SCOPES.gmail} ${scope}` });
    };
    connected = await google.googleAccess();
    assert.deepEqual(connected?.enabled.sort(), ["gmail", "google-calendar"]);
    assert.equal(connected?.refreshToken, "test-same-account-refresh");
    assert.equal(google.hasGoogleCalendarExportAccess(connected), true);
  }
});

test("a narrower refreshed grant removes export access while preserving readonly Calendar and Gmail", async () => {
  await session.saveGoogleSession({ ...existingConnection(), expiresAt: Date.now() - 1000, scopes: [google.GOOGLE_SCOPES.gmail, google.GOOGLE_CALENDAR_EXPORT_SCOPE] });
  globalThis.fetch = async () => Response.json({ access_token: "test-readonly-access", expires_in: 3600, scope: `${google.GOOGLE_SCOPES.gmail} ${google.GOOGLE_SCOPES["google-calendar"]}` });
  const refreshed = await google.googleAccess();
  assert.deepEqual(refreshed?.enabled.sort(), ["gmail", "google-calendar"]);
  assert.equal(google.hasGoogleCalendarExportAccess(refreshed), false);
  assert.equal(google.hasGoogleCalendarExportAccess({ ...refreshed!, enabled: [], scopes: [google.GOOGLE_CALENDAR_EXPORT_SCOPE] }), false);
  assert.equal(google.hasGoogleCalendarExportAccess(null), false);
});

test("switching accounts never reuses another account's refresh token", async () => {
  const previous = existingConnection();
  await session.saveGoogleSession(previous);
  const state = await exportState();
  tokenAndProfile([google.GOOGLE_CALENDAR_EXPORT_SCOPE], "different@example.edu");
  const url = redirect(await callbackRoute.GET(request(`/api/auth/google/callback?state=${state}&code=test-code`)));
  assert.equal(url.pathname, "/calendar");
  assert.match(url.searchParams.get("error")!, /offline access/);
  assert.deepEqual(await session.getGoogleSession(), previous);
});

test("unsafe return destinations and invalid state never redirect outside the app", async () => {
  for (const returnTo of ["https://outside.example", "//outside.example", "/calendar?next=outside"]) {
    const url = redirect(await authRoute.GET(request(`/api/auth/google?provider=google-calendar&access=export&returnTo=${encodeURIComponent(returnTo)}`)));
    assert.equal(url.origin + url.pathname, "http://localhost:3000/calendar");
    assert.match(url.searchParams.get("error")!, /valid connection return/);
  }
  const wrong = redirect(await callbackRoute.GET(request("/api/auth/google/callback?state=wrong&code=test-code&returnTo=https://outside.example")));
  assert.equal(wrong.origin + wrong.pathname, "http://localhost:3000/integrations");
  assert.ok(wrong.searchParams.has("error"));
  const gmailState = await session.beginOAuth("gmail");
  const normal = redirect(await callbackRoute.GET(request(`/api/auth/google/callback?state=${gmailState}&error=access_denied&returnTo=calendar`)));
  assert.equal(normal.pathname, "/integrations");
});
