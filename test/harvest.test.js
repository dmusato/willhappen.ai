import { test } from "node:test";
import assert from "node:assert/strict";
import { statedDeadline } from "../src/pipeline/harvest.js";

test("statedDeadline: a future date is taken as the deadline", () => {
  assert.deepEqual(statedDeadline("2026-10-29", "2026-10-25"), { date: "2026-10-29", past: false });
});

// A briefing about the past week is full of outcomes. Turning one into a
// question asks the panel something already settled.
test("statedDeadline: today or earlier means the outcome is already known", () => {
  assert.equal(statedDeadline("2026-09-16", "2026-09-18").past, true);
  assert.equal(statedDeadline("2026-10-25", "2026-10-25").past, true);
});

test("statedDeadline: no date falls back to the horizon", () => {
  for (const v of ["", null, undefined, "October 2026", "2026-13-45"]) {
    assert.deepEqual(statedDeadline(v, "2026-10-25"), { date: null, past: false }, String(v));
  }
});
