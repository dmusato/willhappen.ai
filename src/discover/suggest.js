// What people are actually asking.
//
// Markets tell us what money is betting on and the news tells us what just
// happened, but neither says what a person types into a search box at midnight.
// Google's autocomplete endpoint does, it is public, and it needs no key —
// which is the same deal Polymarket and Kalshi give us.
//
// The demand signal is the whole point: "when will humans land on the moon
// again" is a question hundreds of thousands of people ask and no exchange
// lists. Those are the pages worth having.

const ENDPOINT = "https://suggestqueries.google.com/complete/search";

// Anchored on a subject every time. An unanchored stem like "will there be a"
// comes back as nothing but television — Toy Story 6, season 4 of Euphoria —
// because that is genuinely what most people ask it about.
const STEMS = ["when will", "will there be", "how soon will"];

// Entertainment schedules, personal questions and shopping. Each is a perfectly
// good search and none of them is a forecastable claim about the world.
const REJECT = /\b(season \d|episode|series \d|movie|film|sequel|trailer|netflix|cast|actor|release date of|my |i |near me|cost|price of|worth it|how to|recipe)\b/i;

// Timetable lookups. "When will the stock market open today" has an answer and
// it lives in a calendar, not a forecast. Anything pinned to today or tomorrow
// is that kind of question: a page is worth building for a claim that stays
// open long enough to be worth reading twice.
const LOOKUP = /\b(today|tonight|tomorrow|this (week|weekend)|right now)\b/i;

async function suggestFor(query) {
  const url = `${ENDPOINT}?client=firefox&hl=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  // The endpoint answers [query, [suggestions], ...] and labels it as
  // javascript rather than JSON, so it is parsed rather than res.json()'d.
  const parsed = JSON.parse(await res.text());
  return Array.isArray(parsed?.[1]) ? parsed[1].map(String) : [];
}

// Returns the raw questions people search for on one subject, cleaned of the
// ones that could never resolve. One subrequest per stem.
export async function discoverQuestions(env, seeds, { perStem = 10 } = {}) {
  const out = new Set();
  for (const seed of seeds) {
    for (const stem of STEMS) {
      try {
        const hits = await suggestFor(`${stem} ${seed}`);
        for (const hit of hits.slice(0, perStem)) {
          const q = hit.trim();
          if (q.length < 14 || q.length > 120) continue;
          if (REJECT.test(q) || LOOKUP.test(q)) continue;
          out.add(q);
        }
      } catch (err) {
        console.warn(`[suggest] "${stem} ${seed}":`, err?.message || err);
      }
    }
  }
  return [...out];
}
