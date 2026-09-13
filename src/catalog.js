// Topics, horizons and news beats. The client fetches topics + horizons from
// /api/catalog, so this file is the single source of truth for all three.

export const TOPICS = [
  { id: "ai",        name: "Artificial Intelligence", icon: "◆", hue: 270, hint: "frontier labs, benchmarks, agents, chips, regulation" },
  { id: "geo",       name: "Geopolitics",             icon: "⬢", hue: 10,  hint: "elections, wars, ceasefires, alliances, sanctions" },
  { id: "markets",   name: "Markets & Economy",       icon: "▲", hue: 45,  hint: "central banks, rates, inflation, indices, recessions" },
  { id: "climate",   name: "Climate & Environment",   icon: "◉", hue: 155, hint: "temperature records, disasters, COP policy, emissions" },
  { id: "space",     name: "Space",                   icon: "✦", hue: 220, hint: "launches, landings, crewed missions, commercial space" },
  { id: "health",    name: "Health & Medicine",       icon: "✚", hue: 340, hint: "approvals, trials, outbreaks, public health policy" },
  { id: "energy",    name: "Energy",                  icon: "⚡", hue: 60,  hint: "oil, nuclear, solar, grid, fusion" },
  { id: "crypto",    name: "Crypto & Finance",        icon: "◈", hue: 30,  hint: "bitcoin, ETFs, stablecoins, exchanges, regulation" },
  { id: "tech",      name: "Consumer Tech",           icon: "▣", hue: 195, hint: "phones, AR/VR, wearables, chips, launches" },
  { id: "culture",   name: "Culture & Media",         icon: "♪", hue: 300, hint: "box office, streaming, awards, viral moments" },
  { id: "science",   name: "Science",                 icon: "✺", hue: 180, hint: "discoveries, prizes, replication, big experiments" },
  { id: "biotech",   name: "Biotech",                 icon: "❖", hue: 150, hint: "gene editing, longevity drugs, synthetic biology" },
  { id: "robotics",  name: "Robotics",                icon: "◎", hue: 210, hint: "humanoids, warehouses, autonomy, drones" },
  { id: "transport", name: "Transportation",          icon: "▶", hue: 25,  hint: "EVs, self-driving, aviation, rail" },
  { id: "labor",     name: "Work & Labor",            icon: "⌂", hue: 280, hint: "layoffs, unions, remote work, automation" },
  { id: "policy",    name: "Policy & Law",            icon: "▢", hue: 15,  hint: "bills, courts, antitrust, AI acts, tax" },
  { id: "security",  name: "Security & Defense",      icon: "▽", hue: 0,   hint: "cyber, drones, nuclear, defense budgets" },
  { id: "sports",    name: "Sports",                  icon: "◐", hue: 125, hint: "titles, records, transfers, tournaments" },
  { id: "gaming",    name: "Gaming",                  icon: "◇", hue: 240, hint: "releases, platforms, esports, engines" },
  { id: "demo",      name: "Demographics",            icon: "☰", hue: 310, hint: "birth rates, migration, population, aging" },
  { id: "housing",   name: "Housing",                 icon: "⌘", hue: 35,  hint: "prices, mortgages, construction, rent" },
  { id: "food",      name: "Food & Agriculture",      icon: "◓", hue: 85,  hint: "harvests, prices, lab meat, famine" },
  { id: "privacy",   name: "Privacy",                 icon: "○", hue: 200, hint: "surveillance, data law, encryption, breaches" },
  { id: "nature",    name: "Nature & Oceans",         icon: "≋", hue: 190, hint: "ice, species, conservation, reefs" },
];

export const HORIZONS = [
  { id: "1w",   label: "1 week",    short: "1W",   days: 7 },
  { id: "1m",   label: "1 month",   short: "1M",   days: 30 },
  { id: "3m",   label: "3 months",  short: "3M",   days: 90 },
  { id: "6m",   label: "6 months",  short: "6M",   days: 180 },
  { id: "1y",   label: "1 year",    short: "1Y",   days: 365 },
  { id: "3y",   label: "3 years",   short: "3Y",   days: 1095 },
  { id: "5y",   label: "5 years",   short: "5Y",   days: 1825 },
  { id: "10y",  label: "10 years",  short: "10Y",  days: 3650 },
  { id: "50y",  label: "50 years",  short: "50Y",  days: 18250 },
];

// News beats the harvester sweeps. Each run takes the next beat in rotation,
// so the archive stays spread across the agenda instead of piling into AI.
export const BEATS = [
  { id: "world",    query: "major world news and geopolitics", topics: ["geo", "security", "policy"] },
  { id: "economy",  query: "economy, central banks, markets and inflation", topics: ["markets", "crypto", "housing", "labor"] },
  { id: "ai",       query: "artificial intelligence industry and regulation", topics: ["ai", "robotics", "privacy"] },
  { id: "science",  query: "science, space and medicine", topics: ["science", "space", "health", "biotech"] },
  { id: "climate",  query: "climate, energy and environment", topics: ["climate", "energy", "nature", "food"] },
  { id: "culture",  query: "culture, sports, gaming and consumer technology", topics: ["culture", "sports", "gaming", "tech", "transport", "demo"] },
];

export const topic = (id) => TOPICS.find((t) => t.id === id) || null;
export const horizon = (id) => HORIZONS.find((h) => h.id === id) || null;
export const TOPIC_IDS = TOPICS.map((t) => t.id);
export const HORIZON_IDS = HORIZONS.map((h) => h.id);

export function resolvesBy(horizonId, from = new Date()) {
  const h = horizon(horizonId) || horizon("1y");
  return new Date(from.getTime() + h.days * 86_400_000).toISOString().slice(0, 10);
}
