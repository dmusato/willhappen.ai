// The canonical-origin redirect. Getting this wrong in either direction is
// expensive: too eager and `npm run dev` redirects itself off localhost, too
// shy and the archive is crawled four times over.

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalHost, canonicalRedirect } from "../src/worker.js";

const ENV = { SITE_URL: "https://willhappen.ai" };

const call = (href, env = ENV) => canonicalRedirect(new URL(href), env);

const locationOf = (res) => {
  assert.ok(res, "expected a redirect");
  assert.equal(res.status, 301);
  return res.headers.get("location");
};

test("the canonical origin is served, not redirected", () => {
  assert.equal(call("https://willhappen.ai/"), null);
  assert.equal(call("https://willhappen.ai/timeline?topic=ai"), null);
});

test("http on the canonical host goes to https", () => {
  assert.equal(locationOf(call("http://willhappen.ai/p/abc-1234")), "https://willhappen.ai/p/abc-1234");
});

test("www goes to the apex, on either scheme", () => {
  assert.equal(locationOf(call("https://www.willhappen.ai/models")), "https://willhappen.ai/models");
  assert.equal(locationOf(call("http://www.willhappen.ai/models")), "https://willhappen.ai/models");
});

test("the query string survives the redirect", () => {
  assert.equal(
    locationOf(call("https://www.willhappen.ai/timeline?topic=ai&sort=edge")),
    "https://willhappen.ai/timeline?topic=ai&sort=edge",
  );
});

// Following any redirect this returns must land somewhere that returns none,
// or the site takes itself down with a loop.
test("every redirect target is itself final", () => {
  for (const href of [
    "http://willhappen.ai/p/abc-1234",
    "https://www.willhappen.ai/timeline?sort=edge",
    "http://www.willhappen.ai/",
  ]) {
    const next = locationOf(call(href));
    assert.notEqual(next, href, `${href} redirected to itself`);
    assert.equal(call(next), null, `${next} redirects again`);
  }
});

test("hosts that are not the site are left alone", () => {
  assert.equal(call("http://localhost:8787/timeline"), null);
  assert.equal(call("http://127.0.0.1:8787/"), null);
  assert.equal(call("https://willhappen-ai.someone.workers.dev/"), null);
  assert.equal(call("https://willhappen.ai.evil.test/"), null);
});

test("a missing or unusable SITE_URL disables the redirect", () => {
  assert.equal(call("http://willhappen.ai/", {}), null);
  assert.equal(call("http://willhappen.ai/", { SITE_URL: "not a url" }), null);
});

// SITE_URL on http would send every http request to itself, forever.
test("an http SITE_URL cannot build a loop", () => {
  assert.equal(call("http://willhappen.ai/", { SITE_URL: "http://willhappen.ai" }), null);
});

test("canonicalHost names the one host, or nothing usable", () => {
  assert.equal(canonicalHost({ SITE_URL: "https://willhappen.ai" }), "willhappen.ai");
  assert.equal(canonicalHost({ SITE_URL: "https://WillHappen.AI/timeline" }), "willhappen.ai");
  assert.equal(canonicalHost({}), "");
  assert.equal(canonicalHost({ SITE_URL: "not a url" }), "");
  // http would send http traffic back to itself.
  assert.equal(canonicalHost({ SITE_URL: "http://willhappen.ai" }), "");
});
