// Signal validation — does the speculative layer actually work? We snapshot the
// buzz board to buzz_history (symbol, rank, mentions, short_vol, rising) and save
// every note with its conviction score. This measures forward returns against
// those signals so the app can show its own track record instead of only
// generating signals. EODHD daily closes (12h-cached) are the price oracle.
//
// The compute functions take an injected `priceFor(symbol) → points[]` so they
// are unit-tested with synthetic prices, separate from the network wiring.

import db from './db.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import kv from './kvcache.js';

const DAY = 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (dateStr, n) => iso(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY);

// Latest close on or before a date, from chronological [{date, close}] points.
export function closeOnOrBefore(points, dateStr) {
  if (!points?.length) return null;
  let found = null;
  for (const p of points) {
    if (p.date <= dateStr) found = p.close; else break;
  }
  return found;
}

// Forward return from the close on/before entryDate to the close on/before
// entryDate + horizon calendar days. Null when either side is missing.
export function forwardReturn(points, entryDate, horizonDays) {
  const entry = closeOnOrBefore(points, entryDate);
  const exit = closeOnOrBefore(points, addDays(entryDate, horizonDays));
  if (entry == null || exit == null || entry <= 0 || exit === entry) {
    return entry != null && exit === entry ? 0 : null;
  }
  return (exit - entry) / entry;
}

const pct = (x) => Number((x * 100).toFixed(2));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function summarise(rows) {
  if (!rows.length) return { n: 0, avgReturn: null, medianReturn: null, hitRate: null, avgExcess: null, winVsSpy: null };
  const rets = rows.map((r) => r.ret);
  const exc = rows.filter((r) => r.excess != null).map((r) => r.excess);
  return {
    n: rows.length,
    avgReturn: pct(rets.reduce((s, x) => s + x, 0) / rets.length),
    medianReturn: pct(median(rets)),
    hitRate: pct(rets.filter((x) => x > 0).length / rets.length),
    avgExcess: exc.length ? pct(exc.reduce((s, x) => s + x, 0) / exc.length) : null,
    winVsSpy: exc.length ? pct(exc.filter((x) => x > 0).length / exc.length) : null,
  };
}

// One signal per (symbol, UTC day): earliest snapshot that day, carrying its
// best rank and the day's short-vol / rising flags. Correlated 30-min snapshots
// of the same name on the same day shouldn't each count as a separate sample.
export function dailySignals(db_, { sinceMs }) {
  return db_.prepare(`
    SELECT symbol, date AS day, MIN(snapped_at) AS snapped_at, MIN(rank) AS best_rank,
           MAX(short_vol) AS short_vol, MAX(rising) AS rising, MAX(mentions) AS mentions
    FROM (SELECT *, strftime('%Y-%m-%d', snapped_at/1000, 'unixepoch') AS date FROM buzz_history WHERE snapped_at >= ?)
    GROUP BY symbol, day
  `).all(sinceMs);
}

export function computeBuzzBacktest(db_, { priceFor, spyPoints = null, horizonDays = 5, now = Date.now() } = {}) {
  // Only signals old enough that the horizon has fully elapsed.
  const cutoffDay = iso(now - horizonDays * DAY);
  const signals = dailySignals(db_, { sinceMs: now - 120 * DAY }).filter((s) => s.day <= cutoffDay);

  const resolved = [];
  const unresolved = new Set();
  for (const s of signals) {
    const points = priceFor(s.symbol);
    if (!points?.length) { unresolved.add(s.symbol); continue; }
    const ret = forwardReturn(points, s.day, horizonDays);
    if (ret == null) { unresolved.add(s.symbol); continue; }
    const spyRet = spyPoints ? forwardReturn(spyPoints, s.day, horizonDays) : null;
    resolved.push({ ...s, ret, excess: spyRet == null ? null : ret - spyRet });
  }

  const buckets = {
    all: summarise(resolved),
    highShort: summarise(resolved.filter((r) => r.short_vol != null && r.short_vol >= 60)),
    rising: summarise(resolved.filter((r) => r.rising === 1)),
    topRank: summarise(resolved.filter((r) => r.best_rank <= 3)),
  };
  return {
    horizonDays,
    generatedAt: new Date().toISOString(),
    signalsConsidered: signals.length,
    signalsResolved: resolved.length,
    unresolvedSymbols: [...unresolved].length,
    buckets,
  };
}

// Conviction calibration: do higher-conviction ticker notes fare better? Uses
// the "since the note" return to the latest close (variable holding period,
// reported), bucketed Low (1-2) / Mid (3) / High (4-5).
export function computeConvictionCalibration(db_, { priceFor, now = Date.now() } = {}) {
  const notes = db_.prepare(`
    SELECT topic, conviction, created_at FROM research_notes
    WHERE kind IN ('research','monopoly') AND conviction IS NOT NULL AND created_at <= ?
  `).all(now - 3 * DAY); // give at least a few days for a return to develop

  const rows = [];
  for (const note of notes) {
    const points = priceFor(note.topic);
    if (!points?.length) continue;
    const entryDate = iso(note.created_at);
    const entry = closeOnOrBefore(points, entryDate);
    const latest = points[points.length - 1]?.close;
    if (entry == null || latest == null || entry <= 0) continue;
    rows.push({ conviction: note.conviction, ret: (latest - entry) / entry, holdingDays: Math.round((now - note.created_at) / DAY) });
  }
  const band = (lo, hi) => {
    const r = rows.filter((x) => x.conviction >= lo && x.conviction <= hi);
    return { n: r.length, avgReturn: r.length ? pct(r.reduce((s, x) => s + x.ret, 0) / r.length) : null, hitRate: r.length ? pct(r.filter((x) => x.ret > 0).length / r.length) : null };
  };
  return {
    generatedAt: new Date().toISOString(),
    sampled: rows.length,
    avgHoldingDays: rows.length ? Math.round(rows.reduce((s, x) => s + x.holdingDays, 0) / rows.length) : null,
    bands: { low: band(1, 2), mid: band(3, 3), high: band(4, 5) },
  };
}

// ── Network wiring ───────────────────────────────────────────────────────────
const cache = { t: 0, data: null };
const TTL = 3 * 3600_000;
const MAX_SYMBOLS = 25; // EODHD free-tier quota guard; cached histories are free

async function buildPriceFor(symbols) {
  const map = new Map();
  for (const sym of symbols.slice(0, MAX_SYMBOLS)) {
    try {
      const h = await getPriceHistory(sym);
      if (h?.available && h.points?.length) map.set(sym, h.points);
    } catch { /* unresolved — counted in the report */ }
  }
  return (sym) => map.get(sym) || null;
}

export async function getSignalPerformance({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.t < TTL) return cache.data;
  if (!isEodhdConfigured()) {
    return { available: false, reason: 'Price history (EODHD) is not configured, so forward returns cannot be computed.' };
  }
  // Distinct symbols across the buzz history + ticker notes, most-frequent first.
  const buzzSyms = db.prepare("SELECT symbol, COUNT(*) AS n FROM buzz_history WHERE snapped_at >= ? GROUP BY symbol ORDER BY n DESC").all(Date.now() - 120 * DAY).map((r) => r.symbol);
  const noteSyms = db.prepare("SELECT DISTINCT topic FROM research_notes WHERE kind IN ('research','monopoly')").all().map((r) => r.topic);
  const symbols = [...new Set([...buzzSyms, ...noteSyms])];

  const [priceFor, spy] = await Promise.all([
    buildPriceFor(symbols),
    getPriceHistory('SPY').catch(() => null),
  ]);
  const spyPoints = spy?.available ? spy.points : null;

  const data = {
    available: true,
    distinctSymbols: symbols.length,
    pricedSymbols: Math.min(symbols.length, MAX_SYMBOLS),
    buzz: {
      d5: computeBuzzBacktest(db, { priceFor, spyPoints, horizonDays: 5 }),
      d20: computeBuzzBacktest(db, { priceFor, spyPoints, horizonDays: 20 }),
    },
    conviction: computeConvictionCalibration(db, { priceFor }),
  };
  cache.t = Date.now();
  cache.data = data;
  return data;
}
