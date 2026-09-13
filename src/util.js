// Small shared helpers. Kept deliberately tiny — if something here grows a
// second responsibility it belongs in its own module.

export function slugify(s, max = 70) {
  const base = String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "prediction";
}

// Stable 8-char hash. Used both for question dedupe and for id suffixes, so it
// has to be deterministic across Worker isolates — no crypto.randomUUID here.
export function fingerprint(s) {
  const str = normalizeQuestion(s);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).padStart(8, "0").slice(0, 8);
}

// Two harvests of the same story should collide. A market asks "Will the Fed
// cut rates?"; the curated headline says "The Fed cuts rates at its October
// meeting". Same question, so strip punctuation, years, filler words and the
// singular/plural difference before hashing. Word order is kept — "A beats B"
// and "B beats A" are not the same claim.
const FILLER = /\b(will|the|a|an|be|is|are|was|were|by|in|on|at|of|to|for|its|before|after|until|any|this|that|there|it)\b/g;

export function normalizeQuestion(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(19|20|21)\d{2}\b/g, " ")
    .replace(FILLER, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

// Not a real stemmer, and it doesn't need to be: it only has to make "cut" and
// "cuts" hash the same. Anything cleverer (buses/bus, raises/raise) starts
// breaking pairs it was meant to join.
function singular(w) {
  if (w.length < 4) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function clampInt(v, lo, hi, fallback = null) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86_400_000);

// Runs tasks with a ceiling on concurrency — six models at once is fine, sixty
// subrequests at once trips Cloudflare's limits.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
