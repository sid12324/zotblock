import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createRequire } from "node:module";

type CookieOptions = { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };
const cookieValues = new Map<string, { value: string; options: CookieOptions }>();
const cookieJar = {
  get(name: string) { const cookie = cookieValues.get(name); return cookie ? { name, value: cookie.value } : undefined; },
  set(name: string, value: string, options: CookieOptions) { cookieValues.set(name, { value, options }); },
  delete(name: string) { cookieValues.delete(name); },
};

// Mock the request-bound cookie adapter. Encryption and OAuth code run unchanged.
const requireForTest = createRequire(import.meta.url);
const headersPath = requireForTest.resolve("next/headers");
const originalHeaders = requireForTest.cache[headersPath];
requireForTest.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => cookieJar } } as NodeModule;

let session: typeof import("../src/lib/session");
let canvas: typeof import("../src/lib/integrations/canvas");
let google: typeof import("../src/lib/integrations/google");
let http: typeof import("../src/lib/integrations/http");
let integrationsRoute: typeof import("../src/app/api/integrations/route");
let sources: typeof import("../src/lib/integrations/sources");
const envNames = ["SESSION_SECRET", "APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CANVAS_CLIENT_ID", "CANVAS_CLIENT_SECRET", "CANVAS_BASE_URL", "CANVAS_ACCESS_TOKEN"] as const;
const originalEnvironment = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

before(async () => {
  [session, canvas, google, http, integrationsRoute, sources] = await Promise.all([
    import("../src/lib/session"), import("../src/lib/integrations/canvas"),
    import("../src/lib/integrations/google"), import("../src/lib/integrations/http"),
    import("../src/app/api/integrations/route"),
    import("../src/lib/integrations/sources"),
  ]);
});

beforeEach(() => {
  cookieValues.clear();
  process.env.SESSION_SECRET = "test-session-secret-longer-than-thirty-two-characters";
  process.env.APP_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "google-test-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-test-secret";
  process.env.CANVAS_CLIENT_ID = "canvas-test-client";
  process.env.CANVAS_CLIENT_SECRET = "canvas-test-secret";
  delete process.env.CANVAS_BASE_URL;
  delete process.env.CANVAS_ACCESS_TOKEN;
  globalThis.fetch = async () => { throw new Error("Unexpected network request in session test"); };
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

test("OAuth state survives encryption once and rejects replay", async () => {
  const state = await session.beginOAuth("canvas", "https://school.instructure.com");
  const stored = cookieValues.get("zoa_oauth")!;
  assert.equal(stored.value.split(".").length, 5);
  assert.ok(!stored.value.includes(state));
  assert.equal(stored.options.httpOnly, true);
  assert.equal(stored.options.sameSite, "lax");
  assert.equal(stored.options.maxAge, 600);
  assert.deepEqual(await session.consumeOAuth(state), { state, provider: "canvas", origin: "https://school.instructure.com" });
  await assert.rejects(session.consumeOAuth(state), /expired/);
});

test("mismatched OAuth state is rejected and consumed", async () => {
  const valid = await session.beginOAuth("gmail");
  await assert.rejects(session.consumeOAuth("wrong-state"), /expired/);
  await assert.rejects(session.consumeOAuth(valid), /expired/);
});

test("tokens stay encrypted in secure HttpOnly cookies and key rotation invalidates them", async () => {
  process.env.APP_URL = "https://study.example";
  const connection = { accessToken: "private-access-token", refreshToken: "private-refresh-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES.gmail], enabled: ["gmail" as const] };
  await session.saveGoogleSession(connection);
  assert.deepEqual(await session.getGoogleSession(), connection);
  const stored = cookieValues.get("zoa_google")!;
  assert.equal(stored.options.secure, true);
  assert.equal(stored.options.httpOnly, true);
  assert.equal(stored.options.sameSite, "lax");
  assert.ok(!stored.value.includes(connection.accessToken));
  assert.ok(!stored.value.includes(connection.refreshToken));
  process.env.SESSION_SECRET = "a-different-long-encryption-secret-for-rotation";
  assert.equal(await session.getGoogleSession(), null);
});

test("missing encryption configuration disables connectors", async () => {
  delete process.env.SESSION_SECRET;
  assert.equal(google.googleConfigured(), false);
  assert.equal(canvas.canvasConfigured(), false);
  assert.equal(await session.getGoogleSession(), null);
  await assert.rejects(session.beginOAuth("gmail"), /SESSION_SECRET/);
});

test("authorization URLs carry exact callbacks, state and readonly scopes", () => {
  const gmail = google.googleAuthorizationUrl("gmail", "google-state");
  assert.equal(gmail.origin, "https://accounts.google.com");
  assert.equal(gmail.searchParams.get("state"), "google-state");
  assert.equal(gmail.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
  assert.equal(gmail.searchParams.get("access_type"), "offline");
  assert.equal(gmail.searchParams.get("include_granted_scopes"), "true");
  assert.match(gmail.searchParams.get("scope")!, /gmail\.readonly/);
  const calendar = google.googleAuthorizationUrl("google-calendar", "calendar-state");
  assert.match(calendar.searchParams.get("scope")!, /calendar\.events\.readonly/);
  assert.ok(!calendar.href.includes("google-test-secret"));
  const school = canvas.canvasAuthorizationUrl("https://school.instructure.com", "canvas-state");
  assert.equal(school.origin, "https://school.instructure.com");
  assert.equal(school.pathname, "/login/oauth2/auth");
  assert.equal(school.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/canvas/callback");
  assert.equal(school.searchParams.get("state"), "canvas-state");
  assert.ok(school.searchParams.get("scope")!.includes("url:GET|/api/v1/users/:user_id/profile"));
  assert.ok(!school.href.includes("canvas-test-secret"));
});

test("Google incremental authorization preserves the same account's refresh token", async () => {
  await session.saveGoogleSession({ accessToken: "old-access", refreshToken: "google-renewable-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES.gmail], enabled: ["gmail"] });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://oauth2.googleapis.com/token") {
      const parameters = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(parameters.get("grant_type"), "authorization_code");
      return Response.json({ access_token: "new-google-access", expires_in: 3600, scope: `${google.GOOGLE_SCOPES.gmail} ${google.GOOGLE_SCOPES["google-calendar"]}` });
    }
    assert.equal(String(input), "https://www.googleapis.com/oauth2/v2/userinfo");
    return Response.json({ email: "student@example.edu", verified_email: true });
  };
  await google.completeGoogleOAuth("test-code", "google-calendar");
  const connected = await session.getGoogleSession();
  assert.equal(connected?.refreshToken, "google-renewable-token");
  assert.deepEqual(connected?.enabled.sort(), ["gmail", "google-calendar"]);
});

test("Google refresh keeps a previously issued refresh token", async () => {
  await session.saveGoogleSession({ accessToken: "expired-token", refreshToken: "renewable-token", expiresAt: Date.now() - 1000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES.gmail], enabled: ["gmail"] });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    const parameters = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(parameters.get("refresh_token"), "renewable-token");
    return Response.json({ access_token: "new-google-access", expires_in: 3600 });
  };
  const refreshed = await google.googleAccess();
  assert.equal(refreshed?.accessToken, "new-google-access");
  assert.equal(refreshed?.refreshToken, "renewable-token");
  assert.equal((await session.getGoogleSession())?.refreshToken, "renewable-token");
});

test("Calendar health checks API access without requesting event contents", async () => {
  const connection = { accessToken: "calendar-access", refreshToken: "renewable-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES["google-calendar"]], enabled: ["google-calendar" as const] };
  await session.saveGoogleSession(connection);
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
    assert.equal(url.searchParams.get("fields"), "kind");
    assert.equal(url.searchParams.get("maxResults"), "1");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer calendar-access");
    return Response.json({ kind: "calendar#events" });
  };
  const response = await integrationsRoute.GET();
  const data = await response.json();
  const calendar = data.integrations.find((item: { id: string }) => item.id === "google-calendar");
  assert.equal(calendar.connected, true);
  assert.equal(calendar.issue, undefined);
  assert.equal(requests, 1);
  assert.ok(!JSON.stringify(data).includes("calendar-access"));
});

test("Calendar API configuration errors appear as setup issues while keeping the account linked", async () => {
  const connection = { accessToken: "calendar-access", refreshToken: "renewable-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES["google-calendar"]], enabled: ["google-calendar" as const] };
  await session.saveGoogleSession(connection);
  globalThis.fetch = async () => Response.json({ error: { code: 403, message: "sensitive-upstream-body", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { consumer: "projects/123456789", service: "calendar-json.googleapis.com" } }] } }, { status: 403 });
  const response = await integrationsRoute.GET();
  const data = await response.json();
  const calendar = data.integrations.find((item: { id: string }) => item.id === "google-calendar");
  assert.equal(response.status, 200);
  assert.equal(calendar.connected, true);
  assert.equal(calendar.issue.code, "API_DISABLED");
  assert.match(calendar.issue.actionUrl, /calendar-json\.googleapis\.com/);
  assert.ok(!JSON.stringify(data).includes("sensitive-upstream-body"));
  assert.ok(!JSON.stringify(data).includes("calendar-access"));
  assert.deepEqual(await session.getGoogleSession(), connection);
});

test("Calendar health refreshes expired access before checking availability", async () => {
  await session.saveGoogleSession({ accessToken: "expired-access", refreshToken: "renewable-token", expiresAt: Date.now() - 1000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES["google-calendar"]], enabled: ["google-calendar"] });
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (String(input) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fresh-calendar-access", expires_in: 3600 });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fresh-calendar-access");
    return Response.json({ kind: "calendar#events" });
  };
  const data = await (await integrationsRoute.GET()).json();
  const calendar = data.integrations.find((item: { id: string }) => item.id === "google-calendar");
  assert.equal(calendar.connected, true);
  assert.equal(calendar.issue, undefined);
  assert.equal(calls.length, 2);
  assert.equal((await session.getGoogleSession())?.accessToken, "fresh-calendar-access");
});

test("incomplete Gmail coverage keeps usable mail and Canvas sources with an explicit warning", async () => {
  await session.saveGoogleSession({ accessToken: "google-access", refreshToken: "renewable-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [google.GOOGLE_SCOPES.gmail, google.GOOGLE_SCOPES["google-calendar"]], enabled: ["gmail", "google-calendar"] });
  await session.saveCanvasSession({ accessToken: "canvas-access", expiresAt: Date.now() + 3600_000, account: "Student", origin: "https://school.instructure.com" });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/gmail/v1/users/me/messages") return Response.json({ messages: [{ id: "large" }, { id: "usable" }] });
    if (url.pathname.startsWith("/gmail/v1/users/me/messages/")) return Response.json({ id: url.pathname.endsWith("large") ? "large" : "usable", internalDate: String(Date.parse("2026-10-17T18:00:00Z")), payload: { mimeType: "text/plain", headers: [{ name: "subject", value: "Upcoming quiz" }], body: { data: Buffer.from(url.pathname.endsWith("large") ? "x".repeat(121_000) : "Quiz due October 20 at noon.").toString("base64url") } } });
    if (url.pathname === "/api/v1/planner/items") return Response.json([{ plannable_id: 5, plannable_type: "assignment", context_name: "Biology", plannable_date: "2026-10-20T22:00:00Z", plannable: { title: "Lab report" } }]);
    if (url.pathname === "/calendar/v3/calendars/primary/events") return Response.json({ items: [] });
    throw new Error("Unexpected collection request");
  };
  const collected = await sources.collectSources({ timeZone: "America/Los_Angeles", days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 }, { start: "2026-10-17T18:00:00Z", end: "2026-10-24T07:00:00Z" });
  assert.deepEqual(collected.emails.map(email => email.id), ["usable"]);
  assert.equal(collected.assignments.length, 1);
  assert.ok(collected.collectionWarnings?.length);
  assert.ok(!JSON.stringify(collected).includes("google-access"));
  assert.ok(!JSON.stringify(collected).includes("canvas-access"));
});

test("Canvas refresh reuses the refresh token when the provider omits it", async () => {
  await session.saveCanvasSession({ accessToken: "expired-token", refreshToken: "canvas-renewable-token", expiresAt: Date.now() - 1000, account: "Student", origin: "https://school.instructure.com" });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://school.instructure.com/login/oauth2/token");
    const parameters = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(parameters.get("grant_type"), "refresh_token");
    assert.equal(parameters.get("refresh_token"), "canvas-renewable-token");
    return Response.json({ access_token: "new-canvas-access", expires_in: 3600 });
  };
  const refreshed = await canvas.canvasAccess();
  assert.equal(refreshed?.accessToken, "new-canvas-access");
  assert.equal(refreshed?.refreshToken, "canvas-renewable-token");
});

test("personal Canvas configuration works without institution OAuth keys", async () => {
  delete process.env.CANVAS_CLIENT_ID;
  delete process.env.CANVAS_CLIENT_SECRET;
  process.env.CANVAS_ACCESS_TOKEN = "personal-test-token";
  process.env.CANVAS_BASE_URL = "https://uci.instructure.com";
  assert.equal(canvas.canvasTokenConfigured(), true);
  assert.equal(canvas.canvasOAuthConfigured(), false);
  assert.equal(canvas.canvasConfigured(), true);
  assert.throws(() => canvas.canvasAuthorizationUrl("https://uci.instructure.com", "test-state"), /OAuth/);
  await assert.rejects(canvas.completeCanvasOAuth("test-code", "https://uci.instructure.com"), /OAuth/);
  delete process.env.CANVAS_BASE_URL;
  assert.equal(canvas.canvasTokenConfigured(), false);
  assert.equal(canvas.canvasConfigured(), false);
  process.env.CANVAS_BASE_URL = "http://uci.instructure.com";
  assert.equal(canvas.canvasTokenConfigured(), false);
});

test("personal Canvas verifies the configured account and stores an encrypted finite session", async () => {
  delete process.env.CANVAS_CLIENT_ID;
  delete process.env.CANVAS_CLIENT_SECRET;
  process.env.CANVAS_ACCESS_TOKEN = "personal-test-token";
  process.env.CANVAS_BASE_URL = "https://uci.instructure.com";
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(String(input), "https://uci.instructure.com/api/v1/users/self/profile");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer personal-test-token");
    return Response.json({ name: "Test Student", login_id: "student@uci.edu" });
  };
  await canvas.connectCanvasToken();
  const connected = await session.getCanvasSession();
  assert.equal(connected?.authType, "personal-token");
  assert.equal(connected?.account, "Test Student");
  assert.equal(connected?.origin, "https://uci.instructure.com");
  assert.equal(connected?.refreshToken, undefined);
  assert.ok(Number.isFinite(connected?.expiresAt));
  assert.ok(connected!.expiresAt > Date.now());
  assert.ok(!cookieValues.get("zoa_canvas")!.value.includes("personal-test-token"));
  assert.equal(cookieValues.get("zoa_canvas")!.options.httpOnly, true);
  assert.deepEqual(await canvas.canvasAccess(), connected);
  assert.equal(requests, 1);
});

test("personal Canvas rejects removed or rotated tokens before making requests", async () => {
  process.env.CANVAS_BASE_URL = "https://uci.instructure.com";
  await session.saveCanvasSession({ accessToken: "personal-test-token", authType: "personal-token", expiresAt: Date.now() + 3600_000, account: "Test Student", origin: "https://uci.instructure.com" });
  for (const replacement of [undefined, "rotated-test-token"]) {
    if (replacement === undefined) delete process.env.CANVAS_ACCESS_TOKEN;
    else process.env.CANVAS_ACCESS_TOKEN = replacement;
    await assert.rejects(canvas.canvasAccess(), error => {
      assert.ok(error instanceof http.IntegrationError);
      assert.equal(error.status, 401);
      assert.match(error.message, /Reconnect Canvas/);
      assert.ok(!error.message.includes("personal-test-token"));
      assert.ok(!error.message.includes("rotated-test-token"));
      return true;
    });
  }
});

test("expired personal Canvas sessions never attempt OAuth refresh", async () => {
  process.env.CANVAS_ACCESS_TOKEN = "personal-test-token";
  process.env.CANVAS_BASE_URL = "https://uci.instructure.com";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Personal tokens must never use OAuth refresh"); };
  await session.saveCanvasSession({ accessToken: "personal-test-token", refreshToken: "unused-oauth-token", authType: "personal-token", expiresAt: Date.now() - 1000, account: "Test Student", origin: "https://uci.instructure.com" });
  await assert.rejects(canvas.canvasAccess(), error => {
    assert.ok(error instanceof http.IntegrationError);
    assert.equal(error.status, 401);
    assert.match(error.message, /expired/);
    return true;
  });
  assert.equal(requests, 0);
});

test("personal Canvas refuses a changed configured school", async () => {
  process.env.CANVAS_ACCESS_TOKEN = "personal-test-token";
  process.env.CANVAS_BASE_URL = "https://other.instructure.com";
  await session.saveCanvasSession({ accessToken: "personal-test-token", authType: "personal-token", expiresAt: Date.now() + 3600_000, account: "Test Student", origin: "https://uci.instructure.com" });
  await assert.rejects(canvas.canvasAccess(), error => {
    assert.ok(error instanceof http.IntegrationError);
    assert.equal(error.status, 401);
    assert.match(error.message, /school changed/);
    return true;
  });
});

test("provider errors discard upstream secrets and refuse redirects", async () => {
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return new Response("sensitive-access-token upstream details", { status: 401 });
  };
  await assert.rejects(http.providerJson("https://provider.example", {}, "Example"), error => {
    assert.ok(error instanceof http.IntegrationError);
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes("sensitive-access-token"));
    return true;
  });
});
