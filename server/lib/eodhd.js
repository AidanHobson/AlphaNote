// EODHD (eodhd.com) — end-of-day price history, the one dataset Finnhub's free
// tier gates (candles are premium there). The EODHD free plan allows only
// ~20 requests/day with 1-year depth, so this module is built around that:
//   • 12h cache per symbol (EOD data only changes once a day) + bounded size
//   • in-flight promise dedupe (concurrent requests spend ONE quota call)
//   • never called by the background warmer — on-demand only
//   • quota/unknown-symbol failures return a friendly `available:false`, and
//     errors carry the status only (never the URL, which contains the token)

import { boundedSet } from './utils.js';

const TTL_MS = 12 * 3600_000;
const MAX_CACHED = 50;
const cache = new Map(); // eodhdSymbol → { t, promise }

export function isEodhdConfigured() {
  return /\S/.test(process.env.EODHD_API_KEY || '');
}

// EODHD wants TICKER.EXCHANGE and uses dashes for share classes (BRK.B → BRK-B.US).
// Plain US tickers get .US appended; an explicit ".US" suffix is preserved.
export function toEodhdSymbol(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 16);
  if (!s) return null;
  if (s.endsWith('.US')) s = s.slice(0, -3);
  return `${s.replace(/\./g, '-')}.US`;
}

// rows (oldest-first from EODHD) → compact series + period stats.
export function summarizeHistory(rows) {
  const series = rows
    .filter((r) => r && r.date && Number.isFinite(r.adjusted_close ?? r.close))
    .map((r) => ({ date: r.date, close: Number((r.adjusted_close ?? r.close).toFixed(4)), volume: r.volume ?? null }));
  if (!series.length) return null;
  const first = series[0].close, last = series[series.length - 1].close;
  return {
    points: series,
    stats: {
      first: series[0].date,
      last: series[series.length - 1].date,
      lastClose: last,
      changePercent: first ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
      high: Math.max(...series.map((p) => p.close)),
      low: Math.min(...series.map((p) => p.close)),
    },
  };
}

async function fetchHistory(eodhdSymbol) {
  const from = new Date(Date.now() - 366 * 86400_000).toISOString().slice(0, 10);
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol)}?api_token=${process.env.EODHD_API_KEY}&fmt=json&period=d&from=${from}`;
  const res = await fetch(url);
  if (res.status === 402 || res.status === 429) {
    return { available: false, reason: 'Daily price-history quota reached (EODHD free tier: ~20 requests/day). Cached symbols keep working — try again tomorrow.' };
  }
  if (res.status === 404) return { available: false, reason: 'No EODHD price data for this symbol.' };
  if (!res.ok) throw new Error(`EODHD ${res.status}`); // status only — URL carries the token
  const rows = await res.json();
  const summary = Array.isArray(rows) ? summarizeHistory(rows) : null;
  if (!summary) return { available: false, reason: 'No usable price rows returned for this symbol.' };
  return { available: true, source: 'EODHD (end-of-day, adjusted close)', ...summary };
}

export async function getPriceHistory(symbol) {
  const eodSym = toEodhdSymbol(symbol);
  if (!eodSym) return { symbol: '', available: false, reason: 'Invalid symbol.' };
  if (!isEodhdConfigured()) return { symbol: eodSym, available: false, reason: 'Price history unavailable: EODHD_API_KEY is not configured.' };

  const hit = cache.get(eodSym);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.promise;

  const promise = fetchHistory(eodSym)
    .then((data) => {
      const out = { symbol: eodSym, ...data };
      // Don't pin failures for 12h — let quota/transient errors retry sooner.
      if (!data.available) cache.delete(eodSym);
      return out;
    })
    .catch((e) => {
      cache.delete(eodSym);
      console.warn('eodhd history failed:', e.message);
      return { symbol: eodSym, available: false, reason: 'Could not load price history right now.' };
    });
  boundedSet(cache, eodSym, { t: Date.now(), promise }, MAX_CACHED);
  return promise;
}
