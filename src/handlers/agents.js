// Machine-readable descriptions of what is here.
//
// Only things that exist are described. It is tempting, faced with a checklist,
// to publish an OAuth discovery document and an agent card and a skills index
// so the scanner turns green — but a manifest pointing at a capability we do
// not have is the same failure as a fabricated forecast, just aimed at software
// instead of a reader.

import { llmsTxt } from "../render/markdown.js";
import { getIndex } from "../store/kv.js";

const text = (body, type, maxAge = 3600) =>
  new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": `public, max-age=${maxAge}`,
      "x-content-type-options": "nosniff",
    },
  });

export async function handleLlmsTxt(env, site) {
  const { predictions } = await getIndex(env);
  const resolved = predictions.filter((p) => p.verdict === true || p.verdict === false).length;
  return text(llmsTxt({ site, total: predictions.length, resolved }), "text/plain");
}

// RFC 9727. A linkset pointing at the JSON endpoints that already exist — the
// same ones the site's own pages are built from.
export function handleApiCatalog(site) {
  const linkset = {
    linkset: [{
      anchor: `${site}/`,
      "service-desc": [
        { href: `${site}/api/predictions`, type: "application/json",
          title: "Forecast listing — filter by topic, horizon, source, outcome" },
        { href: `${site}/api/leaderboard`, type: "application/json",
          title: "Model scoreboard — Brier, skill, accuracy, calibration bins" },
        { href: `${site}/api/catalog`, type: "application/json",
          title: "Topics and horizons this archive is organised by" },
      ],
      "service-doc": [{ href: `${site}/about`, type: "text/html", title: "How the forecasts are produced and graded" }],
      describedby: [{ href: `${site}/llms.txt`, type: "text/plain", title: "Summary for language models" }],
      license: [{ href: "https://opensource.org/licenses/MIT", title: "MIT" }],
    }],
  };
  return new Response(JSON.stringify(linkset, null, 2), {
    headers: { "content-type": "application/linkset+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

// ARD capability manifest, to the published schema rather than a shape of our
// own: specVersion and entries are required, identifiers are urn:air:, and each
// entry names an IANA media type. Written against the spec because a manifest
// an agent cannot parse is worth no more than no manifest at all.
export function handleArd(site) {
  const doc = {
    specVersion: "1.0",
    host: {
      displayName: "WillHappen.ai",
      documentationUrl: `${site}/about`,
    },
    entries: [
      {
        identifier: "urn:air:willhappen.ai:forecasts:mcp",
        displayName: "WillHappen forecast archive (MCP)",
        description:
          "Search and read published forecasts: every model's probability and reasoning, the prediction-market " +
          "price where one exists, and the scoreboard of who has actually been right.",
        type: "application/mcp-server-card+json",
        url: `${site}/.well-known/mcp/server-card.json`,
        tags: ["forecasting", "prediction-markets", "ai-evaluation", "calibration"],
        representativeQueries: [
          "What do the models think about a Fed rate hike this year?",
          "Which lab is best calibrated on settled questions?",
          "Show the forecasts where the panel disagrees most with the market.",
        ],
      },
      {
        identifier: "urn:air:willhappen.ai:forecasts:json",
        displayName: "Forecast listing API",
        description:
          "Published forecasts as JSON. Filter by topic, horizon, source and outcome; one full record at " +
          "/api/predictions/{id}. No authentication — everything here is public and read-only.",
        type: "application/json",
        url: `${site}/api/predictions`,
        tags: ["forecasting", "open-data"],
      },
      {
        identifier: "urn:air:willhappen.ai:scoreboard:json",
        displayName: "Model scoreboard API",
        description:
          "Brier score, skill against always answering 50, accuracy and calibration bins for each model, " +
          "alongside prediction markets judged on the same questions.",
        type: "application/json",
        url: `${site}/api/leaderboard`,
        tags: ["ai-evaluation", "calibration", "benchmark"],
      },
      {
        identifier: "urn:air:willhappen.ai:site:llms-txt",
        displayName: "Site summary for language models",
        description: "What this archive is, how to read it, and where the machine-readable versions live.",
        type: "text/plain",
        url: `${site}/llms.txt`,
        tags: ["documentation"],
      },
    ],
  };
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
