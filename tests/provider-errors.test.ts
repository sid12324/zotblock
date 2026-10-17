import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { IntegrationError, providerFetch } from "../src/lib/integrations/http";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const warnings: unknown[][] = [];
const calendarUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

beforeEach(() => {
  warnings.length = 0;
  console.warn = (...values: unknown[]) => { warnings.push(values); };
  globalThis.fetch = async () => { throw new Error("Unexpected network request in provider error test"); };
});

after(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; });

async function captureError(status: number, payload: unknown, url = calendarUrl, provider = "Google Calendar") {
  globalThis.fetch = async () => Response.json(payload, { status });
  try { await providerFetch(url, {}, provider); }
  catch (error) { assert.ok(error instanceof IntegrationError); return error; }
  assert.fail("Expected a provider error");
}

test("disabled Calendar API gets a fixed enable link and numeric project hint", async () => {
  const error = await captureError(403, { error: { message: "secret-access-token", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { consumer: "projects/123456789", service: "calendar-json.googleapis.com", activationUrl: "https://attacker.test/?token=secret-access-token" } }] } });
  assert.equal(error.code, "API_DISABLED");
  assert.equal(error.status, 503);
  assert.equal(error.actionUrl, "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=123456789");
  assert.match(error.message, /Enable the API/);
  assert.ok(!error.message.includes("secret-access-token"));
  assert.deepEqual(warnings, [[{ provider: "Google Calendar", code: "API_DISABLED", status: 403 }]]);
});

test("legacy Gmail API disabled reasons omit untrusted project and activation URLs", async () => {
  const error = await captureError(403, { error: { errors: [{ reason: "accessNotConfigured", message: "private-token" }], details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { consumer: "projects/123?token=private-token", activationUrl: "https://attacker.test" } }] } }, "https://gmail.googleapis.com/gmail/v1/users/me/profile", "Gmail");
  assert.equal(error.code, "API_DISABLED");
  assert.equal(error.actionUrl, "https://console.cloud.google.com/apis/library/gmail.googleapis.com");
  assert.ok(!JSON.stringify(warnings).includes("private-token"));
});

test("both legacy and canonical missing scope reasons ask for read permission", async () => {
  for (const payload of [
    { error: { errors: [{ reason: "insufficientPermissions" }] } },
    { error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
  ]) {
    const error = await captureError(403, payload);
    assert.equal(error.status, 403);
    assert.equal(error.code, "INSUFFICIENT_SCOPE");
    assert.match(error.message, /Reconnect/);
    assert.equal(error.actionUrl, undefined);
  }
});

test("Calendar 403 quota failures stay separate from authentication", async () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"]) {
    const error = await captureError(403, { error: { errors: [{ reason }] } });
    assert.equal(error.status, 429);
    assert.equal(error.code, "RATE_LIMITED");
  }
  const error = await captureError(429, { error: { message: "private upstream text" } });
  assert.equal(error.code, "RATE_LIMITED");
  assert.ok(!error.message.includes("private upstream text"));
});

test("invalid credentials and unknown forbidden responses have different actions", async () => {
  const invalid = await captureError(401, { error: { errors: [{ reason: "authError" }] } });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.code, "AUTH_REQUIRED");
  const forbidden = await captureError(403, { error: { message: "secret-auth-detail", errors: [{ reason: "organizationRestriction" }] } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, "FORBIDDEN");
  assert.doesNotMatch(forbidden.message, /expir|Reconnect|secret-auth-detail/);
});

test("OAuth revoked grants differ from invalid client credentials", async () => {
  const revoked = await captureError(400, { error: "invalid_grant", error_description: "private-refresh-token" }, "https://oauth2.googleapis.com/token", "Google");
  assert.equal(revoked.status, 401);
  assert.equal(revoked.code, "AUTH_REQUIRED");
  const badClient = await captureError(401, { error: "invalid_client", error_description: "private-client-secret" }, "https://oauth2.googleapis.com/token", "Google");
  assert.equal(badClient.status, 503);
  assert.equal(badClient.code, "OAUTH_CONFIG");
  assert.doesNotMatch(badClient.message, /private-client-secret/);
  assert.ok(!JSON.stringify(warnings).includes("private-"));
});

test("Google payload parsing requires a trusted HTTPS endpoint and known provider", async () => {
  const payload = { error: { errors: [{ reason: "accessNotConfigured" }] } };
  for (const [url, provider] of [["https://www.googleapis.com.attacker.test/calendar/v3/events", "Google Calendar"], ["http://www.googleapis.com/calendar/v3/events", "Google Calendar"], [calendarUrl, "Canvas"]]) {
    const error = await captureError(403, payload, url, provider);
    assert.notEqual(error.code, "API_DISABLED");
    assert.equal(error.actionUrl, undefined);
  }
});

test("oversized and malformed error bodies produce a safe generic forbidden response", async () => {
  const large = await captureError(403, { error: { errors: [{ reason: "accessNotConfigured" }], message: "secret".repeat(5000) } });
  assert.equal(large.code, "FORBIDDEN");
  globalThis.fetch = async () => new Response("<html>private-token</html>", { status: 403 });
  await assert.rejects(providerFetch(calendarUrl, {}, "Google Calendar"), error => {
    assert.ok(error instanceof IntegrationError);
    assert.equal(error.code, "FORBIDDEN");
    assert.ok(!error.message.includes("private-token"));
    return true;
  });
});
