import { test } from "node:test";
import assert from "node:assert/strict";
import { clampInt, fingerprint, median, normalizeQuestion, pool, slugify } from "../src/util.js";

test("slugify makes url-safe ids", () => {
  assert.equal(slugify("The Fed cuts rates — October 2026!"), "the-fed-cuts-rates-october-2026");
  assert.equal(slugify("Курс изменится"), "prediction", "non-latin collapses to a usable fallback");
  assert.ok(slugify("a".repeat(200)).length <= 70);
  assert.ok(!slugify("trailing punctuation ...").endsWith("-"));
});

test("fingerprint ignores phrasing noise so restated questions collide", () => {
  assert.equal(
    fingerprint("Will the Fed cut rates in 2026?"),
    fingerprint("The Fed cuts rates by 2027"),
    "filler words, years and punctuation are stripped before hashing",
  );
  assert.notEqual(fingerprint("The Fed cuts rates"), fingerprint("The Fed raises rates"));
  assert.match(fingerprint("anything"), /^[a-z0-9]{8}$/);
});

test("normalizeQuestion strips dates, filler and plurals", () => {
  assert.equal(normalizeQuestion("Will the Fed cut rates by 2026?"), "fed cut rate");
  assert.equal(normalizeQuestion("Companies raise prices"), "company raise price");
  // Word order is load-bearing: these are opposite claims, not one question.
  assert.notEqual(normalizeQuestion("Brazil beats Argentina"), normalizeQuestion("Argentina beats Brazil"));
});

test("median handles both parities", () => {
  assert.equal(median([10, 20, 30]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});

test("clampInt bounds and falls back", () => {
  assert.equal(clampInt("140", 0, 100, 50), 100);
  assert.equal(clampInt(-5, 0, 100, 50), 0);
  assert.equal(clampInt("not a number", 0, 100, 50), 50);
  assert.equal(clampInt(undefined, 0, 100, null), null);
});

test("pool keeps order and respects the concurrency ceiling", async () => {
  let live = 0, peak = 0;
  const out = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});
