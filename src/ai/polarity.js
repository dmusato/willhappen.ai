// Does our headline mean the same thing as the market question it came from?
//
// The headline is rewritten by a model, and a rewrite that reads better can
// quietly mean the opposite: "Will OpenAI not IPO by December 2026?" at 94%
// became "OpenAI completes an IPO by December 2026", so a page that should have
// read "the models and the money agree it is unlikely" published a 90-point
// disagreement instead. The market price belongs to the source question, so
// once the two drift apart every number derived from it is wrong.
//
// Used twice: at harvest, before a wrong price is ever published, and again
// before a settlement is applied, where the same drift would invert an outcome.

import { chat } from "./openrouter.js";
import { JOBS } from "./roster.js";

const SCHEMA = {
  name: "polarity",
  shape: {
    type: "object",
    additionalProperties: false,
    required: ["relation", "why"],
    properties: {
      relation: { type: "string", enum: ["same", "opposite", "unrelated"] },
      why: { type: "string" },
    },
  },
};

const SYSTEM = `Decide how a statement relates to answering YES on a market question.
"same" — the statement is true exactly when the market resolves YES.
"opposite" — the statement is true exactly when the market resolves NO.
"unrelated" — they are about different things, or differ in a date, threshold or party.`;

// Returns { relation, why }. A failure answers "unrelated", which is the
// cautious reading: every caller treats it as a reason not to trust the pairing.
export async function checkPolarity(env, headline, marketQuestion) {
  if (!marketQuestion) return { relation: "same", why: "no market question stored" };
  try {
    const r = await chat(env, {
      model: JOBS.reason.model,
      fallbacks: JOBS.reason.fallbacks,
      temperature: 0,
      maxTokens: 200,
      schema: SCHEMA,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Statement: ${headline}\nMarket question: ${marketQuestion}` },
      ],
    });
    return { ...(r.json || { relation: "unrelated", why: "no answer" }), cost: r.cost };
  } catch (err) {
    console.warn("[polarity] check failed:", err?.message || err);
    return { relation: "unrelated", why: String(err?.message || err).slice(0, 80), cost: 0 };
  }
}
