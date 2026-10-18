import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { DEFAULT_SITES, clock, hostIsBlocked, normalizeSite, timerFromStorage } = createRequire(import.meta.url)("../extension/logic.js");

test("site names accept hosts and ignore paths, ports, and www", () => {
  assert.equal(normalizeSite("https://www.YouTube.com/watch?v=1"), "youtube.com");
  assert.equal(normalizeSite("reddit.com:443/r/all"), "reddit.com");
  assert.equal(normalizeSite("localhost"), null);
  assert.equal(normalizeSite("not a site"), null);
  assert.equal(normalizeSite(""), null);
});

test("only listed hosts and their subdomains are covered", () => {
  assert.equal(hostIsBlocked("www.youtube.com", DEFAULT_SITES), true);
  assert.equal(hostIsBlocked("m.youtube.com", DEFAULT_SITES), true);
  assert.equal(hostIsBlocked("youtube.com.evil.com", DEFAULT_SITES), false);
  assert.equal(hostIsBlocked("youtu.be", DEFAULT_SITES), true);
  assert.equal(hostIsBlocked("www.instagram.com", DEFAULT_SITES), false);
  assert.equal(hostIsBlocked("canvas.eee.uci.edu", DEFAULT_SITES), false);
  assert.equal(hostIsBlocked("localhost", DEFAULT_SITES), false);
  assert.equal(hostIsBlocked("example.com", ["https://www.example.com/home"]), true);
});

test("a running ZotBlock timer is active until its saved end time", () => {
  const now = 1_700_000_000_000;
  const stored = JSON.stringify({ session: { status: "running", endsAt: now + 60_000, target: { title: "  Problem set  " } } });
  assert.deepEqual(timerFromStorage(stored, now), { active: true, endsAt: now + 60_000, title: "Problem set" });
  assert.equal(timerFromStorage(stored, now + 60_000).active, false);
  assert.equal(timerFromStorage(JSON.stringify({ session: { status: "paused", endsAt: null, target: { title: "Problem set" } } }), now).active, false);
  assert.equal(timerFromStorage("{", now).active, false);
  assert.equal(clock(61_000), "1:01");
});
