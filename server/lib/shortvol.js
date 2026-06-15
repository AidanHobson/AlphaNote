// FINRA daily short-sale volume (keyless, published every trading day around
// the evening). Gives each ticker the share of consolidated volume that was
// sold short — squeeze/positioning context for the speculative board. NOTE:
// this is daily SHORT VOLUME (flow), not short interest (outstanding stock);
// the prompt and UI label it accordingly. Typical large-cap baseline ~40-50%.

import { recordOutcome } from './source-health.js';

export function parseShortVolume(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const [date, symbol, shortVol, , totalVol] = line.split('|');
    if (!symbol || symbol === 'Symbol') continue;
    const s = Number(shortVol); const t = Number(totalVol);
    if (!Number.isFinite(s) || !Number.isFinite(t) || t <= 0) continue;
    map.set(symbol.trim(), {
      ratio: Number(((s / t) * 100).toFixed(1)),
      totalVolume: Math.round(t),
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    });
  }
  return map;
}

let cache = { t: 0, map: null, date: null };
const TTL = 6 * 3600_000;

export async function getShortVolumeMap() {
  if (cache.map && Date.now() - cache.t < TTL) return cache;
  // Walk back from today — the current day's file appears after the close,
  // and weekends/holidays have no file.
  for (let back = 0; back < 6; back++) {
    const ymd = new Date(Date.now() - back * 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const map = parseShortVolume(await res.text());
      if (map.size > 1000) { // sanity: a real trading-day file covers thousands of symbols
        cache = { t: Date.now(), map, date: ymd };
        recordOutcome('finra', true);
        return cache;
      }
    } catch { /* try the previous day */ }
  }
  recordOutcome('finra', false, 'no usable short-volume file in the last 6 days');
  return { t: 0, map: null, date: null };
}

export async function shortVolFor(symbol) {
  const { map } = await getShortVolumeMap();
  return map?.get(String(symbol).toUpperCase()) || null;
}
