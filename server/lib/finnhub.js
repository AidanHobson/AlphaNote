// Finnhub integration — ported from the original OpenStock `lib/actions/finnhub.actions.ts`.
// Adapted from Next.js server actions to plain async functions.
// The API key stays server-side (read from process.env), never sent to the browser.

import { POPULAR_STOCK_SYMBOLS, FINNHUB_EXCHANGE_SUFFIXES } from './constants.js';
import { getDateRange, validateArticle, formatArticle, boundedSet } from './utils.js';
import { createBucket } from './ratelimit.js';

const BASE_URL = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';

function getToken() {
  return process.env.FINNHUB_API_KEY || '';
}

// ── tiny in-memory TTL cache (mirrors the original's `revalidate` intent and
//    protects the free-tier 60 req/min limit) ────────────────────────────────
const cacheStore = new Map();
async function cached(key, ttlSeconds, fn) {
  const now = Date.now();
  const hit = cacheStore.get(key);
  if (hit && now - hit.t < ttlSeconds * 1000) return hit.v;
  const v = await fn();
  // Don't cache nulls/empties for long — they're usually transient failures.
  if (v != null) boundedSet(cacheStore, key, { t: now, v }, 800); // cap: keys are user symbols
  return v;
}

// Every Finnhub request — warmer and interactive alike — takes a token first,
// so bursts queue briefly (≤15s) instead of hitting the 60/min wall as 429s.
const bucket = createBucket({
  perMinute: Number(process.env.FINNHUB_RPM_BUDGET) || 55,
  burst: 6,
  maxWaitMs: 15_000,
});

async function fetchJSON(url, { patienceMs } = {}) {
  await bucket.take(patienceMs);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Finnhub ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Bulk basket fetches (watchlist/movers) fail fast instead of clogging the
// queue for 15s per call — single interactive calls keep the default patience.
const BULK_PATIENCE_MS = 2500;

function getExchangeLabel(symbol, exchange) {
  if (exchange && exchange.trim()) return exchange.trim();
  const parts = symbol.split('.');
  const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
  if (!suffix) return 'US';
  return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol, { patienceMs } = {}) {
  try {
    const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${getToken()}`;
    return await cached(`quote:${symbol}`, 10, () => fetchJSON(url, { patienceMs }));
  } catch (e) {
    console.error('Error fetching quote for', symbol, e.message);
    return null;
  }
}

// Next scheduled earnings report within ~4 months (free-tier calendar endpoint).
export async function getNextEarnings(symbol, { patienceMs } = {}) {
  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
    const url = `${BASE_URL}/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${getToken()}`;
    const data = await cached(`earnings:${symbol}`, 43200, () => fetchJSON(url, { patienceMs }));
    const list = (data?.earningsCalendar || []).filter((e) => e?.date).sort((a, b) => a.date.localeCompare(b.date));
    const next = list[0];
    if (!next) return null;
    return {
      date: next.date,
      hour: next.hour || null, // 'bmo' before open / 'amc' after close
      epsEstimate: next.epsEstimate ?? null,
      revenueEstimate: next.revenueEstimate ?? null,
    };
  } catch (e) {
    console.error('Error fetching earnings calendar for', symbol, e.message);
    return null;
  }
}

export async function getCompanyProfile(symbol, { patienceMs } = {}) {
  try {
    const url = `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${getToken()}`;
    return await cached(`profile:${symbol}`, 86400, () => fetchJSON(url, { patienceMs }));
  } catch (e) {
    console.error('Error fetching profile for', symbol, e.message);
    return null;
  }
}

// Industry peers for a symbol (Finnhub free tier), excluding itself, capped.
export async function getPeers(symbol, { limit = 6 } = {}) {
  try {
    const url = `${BASE_URL}/stock/peers?symbol=${encodeURIComponent(symbol)}&token=${getToken()}`;
    const list = await cached(`peers:${symbol}`, 86400, () => fetchJSON(url));
    const sym = String(symbol).toUpperCase();
    return (Array.isArray(list) ? list : [])
      .map((s) => String(s).toUpperCase())
      .filter((s) => s && s !== sym)
      .slice(0, limit);
  } catch (e) {
    console.error('Error fetching peers for', symbol, e.message);
    return [];
  }
}

// Combined quote + profile for a set of symbols (used by the watchlist & movers).
// Concurrency-limited so large baskets don't burst Finnhub's free-tier rate limit.
export async function getWatchlistData(symbols) {
  if (!symbols || symbols.length === 0) return [];
  // Clamp to a constant so the worker loop's bound never comes from the raw
  // (user-supplied) list length — callers also slice, this bounds it at source.
  const count = Math.min(symbols.length, 100);
  const out = new Array(count);
  let i = 0;
  const worker = async () => {
    while (i < count) {
      const idx = i++;
      const sym = symbols[idx];
      const [quote, profile] = await Promise.all([
        getQuote(sym, { patienceMs: BULK_PATIENCE_MS }),
        getCompanyProfile(sym, { patienceMs: BULK_PATIENCE_MS }),
      ]);
      out[idx] = {
        symbol: sym,
        price: quote?.c || 0,
        change: quote?.d || 0,
        changePercent: quote?.dp || 0,
        high: quote?.h || 0,
        low: quote?.l || 0,
        open: quote?.o || 0,
        prevClose: quote?.pc || 0,
        currency: profile?.currency || 'USD',
        name: profile?.name || sym,
        logo: profile?.logo || '',
        exchange: profile?.exchange || '',
        marketCap: profile?.marketCapitalization || 0,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, count) }, worker));
  return out;
}

// Market / company news (round-robin across symbols, capped at 6) — ported.
export async function getNews(symbols) {
  const token = getToken();
  if (!token) throw new Error('FINNHUB API key is not configured');

  const range = getDateRange(5);
  const cleanSymbols = (symbols || [])
    .map((s) => s?.trim().toUpperCase())
    .filter(Boolean);
  const maxArticles = 6;

  if (cleanSymbols.length > 0) {
    const perSymbol = {};
    await Promise.all(
      cleanSymbols.map(async (sym) => {
        try {
          const url = `${BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`;
          const articles = await cached(`cnews:${sym}`, 300, () => fetchJSON(url));
          perSymbol[sym] = (articles || []).filter(validateArticle);
        } catch (e) {
          console.error('Error fetching company news for', sym, e.message);
          perSymbol[sym] = [];
        }
      })
    );

    const collected = [];
    for (let round = 0; round < maxArticles; round++) {
      for (const sym of cleanSymbols) {
        const list = perSymbol[sym] || [];
        if (list.length === 0) continue;
        const article = list.shift();
        if (!article || !validateArticle(article)) continue;
        collected.push(formatArticle(article, true, sym, round));
        if (collected.length >= maxArticles) break;
      }
      if (collected.length >= maxArticles) break;
    }
    if (collected.length > 0) {
      collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
      return collected.slice(0, maxArticles);
    }
    // else fall through to general news
  }

  const general = await cached('news:general', 300, () =>
    fetchJSON(`${BASE_URL}/news?category=general&token=${token}`)
  );
  const seen = new Set();
  const unique = [];
  for (const art of general || []) {
    if (!validateArticle(art)) continue;
    const key = `${art.id}-${art.url}-${art.headline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(art);
    if (unique.length >= 20) break;
  }
  return unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
}

// Symbol search; empty query → profiles for the top popular symbols. Ported.
export async function searchStocks(query) {
  const token = getToken();
  if (!token) {
    console.error('Error in stock search: FINNHUB API key is not configured');
    return [];
  }

  const trimmed = typeof query === 'string' ? query.trim() : '';
  let results = [];

  if (!trimmed) {
    const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
    const profiles = await Promise.all(
      top.map(async (sym) => {
        try {
          const url = `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
          const profile = await cached(`profile:${sym}`, 3600, () => fetchJSON(url));
          return { sym, profile };
        } catch (e) {
          console.error('Error fetching profile2 for', sym, e.message);
          return { sym, profile: null };
        }
      })
    );
    results = profiles
      .map(({ sym, profile }) => {
        const symbol = sym.toUpperCase();
        const name = profile?.name || profile?.ticker;
        if (!name) return null;
        return { symbol, description: name, __exchange: profile?.exchange };
      })
      .filter(Boolean);
  } else {
    const url = `${BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
    const data = await cached(`search:${trimmed.toLowerCase()}`, 1800, () => fetchJSON(url));
    results = Array.isArray(data?.result) ? data.result : [];
  }

  return results
    .map((r) => {
      const upper = (r.symbol || '').toUpperCase();
      // Skip option/forward/odd symbols that Finnhub returns (contain '.' mid-string with digits, etc.)
      return {
        symbol: upper,
        name: r.description || upper,
        exchange: getExchangeLabel(upper, r.__exchange),
        type: r.type || 'Stock',
      };
    })
    .filter((r) => r.symbol)
    .slice(0, 15);
}
