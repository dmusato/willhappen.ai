// Single gateway to every model: OpenRouter.
//
// One key (OPENROUTER_API_KEY), one request shape, any lab. Every call is
// metered — OpenRouter returns the real dollar cost in `usage.cost`, which we
// hand back so the caller can write it to the daily ledger. Nothing here talks
// to KV; budgeting lives in store/ledger.js.

const DIRECT = "https://openrouter.ai/api/v1/chat/completions";

// Optionally route the same calls through Cloudflare AI Gateway, which sits in
// front of OpenRouter and adds caching, spend limits, per-model analytics and
// a kill switch — none of which OpenRouter gives us on its own. Set the full
// endpoint rather than assembling it: Cloudflare's own docs disagree with
// themselves about whether the path carries a /v1, and the dashboard prints
// the correct one for your gateway.
//
//   AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openrouter/v1/chat/completions"
//   AI_GATEWAY_TOKEN = only if the gateway is set to authenticated
const endpointFor = (env) => env.AI_GATEWAY_URL || DIRECT;

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

// Three of the six labs reject that outright, and the retry below costs a whole
// extra subrequest each time. A cron invocation gets roughly fifty for the
// entire cycle, so paying twice per panel member is the difference between two
// forecasts in a run and four. Which models refuse is a property of the model,
// not of the request, so remembering it within the isolate is safe and the
// worst case after a cold start is one wasted call per model.
const mustThink = new Set();
const reasoningFor = (model) => (mustThink.has(model) ? { effort: "low" } : NO_REASONING);
const thinkingBudget = (maxTokens) => Math.max(maxTokens * 4, 4000);

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

  // Thinking is billed against max_tokens, so a model we already know will
  // think needs the wider ceiling from the start — asking for effort: low on a
  // budget sized for a bare answer is how the JSON came back truncated before.
  const thinking = reasoningFor(model);
  const ceiling = thinking.enabled === false ? maxTokens : thinkingBudget(maxTokens);

  const body = {
    model,
    messages,
    temperature,
    max_tokens: ceiling,
    reasoning: thinking,
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

  const send = async (payload) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(endpointFor(env), {
        method: "POST",
        signal: ctl.signal,
        headers: {
          authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "http-referer": env.SITE_URL || "https://willhappen.ai",
          "x-title": "WillHappen.ai",
          ...(env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      return { res, raw: await res.text() };
    } catch (err) {
      throw new ModelError(err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message || err), { model });
    } finally {
      clearTimeout(timer);
    }
  };

  let { res, raw } = await send(body);

  // Some reasoning models refuse to have thinking switched off and reject the
  // whole request rather than ignoring the field, which took out the curator
  // call and with it every harvest. Paying for hidden thinking tokens on those
  // models is the lesser cost, so drop the field and ask once more.
  //
  // The ceiling has to rise with it. Every max_tokens here was chosen for an
  // answer with no thinking in front of it, and thinking is billed against the
  // same budget: the first attempt at this came back HTTP 200 with the JSON
  // truncated 15 tokens under the limit, so the harvest silently curated
  // nothing at all. A dead call is easier to see than a half-finished one.
  //
  // Any 400 on a request that carried the field is treated as that refusal.
  // Matching the wording instead looked tidier and quietly cost us two of the
  // six labs: Gemini says "reasoning is mandatory", Grok and Qwen phrase it
  // differently, so they never retried and simply failed — 34 of Qwen's 37
  // calls, which is a panel of five wearing a badge that says six. The retry
  // costs one wasted call on a request that was already failing.
  // Ask for the shortest thinking the provider offers rather than dropping the
  // constraint altogether. Letting it run unbounded is what made Grok take
  // between 22 and 67 seconds to answer "give me a number from 0 to 100" —
  // past the forecast timeout often enough that the gateway logged a success
  // the panel never received. If a provider will not take an effort level
  // either, fall back to no field at all.
  if (res.status === 400 && body.reasoning?.enabled === false) {
    mustThink.add(model);
    const budget = thinkingBudget(maxTokens);
    ({ res, raw } = await send({ ...body, reasoning: { effort: "low" }, max_tokens: budget }));

    if (res.status === 400) {
      const { reasoning, ...withThinking } = body;
      withThinking.max_tokens = budget;
      ({ res, raw } = await send(withThinking));
    }
  }

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
function parseJson(s) {
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
    content = JSON.stringify({
      prob: 8 + (pick(84)),
      take: `Mock take from ${model.split("/").pop()}: this turns on one thing.`,
      because: [`Mock point one from ${model.split("/").pop()}.`, "Mock point two."],
    });
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
