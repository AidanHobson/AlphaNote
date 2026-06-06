// Analyst coverage for equities. NOTE: Finnhub's numeric price-target endpoint
// (/stock/price-target) is premium (403 on the free tier), so this uses the FREE
// /stock/recommendation endpoint — the analyst ratings consensus (strongBuy / buy
// / hold / sell / strongSell counts by month). We never fabricate price targets.

const BASE_URL = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';

const cacheStore = new Map();

function consensusOf(r) {
  const total = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
  if (!total) return { label: 'No coverage', score: 0, total: 0 };
  const score = ((r.strongBuy || 0) * 5 + (r.buy || 0) * 4 + (r.hold || 0) * 3 + (r.sell || 0) * 2 + (r.strongSell || 0) * 1) / total;
  const label = score >= 4.5 ? 'Strong Buy' : score >= 3.5 ? 'Buy' : score >= 2.5 ? 'Hold' : score >= 1.5 ? 'Sell' : 'Strong Sell';
  return { label, score: Number(score.toFixed(2)), total };
}

export async function getAnalystRatings(symbol) {
  const token = process.env.FINNHUB_API_KEY || '';
  if (!token) throw new Error('FINNHUB API key is not configured');
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('A stock symbol is required');

  const key = `rec:${sym}`;
  const hit = cacheStore.get(key);
  if (hit && Date.now() - hit.t < 3600_000) return hit.v; // 1h cache

  const res = await fetch(`${BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(sym)}&token=${token}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    const empty = { symbol: sym, hasCoverage: false, consensus: consensusOf({}), latest: null, history: [], priceTargetNote: 'Numeric price targets require a paid Finnhub plan.' };
    cacheStore.set(key, { t: Date.now(), v: empty });
    return empty;
  }

  // Finnhub returns newest-first.
  const sorted = [...rows].sort((a, b) => (a.period < b.period ? 1 : -1));
  const latest = sorted[0];
  const history = sorted.slice(0, 6).reverse().map((r) => ({
    period: r.period,
    strongBuy: r.strongBuy || 0, buy: r.buy || 0, hold: r.hold || 0, sell: r.sell || 0, strongSell: r.strongSell || 0,
    consensus: consensusOf(r),
  }));

  const result = {
    symbol: sym,
    hasCoverage: true,
    consensus: consensusOf(latest),
    latest: {
      period: latest.period,
      strongBuy: latest.strongBuy || 0, buy: latest.buy || 0, hold: latest.hold || 0, sell: latest.sell || 0, strongSell: latest.strongSell || 0,
    },
    history,
    priceTargetNote: 'Ratings consensus shown; numeric price targets require a paid Finnhub plan.',
  };
  cacheStore.set(key, { t: Date.now(), v: result });
  return result;
}
