// Calibration. Once predictions resolve, every model has a track record and so
// does the market — which is the only honest way to say whether any of this
// works. Brier score: mean squared error of the probability, lower is better.
// 0.25 is what you get by answering 50 to everything.

import { PANEL } from "../ai/roster.js";
import { getScores, LEADERBOARD_KEY } from "../store/kv.js";

const BINS = [[0, 10], [10, 30], [30, 50], [50, 70], [70, 90], [90, 100]];

export async function computeLeaderboard(env) {
  const rowsLog = await getScores(env);

  const models = PANEL.map((m) => blankModel(m));
  const byKey = Object.fromEntries(models.map((m) => [m.key, m]));
  const consensus = blankModel({ key: "consensus", name: "Panel consensus", lab: "WillHappen", color: "#a78bfa" });
  const market = blankModel({ key: "market", name: "Prediction markets", lab: "Polymarket + Kalshi", color: "#6ee7b7" });

  for (const r of rowsLog) {
    const outcome = r.outcome ? 1 : 0;
    for (const m of PANEL) {
      const prob = r.models?.[m.key];
      if (typeof prob === "number") tally(byKey[m.key], prob, outcome);
    }
    if (typeof r.consensus === "number") tally(consensus, r.consensus, outcome);
    if (typeof r.market === "number") tally(market, r.market, outcome);
  }

  const rows = [...models, consensus, market].map(finish).filter((r) => r.n > 0);
  rows.sort((a, b) => (a.brier ?? 1) - (b.brier ?? 1));

  // How the outcomes themselves were decided is the board's own warrant: a
  // score built on exchange settlements is worth more than one built on a
  // model's reading of the news, and a reader deserves to know the mix.
  const byMethod = rowsLog.reduce((a, r) => {
    const m = r.method === "exchange" || r.method === "jury" ? r.method : "maintainer";
    return { ...a, [m]: (a[m] || 0) + 1 };
  }, {});

  const board = {
    generated_at: new Date().toISOString(),
    resolved: rowsLog.length,
    resolved_by: byMethod,
    // A score means nothing over four questions; the UI greys the board out
    // until there is enough history to rank on.
    min_sample: Number(env.LEADERBOARD_MIN_SAMPLE ?? 10),
    rows,
  };
  await env.WH_KV.put(LEADERBOARD_KEY, JSON.stringify(board));
  return board;
}

export async function getLeaderboard(env) {
  return (await env.WH_KV.get(LEADERBOARD_KEY, "json")) || null;
}

function blankModel(m) {
  return {
    key: m.key, name: m.name, lab: m.lab, color: m.color,
    n: 0, brierSum: 0, hits: 0, probSum: 0, boldSum: 0,
    bins: BINS.map(([lo, hi]) => ({ lo, hi, n: 0, hits: 0, probSum: 0 })),
  };
}

function tally(row, prob, outcome) {
  const p = prob / 100;
  row.n++;
  row.brierSum += (p - outcome) ** 2;
  row.probSum += prob;
  row.boldSum += Math.abs(prob - 50);
  // A 50 is a genuine abstention — count it as half a hit rather than a coin flip.
  if (prob === 50) row.hits += 0.5;
  else if ((prob > 50) === (outcome === 1)) row.hits++;

  const bin = row.bins.find((b) => prob >= b.lo && (prob < b.hi || b.hi === 100));
  if (bin) { bin.n++; bin.hits += outcome; bin.probSum += prob; }
}

function finish(row) {
  const { brierSum, probSum, boldSum, bins, ...rest } = row;
  const n = row.n;
  return {
    ...rest,
    brier: n ? round(brierSum / n, 4) : null,
    // Skill against always answering 50. Positive is better than a coin flip.
    skill: n ? round(1 - (brierSum / n) / 0.25, 3) : null,
    accuracy: n ? round((row.hits / n) * 100, 1) : null,
    avg_prob: n ? round(probSum / n, 1) : null,
    boldness: n ? round(boldSum / n, 1) : null,
    calibration: bins
      .filter((b) => b.n > 0)
      .map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, said: round(b.probSum / b.n, 1), happened: round((b.hits / b.n) * 100, 1) })),
  };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
