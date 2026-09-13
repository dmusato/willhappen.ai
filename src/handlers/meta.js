// Small read-only endpoints the client needs before it can render anything:
// the topic/horizon catalog, the model roster, and the calibration board.

import { HORIZONS, TOPICS } from "../catalog.js";
import { rosterForClient } from "../ai/roster.js";
import { getLeaderboard } from "../pipeline/score.js";
import { json } from "./http.js";

const DAY = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export function handleCatalog() {
  return json(
    { topics: TOPICS.map(({ id, name, icon, hue }) => ({ id, name, icon, hue })), horizons: HORIZONS, models: rosterForClient() },
    200,
    { "cache-control": DAY },
  );
}

export async function handleLeaderboard(request, env) {
  const board = await getLeaderboard(env);
  if (!board) return json({ generated_at: null, resolved: 0, min_sample: 10, rows: [] }, 200, { "cache-control": "public, max-age=300" });
  return json(board, 200, { "cache-control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=86400" });
}
