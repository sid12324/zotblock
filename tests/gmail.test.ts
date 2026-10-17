import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readAcademicEmails } from "../src/lib/integrations/google";
import { IntegrationError } from "../src/lib/integrations/http";
import type { GoogleSession } from "../src/lib/session";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalNow = Date.now;
const session: GoogleSession = { accessToken: "test-access-token", expiresAt: Date.now() + 3600_000, account: "student@example.edu", scopes: [], enabled: ["gmail"] };
const mail = (id: string, body = `Homework ${id} is due Friday at 11:59 PM`) => ({ id, internalDate: "1792220400000", payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: `Assignment ${id}` }, { name: "From", value: "teacher@example.edu" }], body: { data: Buffer.from(body).toString("base64url") } } });

beforeEach(() => {
  Date.now = originalNow;
  console.warn = () => {};
  globalThis.fetch = async () => { throw new Error("Unexpected network request in Gmail test"); };
});
after(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; Date.now = originalNow; });

test("Gmail reads a second page beyond 100 messages with at most eight body requests in flight", async () => {
  const pages: (string | null)[] = [];
  let active = 0;
  let mostActive = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-access-token");
    if (url.pathname.endsWith("/messages")) {
      pages.push(url.searchParams.get("pageToken"));
      assert.equal(url.searchParams.get("maxResults"), "100");
      assert.equal(url.searchParams.get("q"), 'newer_than:14d -category:promotions -category:social {assignment homework coursework syllabus midterm exam quiz deadline "due date"}');
      return Response.json(url.searchParams.get("pageToken") ? { messages: [{ id: "100" }, { id: "101" }] } : { messages: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), nextPageToken: "page-2" });
    }
    active++;
    mostActive = Math.max(mostActive, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    assert.equal(url.searchParams.get("format"), "full");
    return Response.json(mail(url.pathname.split("/").at(-1)!));
  };
  const result = await readAcademicEmails(session);
  assert.equal(result.emails.length, 102);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(pages, [null, "page-2"]);
  assert.equal(mostActive, 8);
  assert.equal(result.emails.at(-1)?.body, "Homework 101 is due Friday at 11:59 PM");
});

test("Gmail de-duplicates IDs across result pages", async () => {
  const requested: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json(url.searchParams.get("pageToken") ? { messages: [{ id: "one" }, { id: "two" }] } : { messages: [{ id: "one" }, { id: "one" }], nextPageToken: "page-2" });
    const id = url.pathname.split("/").at(-1)!;
    requested.push(id);
    return Response.json(mail(id));
  };
  const result = await readAcademicEmails(session);
  assert.deepEqual(requested, ["one", "two"]);
  assert.deepEqual(result.emails.map(email => email.id), ["one", "two"]);
  assert.deepEqual(result.warnings, []);
});

test("the 500-email cap returns collected messages with an honest coverage warning", async () => {
  let listRequests = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      const page = listRequests++;
      return Response.json({ messages: Array.from({ length: 100 }, (_, index) => ({ id: `${page * 100 + index}` })), nextPageToken: `page-${page + 1}` });
    }
    return Response.json(mail(url.pathname.split("/").at(-1)!));
  };
  const result = await readAcademicEmails(session);
  assert.equal(result.emails.length, 500);
  assert.equal(listRequests, 5);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /500.*coverage may be incomplete/);
  assert.doesNotMatch(result.warnings[0], /\d+ (?:additional|omitted)/);
});

test("repeated Gmail page tokens stop pagination without losing collected messages", async () => {
  let listRequests = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: String(listRequests++) }], nextPageToken: "repeated-token" });
    return Response.json(mail(url.pathname.split("/").at(-1)!));
  };
  const result = await readAcademicEmails(session);
  assert.equal(result.emails.length, 2);
  assert.equal(listRequests, 2);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /pagination repeated/);
});

test("Gmail stops before the serialized text budget and keeps included bodies intact", async () => {
  const body = "Read the complete assignment. ".repeat(3200);
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: Array.from({ length: 20 }, (_, id) => ({ id: String(id) })) });
    return Response.json(mail(url.pathname.split("/").at(-1)!, body));
  };
  const result = await readAcademicEmails(session);
  assert.ok(result.emails.length > 0 && result.emails.length < 20);
  assert.ok(JSON.stringify(result.emails).length <= 750_000);
  assert.ok(result.emails.every(email => email.body === body));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /reading limit.*coverage is incomplete/);
});

test("oversized and unreadable messages are skipped with one count warning", async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "large" }, { id: "empty" }, { id: "good" }] });
    const id = url.pathname.split("/").at(-1)!;
    return Response.json(mail(id, id === "large" ? "x".repeat(120_001) : id === "empty" ? "" : "Quiz due Friday at noon"));
  };
  const result = await readAcademicEmails(session);
  assert.deepEqual(result.emails.map(email => email.id), ["good"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Skipped 2 Gmail emails/);
  assert.doesNotMatch(result.warnings[0], /archive|disconnect/i);
});

test("Gmail authentication failures still reject instead of becoming skip warnings", async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "one" }] });
    return Response.json({ error: { errors: [{ reason: "authError" }] } }, { status: 401 });
  };
  await assert.rejects(readAcademicEmails(session), error => {
    assert.ok(error instanceof IntegrationError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "AUTH_REQUIRED");
    return true;
  });
});

test("the collection deadline returns completed email groups with a coverage warning", async () => {
  let now = 0;
  let bodyRequests = 0;
  Date.now = () => now;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: Array.from({ length: 16 }, (_, id) => ({ id: String(id) })) });
    bodyRequests++;
    now += 6000;
    return Response.json(mail(url.pathname.split("/").at(-1)!));
  };
  const result = await readAcademicEmails(session);
  assert.equal(result.emails.length, 8);
  assert.equal(bodyRequests, 8);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /included 8 emails.*collection time limit.*coverage is incomplete/);
});

test("the collection deadline stops sequential inline text requests inside a MIME message", async () => {
  let now = 0;
  let attachmentRequests = 0;
  Date.now = () => now;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: Array.from({ length: 9 }, (_, id) => ({ id: String(id) })) });
    if (url.pathname.includes("/attachments/")) {
      attachmentRequests++;
      now = 46_000;
      return Response.json({ data: Buffer.from("Homework due Friday").toString("base64url") });
    }
    const id = url.pathname.split("/").at(-1)!;
    if (id !== "8") return Response.json(mail(id));
    return Response.json({ id, internalDate: "1792220400000", payload: { mimeType: "multipart/mixed", parts: Array.from({ length: 3 }, (_, part) => ({ mimeType: "text/plain", body: { attachmentId: `inline-${part}`, size: 100 } })) } });
  };
  const result = await readAcademicEmails(session);
  assert.equal(attachmentRequests, 1);
  assert.equal(result.emails.length, 8);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /included 8 emails.*collection time limit/);
});
