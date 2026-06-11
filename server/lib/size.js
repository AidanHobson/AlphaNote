// Valuation "Size" lens — small-cap vs large-cap, finally on real data: EODHD
// 1-year EOD history for IWM (Russell 2000) vs SPY (S&P 500). Costs at most
// 2 EODHD quota calls/day (the histories are cached 12h by the eodhd module);
// the ratio series and period spreads are computed here.

import { getPriceHistory } from './eodhd.js';

const SMALL = { symbol: 'IWM', label: 'Russell 2000 (small caps)' };
const LARGE = { symbol: 'SPY', label: 'S&P 500 (large caps)' };
const PERIODS = [{ label: '1M', days: 22 }, { label: '3M', days: 66 }, { label: '6M', days: 132 }, { label: '1Y', days: Infinity }];

// % return over the trailing `days` points of a close series (oldest-first).
export function periodReturn(points, days) {
  if (!points || points.length < 2) return null;
  const slice = days === Infinity ? points : points.slice(-days);
  if (slice.length < 2 || !slice[0].close) return null;
  return Number((((slice[slice.length - 1].close - slice[0].close) / slice[0].close) * 100).toFixed(2));
}

// Align two close series by date and build the small/large ratio, indexed to 100.
export function ratioSeries(small, large) {
  const byDate = new Map(large.map((p) => [p.date, p.close]));
  const out = [];
  for (const p of small) {
    const l = byDate.get(p.date);
    if (l > 0 && p.close > 0) out.push({ date: p.date, value: p.close / l });
  }
  if (!out.length) return [];
  const base = out[0].value;
  return out.map((p) => ({ date: p.date, value: Number(((p.value / base) * 100).toFixed(2)) }));
}

export async function getSizeBoard() {
  const [small, large] = await Promise.all([getPriceHistory(SMALL.symbol), getPriceHistory(LARGE.symbol)]);
  if (!small.available || !large.available) {
    return { available: false, reason: small.reason || large.reason || 'Price history unavailable.' };
  }

  const periods = PERIODS.map(({ label, days }) => {
    const s = periodReturn(small.points, days);
    const l = periodReturn(large.points, days);
    return { label, small: s, large: l, spread: s != null && l != null ? Number((s - l).toFixed(2)) : null };
  });

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    source: 'EODHD end-of-day (adjusted close)',
    small: { ...SMALL, lastClose: small.stats.lastClose },
    large: { ...LARGE, lastClose: large.stats.lastClose },
    periods,
    ratio: ratioSeries(small.points, large.points), // >100 = small caps leading over the year
  };
}
