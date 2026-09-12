// The panel: six frontier models from six different labs, all reached through
// OpenRouter. Adding a lab is one entry here — nothing else in the codebase
// hardcodes a model key, and the client reads this list from /api/roster.
//
// `color` is the brand dot shown across the UI and in OG cards. Keep the six
// hues far apart; they are the only way a reader tells the models apart.

export const PANEL = [
  { key: "gemini",   name: "Gemini",   lab: "Google",    model: "google/gemini-3.8-flash",     color: "#4285f4", ink: "#fff" },
  { key: "claude",   name: "Claude",   lab: "Anthropic", model: "anthropic/claude-sonnet-5",   color: "#d97757", ink: "#fff" },
  { key: "gpt",      name: "GPT",      lab: "OpenAI",    model: "openai/gpt-5.6-terra",        color: "#10a37f", ink: "#fff" },
  { key: "grok",     name: "Grok",     lab: "xAI",       model: "x-ai/grok-4.6",               color: "#e8eaf0", ink: "#05061a" },
  { key: "deepseek", name: "DeepSeek", lab: "DeepSeek",  model: "deepseek/deepseek-v4.1-flash", color: "#6366f1", ink: "#fff" },
  { key: "qwen",     name: "Qwen",     lab: "Alibaba",   model: "qwen/qwen3.8-max-0902",       color: "#f59e0b", ink: "#05061a" },
];

export const PANEL_KEYS = PANEL.map((m) => m.key);
export const byKey = (key) => PANEL.find((m) => m.key === key) || null;

// Jobs outside the panel. Search-grounded models gather evidence; a cheap
// structured model turns evidence into schema-clean JSON.
export const JOBS = {
  // Reads the live web. Free-form out — we never ask a search model for JSON.
  search: { model: "perplexity/sonar", fallbacks: ["perplexity/sonar-pro"] },
  // Turns a briefing into candidate questions / a verdict. Strict schema.
  reason: { model: "google/gemini-3.8-flash", fallbacks: ["openai/gpt-5.6-luna", "deepseek/deepseek-v4.1-flash"] },
};

// Public shape for the client — never leaks the provider slugs' fallbacks.
export function rosterForClient() {
  return PANEL.map(({ key, name, lab, model, color, ink }) => ({ key, name, lab, model, color, ink }));
}
