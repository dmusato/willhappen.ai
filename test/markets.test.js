import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMarkets as polymarket } from "../src/markets/polymarket.js";
import { fetchMarkets as kalshi } from "../src/markets/kalshi.js";

// Both adapters take their raw rows from fetch(), so the filters are tested by
// stubbing fetch rather than hitting a live exchange from CI.
function withFetch(payload, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  return fn().finally(() => { globalThis.fetch = real; });
}

const soon = new Date(Date.now() + 90 * 86_400_000).toISOString();

const pmRow = (over = {}) => ({
  id: "123456",
  question: "Will the Fed cut rates at the October meeting?",
  slug: "fed-cut-october",
  description: "Resolves yes if the FOMC lowers the target range.",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.62", "0.38"]',
  endDateIso: soon,
  volumeNum: 4_200_000,
  liquidityNum: 250_000,
  oneWeekPriceChange: 0.07,
  events: [{ slug: "fed-decision", tags: [{ label: "Economics" }] }],
  ...over,
});

test("polymarket: parses the string-encoded price arrays", async () => {
  const [m] = await withFetch([pmRow()], () => polymarket({}, {}));
  assert.equal(m.prob, 62, "the Yes price becomes a percentage");
  assert.equal(m.change1w, 7);
  assert.equal(m.url, "https://polymarket.com/event/fed-decision/fed-cut-october");
  assert.equal(m.externalId, "polymarket:123456");
  assert.deepEqual(m.tags, ["economics"]);
});

test("polymarket: drops the markets not worth six model calls", async () => {
  const rows = [
    pmRow({ id: "1", liquidityNum: 10, question: "Thin market" }),
    pmRow({ id: "2", outcomePrices: '["0.995", "0.005"]', question: "Already decided market" }),
    pmRow({ id: "3", endDateIso: new Date(Date.now() + 86_400_000).toISOString(), question: "Resolves tomorrow, too soon" }),
    pmRow({ id: "4", outcomes: '["Trump", "Harris"]', question: "Not a yes or no market" }),
    pmRow({ id: "5" }),
  ];
  const out = await withFetch(rows, () => polymarket({}, {}));
  assert.deepEqual(out.map((m) => m.externalId), ["polymarket:5"]);
});

test("kalshi: reads nested markets and skips sports and template holes", async () => {
  const payload = { events: [
    { category: "Sports", event_ticker: "NFL", series_ticker: "NFL", title: "Game",
      markets: [{ ticker: "NFL-1", title: "Will the Eagles win?", close_time: soon, yes_bid_dollars: "0.5", yes_ask_dollars: "0.52", open_interest_fp: 900000 }] },
    { category: "Economics", event_ticker: "KXFED-26", series_ticker: "KXFED", title: "Fed",
      markets: [
        { ticker: "KXFED-A", title: "Will  be the next Chair?", close_time: soon, yes_bid_dollars: "0.4", yes_ask_dollars: "0.42", open_interest_fp: 900000 },
        { ticker: "KXFED-B", title: "Will the Fed hold rates through December?", close_time: soon, yes_bid_dollars: "0.40", yes_ask_dollars: "0.44", open_interest_fp: 90000, volume_fp: 120000 },
      ] },
  ] };
  const out = await withFetch(payload, () => kalshi({}, {}));
  assert.equal(out.length, 1);
  assert.equal(out[0].externalId, "kalshi:KXFED-B");
  assert.equal(out[0].prob, 42, "mid-price between bid and ask");
  assert.equal(out[0].url, "https://kalshi.com/markets/kxfed");
});

test("kalshi: caps the page size so a wide sweep does not 400 the whole source", async () => {
  const real = globalThis.fetch;
  let asked = null;
  globalThis.fetch = async (url) => {
    asked = new URL(url).searchParams.get("limit");
    return new Response(JSON.stringify({ events: [] }), { headers: { "content-type": "application/json" } });
  };
  try {
    await kalshi({}, { limit: 500 });
    assert.equal(asked, "200");
  } finally {
    globalThis.fetch = real;
  }
});
