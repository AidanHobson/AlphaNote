// Earnings Calendar — ReturnSignal's "Earnings Calendar". Wraps Finnhub's
// /calendar/earnings, filtered to analyst-covered names (to cut micro-cap noise),
// with optional inclusion of the user's watchlist symbols.

const BASE_URL = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';

function ymd(d) { return d.toISOString().slice(0, 10); }

let cache = { t: 0, days: 0, data: null };

export async function getEarningsCalendar({ days = 21, symbols = [] } = {}) {
  const token = process.env.FINNHUB_API_KEY || '';
  if (!token) throw new Error('FINNHUB API key is not configured');

  const now = Date.now();
  let rows;
  if (cache.data && cache.days === days && now - cache.t < 600000) {
    rows = cache.data; // 10-min cache (calendar changes slowly)
  } else {
    const from = ymd(new Date());
    const to = ymd(new Date(Date.now() + days * 86400000));
    const res = await fetch(`${BASE_URL}/calendar/earnings?from=${from}&to=${to}&token=${token}`);
    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const data = await res.json();
    rows = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
    cache = { t: now, days, data: rows };
  }

  const wl = new Set(symbols.map((s) => s.toUpperCase()));
  const items = rows
    .filter((r) => r.epsEstimate != null || r.revenueEstimate != null || wl.has((r.symbol || '').toUpperCase()))
    .map((r) => ({
      date: r.date,
      symbol: (r.symbol || '').toUpperCase(),
      hour: r.hour || '',            // 'bmo' | 'amc' | ''
      epsEstimate: r.epsEstimate ?? null,
      epsActual: r.epsActual ?? null,
      revenueEstimate: r.revenueEstimate ?? null,
      quarter: r.quarter ?? null,
      year: r.year ?? null,
      hasEstimate: r.epsEstimate != null || r.revenueEstimate != null,
      inWatchlist: wl.has((r.symbol || '').toUpperCase()),
    }))
    .sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : a.date.localeCompare(b.date)))
    .slice(0, 120);

  return { from: ymd(new Date()), days, count: items.length, items };
}
