// Background cache warmer — proactively refreshes the Finnhub-backed boards
// (movers, commodities, macro) on a paced schedule so user requests read a
// COMPLETE, recent snapshot instead of triggering their own cold fetch that can
// hit the free-tier 60/min ceiling and return partial data.
//
// Pacing: one board per tick, then sleep proportional to that board's quote cost
// at a target rate (~48 quotes/min) that stays comfortably under 60/min. Only a
// COMPLETE result replaces a snapshot, so a transient rate-limit never degrades
// what users see — the snapshot simply ages until the next good refresh.

import { getMoversBoard, getCommoditiesBoard, MARKET_BASKET } from './brief.js';
import { getMacroBoard } from './macro.js';

const snapshots = { movers: null, commodities: null, macro: null }; // each { data, t }

const TARGET_QPS = Number(process.env.FINNHUB_WARM_QPS) || 0.8; // ~48 quotes/min
const MIN_GAP_MS = 15_000;

// `cost` ≈ Finnhub quote requests per refresh (used only to pace the sleep).
const BOARDS = {
  movers: { cost: 50, fetch: () => getMoversBoard(MARKET_BASKET), ok: (d) => (d?.items?.length || 0) >= 36 },
  commodities: { cost: 14, fetch: () => getCommoditiesBoard(), ok: (d) => (d?.items?.length || 0) >= 10 },
  macro: {
    cost: 36, fetch: () => getMacroBoard(),
    ok: (d) => {
      const all = Array.isArray(d?.groups) ? d.groups.flatMap((g) => g.items) : [];
      return all.length > 0 && all.filter((i) => i.price > 0).length >= all.length * 0.9;
    },
  },
};
// Weighted toward the landing-page boards (movers twice per cycle), but macro
// placed 3rd so it still warms within the first ~1.5 min after boot.
const ROTATION = ['movers', 'commodities', 'macro', 'movers'];

// Pure: how long to sleep after refreshing a board of `cost` quotes.
export function nextDelayMs(cost, { qps = TARGET_QPS, minGapMs = MIN_GAP_MS } = {}) {
  return Math.max(minGapMs, Math.round((cost / qps) * 1000));
}

let idx = 0;
let timer = null;
let running = false;

async function tick() {
  const name = ROTATION[idx++ % ROTATION.length];
  const board = BOARDS[name];
  let delayCost = board.cost;
  try {
    const data = await board.fetch();
    if (board.ok(data)) snapshots[name] = { data, t: Date.now() };
    else delayCost = Math.max(delayCost, 30); // partial/rate-limited → wait longer before retry
  } catch (e) {
    console.warn(`[warmer] ${name} refresh failed:`, e.message);
    delayCost = 40;
  }
  timer = setTimeout(tick, nextDelayMs(delayCost));
  timer.unref?.(); // never keep the process alive just for the warmer
}

export function startWarmer() {
  if (running) return false;
  if (!process.env.FINNHUB_API_KEY || process.env.WARMER_DISABLED === '1') return false;
  running = true;
  timer = setTimeout(tick, 1500);
  timer.unref?.();
  return true;
}

export function getWarmSnapshot(name) {
  return snapshots[name]?.data || null;
}

export function warmerStatus() {
  const ageS = (s) => (s ? Math.round((Date.now() - s.t) / 1000) : null);
  return {
    running,
    targetQps: TARGET_QPS,
    ageSeconds: { movers: ageS(snapshots.movers), commodities: ageS(snapshots.commodities), macro: ageS(snapshots.macro) },
  };
}
