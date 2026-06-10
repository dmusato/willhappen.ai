// Model roster — each entry addresses one provider via the Cloudflare AI
// Gateway OpenAI-compatible endpoint. Llama runs on Workers AI through the
// account's AI binding.
//
// Gateway URL pattern:
//   https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/chat/completions
// Request body uses OpenAI shape; `model` is "{provider}/{model_name}".

export const MODELS = [
  { key: "gemini",   provider: "google-ai-studio", model: "gemini-2.5-pro",                 envKey: "GOOGLE_AI_STUDIO_API_KEY" },
  { key: "claude",   provider: "anthropic",        model: "claude-sonnet-4-6",               envKey: "ANTHROPIC_API_KEY" },
  { key: "gpt",      provider: "openai",           model: "gpt-5",                           envKey: "OPENAI_API_KEY" },
  { key: "grok",     provider: "grok",             model: "grok-4",                          envKey: "XAI_API_KEY" },
  { key: "llama",    provider: "workers-ai",       model: "@cf/meta/llama-3.3-70b-instruct", envKey: null },
  { key: "deepseek", provider: "deepseek",         model: "deepseek-chat",                   envKey: "DEEPSEEK_API_KEY" },
];

export const QUESTION_DRAFTER = MODELS.find((m) => m.key === "claude");

export function gatewayUrl(env) {
  const account = env.AI_GATEWAY_ACCOUNT_ID;
  const gateway = env.AI_GATEWAY_ID || "willhappen";
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/chat/completions`;
}

export async function callModel(env, model, messages, { temperature = 0.7, maxTokens = 500, responseJson = false } = {}) {
  // Workers AI goes through the AI binding — no external auth.
  if (model.provider === "workers-ai") {
    const opts = { messages, temperature, max_tokens: maxTokens };
    if (responseJson) opts.response_format = { type: "json_object" };
    const gateway = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
    const out = await env.AI.run(model.model, opts, gateway);
    const content = typeof out === "string" ? out : (out?.response ?? out?.choices?.[0]?.message?.content ?? "");
    return { content };
  }

  const headers = { "content-type": "application/json" };
  if (env.AI_GATEWAY_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  if (model.envKey && env[model.envKey]) headers["authorization"] = `Bearer ${env[model.envKey]}`;

  const body = {
    model: `${model.provider}/${model.model}`,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseJson) body.response_format = { type: "json_object" };

  const res = await fetch(gatewayUrl(env), { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${model.key} (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return { content };
}
