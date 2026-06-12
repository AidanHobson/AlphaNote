// Crowd odds on macro/market events from Polymarket (Gamma API, keyless) — the
// prediction-market complement to the Reddit attention board: where real money,
// not just upvotes, prices the speculative questions.

import { fetchJSON, parseEventMarkets, toNum } from './social.js';

// The crowd's modal outcome — most-probable market, tie-broken by volume —
// reads far better than the highest-volume one (often a 0% tail outcome).
export function consensusMarket(event) {
  return parseEventMarkets(event).sort((a, b) => (b.pct - a.pct) || (b.volume - a.volume))[0] || null;
}

// Standing market-relevant queries. Each result event must actually mention the
// query in its TITLE (Gamma matches sub-questions too, which drags in noise).
export const PREDICTION_QUERIES = ['Fed', 'S&P 500', 'recession', 'inflation', 'tariffs', 'Nvidia', 'Bitcoin'];

export function titleMatchesQuery(title, query) {
  const t = String(title).toLowerCase();
  const q = String(query).toLowerCase();
  // Word-boundary for short queries ("Fed" must not match "federation").
  return q.length <= 4 ? new RegExp(`\\b${q}\\b`, 'i').test(t) : t.includes(q);
}

export function pickEvents(eventsByQuery, { minVolume = 25_000, limit = 8, notBefore = new Date().toISOString().slice(0, 10) } = {}) {
  const seen = new Set();
  const all = [];
  for (const { query, events } of eventsByQuery) {
    for (const e of events || []) {
      if (e.active === false || !e.title) continue;
      if (!titleMatchesQuery(e.title, query)) continue;
      // Polymarket leaves active=true on some resolved markets — drop anything
      // whose resolution date is already behind us.
      if (e.endDate && String(e.endDate).slice(0, 10) < notBefore) continue;
      const volume = toNum(e.volume);
      if (volume < minVolume || seen.has(e.title)) continue;
      seen.add(e.title);
      all.push({
        title: e.title,
        query,
        volume,
        endDate: (e.endDate || '').slice(0, 10),
        topMarket: consensusMarket(e),
      });
    }
  }
  return all.sort((a, b) => b.volume - a.volume).slice(0, limit);
}

let cache = { t: 0, data: null };
const TTL = 60 * 60_000;

export async function getMarketPredictions({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.t < TTL) return cache.data;

  const eventsByQuery = await Promise.all(PREDICTION_QUERIES.map(async (query) => {
    try {
      const qs = new URLSearchParams({ q: query, limit_per_type: '10' });
      const d = await fetchJSON(`https://gamma-api.polymarket.com/public-search?${qs}`);
      return { query, events: Array.isArray(d?.events) ? d.events : [] };
    } catch {
      return { query, events: [] };
    }
  }));

  const events = pickEvents(eventsByQuery);
  const data = {
    generatedAt: new Date().toISOString(),
    source: 'Polymarket (Gamma API)',
    queries: PREDICTION_QUERIES,
    available: events.length > 0,
    events,
  };
  if (events.length) cache = { t: Date.now(), data };
  return data;
}
