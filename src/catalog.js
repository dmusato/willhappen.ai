// Topics, horizons and news beats. The client fetches topics + horizons from
// /api/catalog, so this file is the single source of truth for all three.

export const TOPICS = [
  { id: "ai",        name: "Artificial Intelligence", icon: "◆", hue: 270, hint: "frontier labs, benchmarks, agents, chips, regulation", seeds: ["artificial intelligence", "AGI", "chatbots"] },
  { id: "geo",       name: "Geopolitics",             icon: "⬢", hue: 10,  hint: "elections, wars, ceasefires, alliances, sanctions", seeds: ["world war 3", "nuclear war", "china taiwan"] },
  { id: "markets",   name: "Markets & Economy",       icon: "▲", hue: 45,  hint: "central banks, rates, inflation, indices, recessions", seeds: ["the stock market", "the recession", "tesla stock", "nvidia stock", "inflation", "interest rates"] },
  { id: "climate",   name: "Climate & Environment",   icon: "◉", hue: 155, hint: "temperature records, disasters, COP policy, emissions", seeds: ["climate change", "global warming", "sea levels"] },
  { id: "space",     name: "Space",                   icon: "✦", hue: 220, hint: "launches, landings, crewed missions, commercial space", seeds: ["humans", "mars", "the moon landing"] },
  { id: "health",    name: "Health & Medicine",       icon: "✚", hue: 340, hint: "approvals, trials, outbreaks, public health policy", seeds: ["a cancer cure", "alzheimers cure", "the next pandemic"] },
  { id: "energy",    name: "Energy",                  icon: "⚡", hue: 60,  hint: "oil, nuclear, solar, grid, fusion", seeds: ["fusion power", "nuclear power", "gas prices"] },
  { id: "crypto",    name: "Crypto & Finance",        icon: "◈", hue: 30,  hint: "bitcoin, ETFs, stablecoins, exchanges, regulation", seeds: ["bitcoin", "ethereum", "crypto", "the bitcoin halving"] },
  { id: "tech",      name: "Consumer Tech",           icon: "▣", hue: 195, hint: "phones, AR/VR, wearables, chips, launches", seeds: ["the iphone", "self driving cars", "vr headsets"] },
  { id: "culture",   name: "Culture & Media",         icon: "♪", hue: 300, hint: "box office, streaming, awards, viral moments", seeds: ["the oscars", "the world cup", "streaming"] },
  { id: "science",   name: "Science",                 icon: "✺", hue: 180, hint: "discoveries, prizes, replication, big experiments", seeds: ["we find aliens", "quantum computers", "the nobel prize"] },
  { id: "biotech",   name: "Biotech",                 icon: "❖", hue: 150, hint: "gene editing, longevity drugs, synthetic biology", seeds: ["gene editing", "lab grown organs", "anti aging drugs"] },
  { id: "robotics",  name: "Robotics",                icon: "◎", hue: 210, hint: "humanoids, warehouses, autonomy, drones", seeds: ["robots", "humanoid robots", "drones"] },
  { id: "transport", name: "Transportation",          icon: "▶", hue: 25,  hint: "EVs, self-driving, aviation, rail", seeds: ["flying cars", "electric cars", "high speed rail"] },
  { id: "labor",     name: "Work & Labor",            icon: "⌂", hue: 280, hint: "layoffs, unions, remote work, automation", seeds: ["ai take jobs", "remote work", "the 4 day week"] },
  { id: "policy",    name: "Policy & Law",            icon: "▢", hue: 15,  hint: "bills, courts, antitrust, AI acts, tax", seeds: ["the supreme court", "the election", "new laws"] },
  { id: "security",  name: "Security & Defense",      icon: "▽", hue: 0,   hint: "cyber, drones, nuclear, defense budgets", seeds: ["cyber attacks", "the draft", "drone warfare"] },
  { id: "sports",    name: "Sports",                  icon: "◐", hue: 125, hint: "titles, records, transfers, tournaments", seeds: ["the world cup", "the olympics", "the super bowl"] },
  { id: "gaming",    name: "Gaming",                  icon: "◇", hue: 240, hint: "releases, platforms, esports, engines", seeds: ["gta 6", "the next playstation", "esports"] },
  { id: "demo",      name: "Demographics",            icon: "☰", hue: 310, hint: "birth rates, migration, population, aging", seeds: ["the population", "birth rates", "immigration"] },
  { id: "housing",   name: "Housing",                 icon: "⌘", hue: 35,  hint: "prices, mortgages, construction, rent", seeds: ["house prices", "mortgage rates", "the housing market", "rent"] },
  { id: "food",      name: "Food & Agriculture",      icon: "◓", hue: 85,  hint: "harvests, prices, lab meat, famine", seeds: ["lab grown meat", "food prices", "a famine"] },
  { id: "privacy",   name: "Privacy",                 icon: "○", hue: 200, hint: "surveillance, data law, encryption, breaches", seeds: ["facial recognition", "data privacy", "encryption"] },
  { id: "nature",    name: "Nature & Oceans",         icon: "≋", hue: 190, hint: "ice, species, conservation, reefs", seeds: ["the amazon", "coral reefs", "animals go extinct"] },
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
