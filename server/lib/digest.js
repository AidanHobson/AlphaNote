// Personal daily digest — pushes the data the app already has toward the user
// instead of waiting for them to look. For a user's watchlist: which names are
// trending on the buzz board, which have recent insider buys, and which report
// earnings within the week — plus fresh names that just hit the board.

import { getUserState } from './auth.js';
import { getRedditBuzz } from './buzz.js';
import { getInsiderTransactions } from './insider.js';
import { getNextEarnings } from './finnhub.js';

const MAX_WATCH = 20;

export async function getDigest(userId) {
  const { watchlist } = getUserState(userId);
  const watch = new Set((watchlist || []).slice(0, MAX_WATCH).map((s) => String(s).toUpperCase()));

  const [board, insiderData] = await Promise.all([
    getRedditBuzz().catch(() => null),
    getInsiderTransactions().catch(() => null),
  ]);
  const items = board?.items || [];

  // Watchlist names currently on the trending board, with their board rank.
  const trending = items
    .map((b, i) => ({ symbol: b.symbol, rank: i + 1, shortVol: b.shortVol?.ratio ?? null, rising: Boolean(b.rising) }))
    .filter((b) => watch.has(b.symbol));

  // Recent open-market insider BUYS on watchlist names, aggregated per symbol.
  const txns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const buysBySym = new Map();
  for (const t of txns) {
    const sym = String(t.symbol || '').toUpperCase();
    if (t.side !== 'Buy' || !watch.has(sym)) continue;
    const e = buysBySym.get(sym) || { symbol: sym, buyers: new Set(), value: 0 };
    if (t.insider) e.buyers.add(t.insider.toLowerCase());
    e.value += t.value || 0;
    buysBySym.set(sym, e);
  }
  const insiderBuys = [...buysBySym.values()]
    .map((e) => ({ symbol: e.symbol, buyers: e.buyers.size, value: Math.round(e.value) }))
    .sort((a, b) => b.value - a.value);

  // Watchlist names reporting earnings within ~7 days (cached per symbol).
  const soon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  // Parallel + short patience: an uncached symbol under Finnhub-quota pressure
  // is skipped rather than blocking the digest for 15s.
  const earningsRaw = await Promise.all([...watch].map(async (sym) => {
    const e = await getNextEarnings(sym, { patienceMs: 2500 }).catch(() => null);
    return e?.date && e.date <= soon ? { symbol: sym, date: e.date, hour: e.hour || null } : null;
  }));
  const earningsSoon = earningsRaw.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));

  // Fresh names that just appeared on the board (not watchlist-specific).
  const newOnBoard = items.filter((b) => b.delta === 'new').slice(0, 5).map((b) => ({ symbol: b.symbol, shortVol: b.shortVol?.ratio ?? null }));

  return {
    generatedAt: new Date().toISOString(),
    watchlistCount: watch.size,
    trending,
    insiderBuys,
    earningsSoon,
    newOnBoard,
    empty: !trending.length && !insiderBuys.length && !earningsSoon.length && !newOnBoard.length,
  };
}
