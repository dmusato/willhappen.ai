// Single gateway to every model: OpenRouter.
//
// One key (OPENROUTER_API_KEY), one request shape, any lab. Every call is
// metered — OpenRouter returns the real dollar cost in `usage.cost`, which we
// hand back so the caller can write it to the daily ledger. Nothing here talks
// to KV; budgeting lives in store/ledger.js.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class ModelError extends Error {
  constructor(message, { status = 0, model = "" } = {}) {
    super(message);
    this.name = "ModelError";
    this.status = status;
    this.model = model;
  }
}

// Reasoning models bill hidden thinking tokens as output. We ask for short
// numeric judgements, so thinking is pure cost — off wherever it's supported.
const NO_REASONING = { enabled: false };

export async function chat(env, {
  model,
  messages,
  temperature = 0.7,
  maxTokens = 400,
  schema = null,
  fallbacks = [],
  webSearch = 0,
  timeoutMs = 45_000,
}) {
  if (env.MOCK_LLM === "1" || env.MOCK_LLM === "true") {
    return mock(model, messages, schema);
  }
  if (!env.OPENROUTER_API_KEY) {
    throw new ModelError("OPENROUTER_API_KEY is not set", { model });
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    reasoning: NO_REASONING,
    usage: { include: true },
  };
  if (fallbacks.length) body.models = [model, ...fallbacks];
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: schema.name, strict: true, schema: schema.shape },
    };
  }
  if (webSearch > 0) {
    body.plugins = [{ id: "web", max_results: webSearch }];
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": env.SITE_URL || "https://willhappen.ai",
        "x-title": "WillHappen.ai",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ModelError(err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message || err), { model });
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  if (!res.ok) throw new ModelError(`${res.status} ${raw.slice(0, 240)}`, { status: res.status, model });

  let data;
  try { data = JSON.parse(raw); } catch { throw new ModelError(`unparseable body: ${raw.slice(0, 160)}`, { model }); }
  // OpenRouter reports upstream failures with HTTP 200 and an error object.
  if (data.error) throw new ModelError(String(data.error.message || data.error).slice(0, 240), { status: data.error.code || 0, model });

  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (!content) throw new ModelError(`empty completion (finish: ${choice?.finish_reason || "?"})`, { model });

  return {
    content,
    json: schema ? parseJson(content) : null,
    citations: citationsOf(data),
    model: data.model || model,
    cost: Number(data.usage?.cost) || 0,
    tokens: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0),
  };
}

// Same call, but a failed parse is an error rather than a null field.
export async function chatJson(env, opts) {
  const r = await chat(env, opts);
  if (!r.json) throw new ModelError(`no JSON in reply: ${r.content.slice(0, 160)}`, { model: opts.model });
  return { ...r, ...{ data: r.json } };
}

// Providers disagree on where they put sources: Perplexity uses a top-level
// `citations`, the web plugin uses OpenAI-style url_citation annotations.
function citationsOf(data) {
  const out = [];
  const seen = new Set();
  const push = (url, title) => {
    if (!url || seen.has(url) || !/^https?:\/\//.test(url)) return;
    seen.add(url);
    out.push({ url, title: String(title || hostOf(url)).slice(0, 160) });
  };

  for (const c of data.citations || []) {
    if (typeof c === "string") push(c);
    else push(c?.url, c?.title);
  }
  for (const a of data.choices?.[0]?.message?.annotations || []) {
    if (a?.type === "url_citation") push(a.url_citation?.url, a.url_citation?.title);
  }
  return out.slice(0, 8);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Models wrap JSON in prose or fences often enough to be worth handling.
export function parseJson(s) {
  const text = String(s || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(text); } catch {}
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

// ── mock mode ────────────────────────────────────────────────
// MOCK_LLM=1 runs the entire pipeline offline with deterministic answers, so
// `npm run dev` exercises harvest → forecast → resolve without a key.
function mock(model, messages, schema) {
  const user = messages.find((m) => m.role === "user")?.content || "";
  const seed = [...`${model}:${user}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = (n) => seed % n;

  let content;
  if (!schema) {
    content = `Mock completion for ${model}.`;
  } else if (schema.name === "harvest") {
    // Mirrors the real schema exactly, including "ref" and "keep" — a mock that
    // skips fields the filter checks would make the whole run silently no-op.
    const items = String(messages.at(-1)?.content || "").split(/\n(?=\d+\. )/).length;
    content = JSON.stringify({
      questions: Array.from({ length: Math.min(items, 8) }, (_, i) => ({
        ref: i,
        keep: true,
        headline: `Mock statement ${i + 1} resolves before its stated deadline`,
        topic: ["ai", "markets", "geo", "climate"][(seed + i) % 4],
        horizon: ["1m", "6m", "1y", "3y"][(seed + i) % 4],
        context: "Synthetic context generated in mock mode.",
      })),
    });
  } else if (schema.name === "forecast") {
    content = JSON.stringify({ prob: 8 + (pick(84)), note: `Mock rationale from ${model.split("/").pop()}.` });
  } else if (schema.name === "verdict") {
    const status = ["happened", "not_happened", "unclear"][pick(3)];
    content = JSON.stringify({
      status,
      basis: status === "happened" ? "direct_evidence" : status === "not_happened" ? "contradicting_evidence" : "insufficient",
      confidence: 55 + pick(45),
      summary: "Mock resolution summary.",
      sources: [
        { title: "Mock source A", url: "https://example.com/mock-a" },
        { title: "Mock source B", url: "https://example.com/mock-b" },
      ],
    });
  } else if (schema.name === "polarity") {
    content = JSON.stringify({ relation: "same", why: "mock mode assumes the headline kept the market's polarity" });
  } else {
    content = "{}";
  }

  return { content, json: parseJson(content), citations: [], model, cost: 0, tokens: 0 };
}
