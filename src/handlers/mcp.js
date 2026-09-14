// An MCP server over the archive.
//
// The site already answers these questions in HTML and in JSON; this exposes
// them as tools so an assistant can ask directly — "what did the models say
// about a Fed hike", "which lab is actually calibrated" — instead of scraping
// a listing page and hoping.
//
// Streamable HTTP, and stateless on purpose: every tool here is a public read,
// so there is no session to keep, nothing to authenticate, and a Worker that
// holds no connection is a Worker that costs nothing between calls. GET is not
// implemented because the server never needs to speak first.
//
// Tools return Markdown rather than raw JSON. The caller is a language model,
// and the Markdown renderer already writes for that reader — reusing it keeps
// one voice across the site, the .md URLs and the tools.

import { PANEL } from "../ai/roster.js";
import { TOPICS, topic as topicOf } from "../catalog.js";
import { getLeaderboard } from "../pipeline/score.js";
import { getIndex } from "../store/kv.js";
import { loadPrediction, filterRows, SORTS } from "./predictions.js";
import { listMarkdown, predictionMarkdown } from "../render/markdown.js";
import { CORS } from "./http.js";

const PROTOCOL = "2025-06-18";
const SERVER = { name: "willhappen", title: "WillHappen.ai", version: "1.0.0" };

const TOOLS = [
  {
    name: "search_forecasts",
    title: "Search forecasts",
    description:
      "Find published forecasts. Every one is a dated, falsifiable statement answered independently by six " +
      "frontier models; the consensus is the median. Filter by topic, outcome, or free text over headlines.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against headlines." },
        topic: { type: "string", enum: TOPICS.map((t) => t.id), description: "Restrict to one topic." },
        status: { type: "string", enum: ["open", "resolved", "happened", "missed"], description: "Outcome state." },
        sort: {
          type: "string",
          enum: ["new", "soon", "contested", "edge", "confident", "likely", "unlikely"],
          description: "contested = widest disagreement between models; edge = furthest from the market price.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "get_forecast",
    title: "Get one forecast",
    description:
      "One forecast in full: every model's probability and its reasoning, the prediction-market price where " +
      "one exists, the resolution criteria, and the outcome with sources once it has settled.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Forecast id, the last path segment of its URL." } },
      required: ["id"],
    },
  },
  {
    name: "get_scoreboard",
    title: "Get the scoreboard",
    description:
      "How each model has actually scored on settled questions — Brier score, skill against always answering 50, " +
      "accuracy and calibration — alongside the prediction markets judged on the same questions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_topics",
    title: "List topics",
    description: "The subjects the archive is organised by, with how many forecasts each holds.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── tools ───────────────────────────────────────────────────
async function searchForecasts(env, site, args) {
  const { predictions } = await getIndex(env);
  const rows = filterRows(predictions, {
    topic: args.topic || "",
    status: args.status || "",
    search: args.query || "",
    horizon: "", source: "", hasMarket: false,
  }).sort(SORTS[args.sort] || SORTS.new);

  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  if (!rows.length) return "No forecasts match that. The archive only holds what has already been published.";
  return listMarkdown(rows.slice(0, limit), {
    site,
    title: `${rows.length} matching forecast${rows.length === 1 ? "" : "s"}${limit < rows.length ? ` — showing ${limit}` : ""}`,
    intro: "Consensus is the median of six models, each answered independently and none shown the market price.",
  });
}

async function getForecast(env, site, request, args) {
  const id = String(args.id || "").trim();
  if (!id) return { error: "An id is required. search_forecasts returns them." };
  const p = await loadPrediction(env, request, id);
  if (!p) return { error: `No forecast with id "${id}".` };
  return predictionMarkdown(p, site);
}

async function getScoreboard(env) {
  const board = await getLeaderboard(env);
  if (!board || !board.rows?.length) {
    return "Nothing has settled yet, so there is no scoreboard. Scores appear as questions pass their deadlines.";
  }
  const min = board.min_sample ?? 10;
  const lines = [
    `# Scoreboard`,
    "",
    `${board.resolved} settled question${board.resolved === 1 ? "" : "s"}. Lower Brier is better; 0.25 is what answering 50 to everything gets you.`,
    board.resolved < min ? `\n**Below the ${min}-question minimum — treat this as provisional.**` : "",
    "",
    `| Forecaster | n | Brier | Skill | Accuracy | Avg |`,
    `|---|---|---|---|---|---|`,
    ...board.rows.map((r) => `| ${r.name}${r.lab ? ` (${r.lab})` : ""} | ${r.n} | ${r.brier ?? "—"} | ${r.skill ?? "—"} | ${r.accuracy ?? "—"}% | ${r.avg_prob ?? "—"}% |`),
  ];
  const by = board.resolved_by || {};
  lines.push("", `Outcomes decided by: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "—"}.`);
  return lines.filter((l) => l !== "").join("\n");
}

async function listTopics(env, site) {
  const { predictions } = await getIndex(env);
  const counts = predictions.reduce((a, p) => ({ ...a, [p.topic]: (a[p.topic] || 0) + 1 }), {});
  const rows = TOPICS.filter((t) => counts[t.id]).sort((a, b) => counts[b.id] - counts[a.id]);
  if (!rows.length) return "Nothing published yet.";
  return [
    `# Topics`, "",
    `| Topic | Forecasts | Covers | Page |`, `|---|---|---|---|`,
    ...rows.map((t) => `| ${t.name} | ${counts[t.id]} | ${t.hint} | ${site}/topics/${t.id} |`),
  ].join("\n");
}

async function runTool(name, args, { env, site, request }) {
  switch (name) {
    case "search_forecasts": return await searchForecasts(env, site, args);
    case "get_forecast":     return await getForecast(env, site, request, args);
    case "get_scoreboard":   return await getScoreboard(env);
    case "list_topics":      return await listTopics(env, site);
    default: return { error: `Unknown tool "${name}".` };
  }
}

// ── JSON-RPC ────────────────────────────────────────────────
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleMessage(msg, ctx) {
  const { id, method, params } = msg || {};

  if (method === "initialize") {
    // Echo the client's protocol version when we understand it: a client that
    // asked for an older revision is better served by it than by a refusal.
    const asked = String(params?.protocolVersion || "");
    return rpcOk(id, {
      protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions:
        "Forecasts are machine output, not advice: six models answer each dated statement independently and " +
        "the consensus is their median. None of them is shown the prediction-market price, which is what makes " +
        "the published gap between the panel and the money meaningful. Nothing here is reviewed by a human " +
        "before publication, and the scoreboard exists because the models are often wrong.",
    });
  }

  if (method === "ping") return rpcOk(id, {});
  if (method === "tools/list") return rpcOk(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    if (!TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
    try {
      const out = await runTool(name, params?.arguments || {}, ctx);
      const failed = out && typeof out === "object" && out.error;
      return rpcOk(id, {
        content: [{ type: "text", text: failed ? out.error : String(out) }],
        isError: Boolean(failed),
      });
    } catch (err) {
      console.error(`[mcp] ${name}:`, err?.stack || err);
      return rpcOk(id, { content: [{ type: "text", text: `Tool failed: ${String(err?.message || err)}` }], isError: true });
    }
  }

  return rpcErr(id, -32601, `Method not found: ${method}`);
}

export async function handleMcp(request, env, site) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS };

  // The spec's GET opens a stream for server-initiated messages. Nothing here
  // ever speaks first, so saying so is more honest than holding an idle stream.
  if (request.method !== "POST") {
    return new Response(JSON.stringify(rpcErr(null, -32000, "This server is POST-only; it sends no unsolicited messages.")),
      { status: 405, headers: { ...headers, allow: "POST, OPTIONS" } });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), { status: 400, headers }); }

  const ctx = { env, site, request };
  const batch = Array.isArray(body) ? body : [body];

  // A notification carries no id and wants no reply. If every message in the
  // batch is one, the whole exchange is an acknowledgement.
  const replies = [];
  for (const msg of batch) {
    if (msg?.id === undefined || msg?.id === null) continue;
    replies.push(await handleMessage(msg, ctx));
  }
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });

  return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { headers });
}

// Now honest to publish: the server it describes exists and answers.
export function handleMcpCard(site) {
  const card = {
    name: SERVER.name,
    title: SERVER.title,
    version: SERVER.version,
    description:
      "Consensus forecasts from six frontier AI models on dated, falsifiable statements, benchmarked against " +
      "prediction-market prices and graded against cited sources after the deadline.",
    protocolVersion: PROTOCOL,
    transport: { type: "streamable-http", url: `${site}/mcp` },
    capabilities: { tools: { listChanged: false } },
    auth: { type: "none" },
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description })),
    documentation: `${site}/about`,
    source: "https://github.com/dmusato/willhappen.ai",
    panel: PANEL.map((m) => ({ name: m.name, lab: m.lab, model: m.model })),
  };
  return new Response(JSON.stringify(card, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", ...CORS },
  });
}
