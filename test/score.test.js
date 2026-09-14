import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeaderboard } from "../src/pipeline/score.js";

// Minimal KV stand-in: the scorer only reads scores:log and writes leaderboard.
function fakeEnv(rows) {
  const store = new Map([["scores:log", JSON.stringify(rows)]]);
  return {
    LEADERBOARD_MIN_SAMPLE: "2",
    WH_KV: {
      get: async (k, type) => (store.has(k) ? (type === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => void store.set(k, v),
    },
  };
}

const row = (id, outcome, probs, market = null) => ({
  id, at: `2026-0${id}-01T00:00:00Z`, outcome, consensus: Math.round((probs.claude + probs.gpt) / 2),
  market, models: probs,
});

test("a confident correct model beats a hedging one on Brier", async () => {
  const env = fakeEnv([
    row("1", 1, { claude: 90, gpt: 50 }),
    row("2", 1, { claude: 85, gpt: 50 }),
    row("3", 0, { claude: 10, gpt: 50 }),
  ]);
  const board = await computeLeaderboard(env);
  const claude = board.rows.find((r) => r.key === "claude");
  const gpt = board.rows.find((r) => r.key === "gpt");

  assert.equal(claude.n, 3);
  assert.ok(claude.brier < gpt.brier, `${claude.brier} should beat ${gpt.brier}`);
  // Always answering 50 scores exactly 0.25 — the definition of no skill.
  assert.equal(gpt.brier, 0.25);
  assert.equal(gpt.skill, 0);
  assert.equal(board.rows[0].key, "claude", "board is sorted best-first");
});

test("a 50 counts as half a hit rather than a coin flip", async () => {
  const board = await computeLeaderboard(fakeEnv([row("1", 1, { gpt: 50 }), row("2", 0, { gpt: 50 })]));
  assert.equal(board.rows.find((r) => r.key === "gpt").accuracy, 50);
});

test("the market is scored on the same questions", async () => {
  const board = await computeLeaderboard(fakeEnv([
    row("1", 1, { claude: 60, gpt: 60 }, 95),
    row("2", 1, { claude: 60, gpt: 60 }, 90),
  ]));
  const market = board.rows.find((r) => r.key === "market");
  const consensus = board.rows.find((r) => r.key === "consensus");
  assert.equal(market.n, 2);
  assert.ok(market.brier < consensus.brier, "the market called both correctly and more confidently");
});

test("models that never answered stay off the board", async () => {
  const board = await computeLeaderboard(fakeEnv([row("1", 1, { claude: 70 })]));
  assert.equal(board.rows.find((r) => r.key === "qwen"), undefined);
});

test("an empty log produces an empty board, not a crash", async () => {
  const board = await computeLeaderboard(fakeEnv([]));
  assert.deepEqual(board.rows, []);
  assert.equal(board.resolved, 0);
});
