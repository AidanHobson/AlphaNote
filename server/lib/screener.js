// Research-priority screener — turns the AI analyst from "analyze this name" into
// "here's where the signals line up". Combines the signals the app already
// computes (buzz attention, short-volume squeeze setup, today's acceleration,
// and the scored insider signal) into ONE transparent composite score and ranks
// the candidates. It ranks WHAT TO RESEARCH, never what to buy: every row links
// into the research tools, the decision stays with the user. Pure scoring funcs
// are unit-tested; the gather wires them to live data.

import { getRedditBuzz } from './buzz.js';
import { getInsiderTransactions } from './insider.js';
import { getShortVolumeMap } from './shortvol.js';
import { getWarmSnapshot } from './warmer.js';
import { getWatchlistData } from './finnhub.js';
import { scoreInsiderActivity } from './analytics.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// A curated universe of large, liquid, US-listed Chinese tech ADRs. These names
// are structurally invisible to the other three sources — they're rarely on the
// Reddit board, they never file Form 4 (foreign private issuers are exempt from
// Section 16, so there's no insider-buy signal), and they're not in the US
// movers basket. Covering them explicitly means the screener can still rank them
// on the free signals that DO reach ADRs: FINRA short volume and the day's move.
export const CHINA_TECH = [
  'BABA', 'PDD', 'JD', 'BIDU', 'NTES', 'TCOM', 'BILI',
  'LI', 'XPEV', 'NIO', 'TME', 'FUTU', 'BEKE',
];

// Chinese robotics & autonomy — the US-listed, Finnhub-quotable subset only.
// The marquee humanoid/industrial names (UBTECH 9880.HK, Horizon 9660.HK,
// RoboSense, Estun, Inovance, Siasun) are HK/A-share listed, so the app can't
// quote them, FINRA short volume doesn't cover them, and SEC has no filings —
// they live in the speculative "China Robotics" outlook (labelled general
// knowledge), not here. What IS US-listed is the autonomy/sensor layer: robotaxi
// (Pony.ai, WeRide), lidar (Hesai), and autonomous aerial (EHang).
export const CHINA_ROBOTICS = ['HSAI', 'PONY', 'WRD', 'EH'];

// Each component is 0..1, deliberately interpretable. Insider buying is the
// highest-quality signal here, so it carries the most weight.
const WEIGHTS = { attention: 0.25, squeeze: 0.25, momentum: 0.15, insider: 0.35 };

// Map a scored insider signal to a [-0.5, 1] contribution + a tag.
function insiderComponent(score) {
  if (!score || score.count === 0) return { value: 0, tag: null };
  switch (score.label) {
    case 'strong insider buy cluster': return { value: 1, tag: 'insider cluster buy' };
    case 'insider buy cluster': return { value: 0.8, tag: 'insider cluster buy' };
    case 'net insider buying': return { value: 0.5, tag: 'net insider buying' };
    case 'net insider selling': return { value: -0.5, tag: 'insider selling' };
    default: return { value: 0.15, tag: null };
  }
}

// Score one board candidate. `maxMentions` normalises attention across the board.
export function scoreCandidate(item, insiderScore, maxMentions) {
  const tags = [];
  const attention = clamp01((item.mentions || 0) / (maxMentions || 1));

  const sv = item.shortVol?.ratio ?? 0;
  const squeeze = clamp01((sv - 40) / 50); // 40% → 0, 90% → 1
  if (sv >= 60) tags.push(`${sv}% short`);

  const chg = item.quote?.changePercent ?? 0;
  const momentum = clamp01((item.rising ? 0.6 : 0) + clamp01(chg / 15) * 0.4);
  if (item.rising) tags.push('rising today');

  const ins = insiderComponent(insiderScore);
  if (ins.tag) tags.push(ins.tag);
  const insider = clamp01(ins.value); // negative insider selling floors the bonus at 0, but is tagged

  if ((item.mentions || 0) >= maxMentions) tags.push('most-mentioned');

  const composite =
    WEIGHTS.attention * attention +
    WEIGHTS.squeeze * squeeze +
    WEIGHTS.momentum * momentum +
    WEIGHTS.insider * insider;

  return {
    symbol: item.symbol,
    name: item.name || null,
    quote: item.quote || null,
    source: item.source || 'trending',
    score: Math.round(composite * 100),
    components: {
      attention: Math.round(attention * 100),
      squeeze: Math.round(squeeze * 100),
      momentum: Math.round(momentum * 100),
      insider: Math.round(ins.value * 100),
    },
    tags,
  };
}

export function buildScreener(board, insiderBySymbol = new Map()) {
  const items = board?.items || [];
  if (!items.length) return [];
  const maxMentions = Math.max(1, ...items.map((i) => i.mentions || 0));
  return items
    .map((i) => scoreCandidate(i, insiderBySymbol.get(i.symbol), maxMentions))
    .sort((a, b) => b.score - a.score);
}

let cache = { t: 0, data: null };
const TTL = 30 * 60_000;

export async function getResearchShortlist({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.t < TTL) return cache.data;

  const [board, insiderData, shortVol, chinaQuotes] = await Promise.all([
    getRedditBuzz().catch(() => null),
    getInsiderTransactions().catch(() => null),
    getShortVolumeMap().catch(() => ({ map: null })),
    getWatchlistData([...CHINA_TECH, ...CHINA_ROBOTICS]).catch(() => []),
  ]);

  // Score every symbol's open-market insider activity, market-wide.
  const txns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const grouped = new Map();
  for (const t of txns) {
    const sym = String(t.symbol || '').toUpperCase();
    if (!sym) continue;
    if (!grouped.has(sym)) grouped.set(sym, []);
    grouped.get(sym).push(t);
  }
  const insiderBySymbol = new Map([...grouped].map(([sym, rows]) => [sym, scoreInsiderActivity(rows)]));

  // Candidate universe = Reddit-trending names ∪ names insiders are BUYING
  // (cluster / net buying) market-wide — broadening past retail attention to
  // where any signal is firing, including names off the board entirely.
  const buzzItems = board?.items || [];
  const buzzBySym = new Map(buzzItems.map((b) => [b.symbol, b]));
  const insiderBuy = [...insiderBySymbol]
    .filter(([, sc]) => sc.label.includes('buy'))
    .sort((a, b) => b[1].buyValue - a[1].buyValue)
    .map(([sym]) => sym)
    .slice(0, 12);

  // Third source: the biggest daily movers from the warmer's snapshot (free —
  // no new Finnhub calls). Reliably broadens the universe to large/mid-cap
  // momentum names beyond the Reddit penny-stock crowd.
  const movers = (getWarmSnapshot('movers')?.items || [])
    .filter((m) => m && m.price > 0)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 8);
  const moverBySym = new Map(movers.map((m) => [m.symbol, m]));

  // Fourth & fifth sources: the curated Chinese tech and robotics/autonomy ADR
  // universes, quoted in bulk (fail-fast). Only names that actually quote are
  // kept, so it degrades to however many the free tier returns.
  const roboSet = new Set(CHINA_ROBOTICS);
  const chinaItems = (Array.isArray(chinaQuotes) ? chinaQuotes : []).filter((q) => q && q.price > 0);
  const chinaBySym = new Map(chinaItems.map((q) => [q.symbol, q]));

  const symbols = [...new Set([
    ...buzzItems.map((b) => b.symbol),
    ...insiderBuy,
    ...movers.map((m) => m.symbol),
    ...chinaItems.map((q) => q.symbol),
  ])];
  if (!symbols.length) {
    return { available: false, reason: 'No live candidates from the trending board, insider filings, movers, or Chinese ADRs right now.' };
  }

  const svMap = shortVol?.map;
  const items = symbols.map((sym) => {
    const b = buzzBySym.get(sym);
    const m = moverBySym.get(sym);
    const cn = chinaBySym.get(sym);
    const sv = svMap?.get(sym);
    // Source precedence: Reddit attention (richest signal) wins, then insider
    // buying, then a US mover, then the curated China universes (robotics vs
    // tech kept as distinct labels; the two lists are disjoint).
    const source = b ? 'trending'
      : insiderBuy.includes(sym) && !m && !cn ? 'insider buying'
      : m ? 'big mover'
      : cn ? (roboSet.has(sym) ? 'china robotics' : 'china tech')
      : 'trending';
    return {
      symbol: sym,
      name: b?.name || m?.name || cn?.name || null,
      mentions: b?.mentions || 0,
      rising: b?.rising || false,
      shortVol: sv ? { ratio: sv.ratio, date: sv.date } : (b?.shortVol || null),
      // Prefer the buzz quote; otherwise the mover's, otherwise the ADR's
      // (off-board insider names skip quote enrichment to avoid extra quota).
      quote: b?.quote || (m ? { price: m.price, changePercent: m.changePercent } : cn ? { price: cn.price, changePercent: cn.changePercent } : null),
      source,
    };
  });

  const data = {
    available: true,
    generatedAt: new Date().toISOString(),
    weights: WEIGHTS,
    candidates: buildScreener({ items }, insiderBySymbol).slice(0, 15),
  };
  cache = { t: Date.now(), data };
  return data;
}
