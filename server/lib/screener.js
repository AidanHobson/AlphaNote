// Research-priority screener — turns the AI analyst from "analyze this name" into
// "here's where the signals line up". Combines the signals the app already
// computes (buzz attention, short-volume squeeze setup, today's acceleration,
// and the scored insider signal) into ONE transparent composite score and ranks
// the candidates. It ranks WHAT TO RESEARCH, never what to buy: every row links
// into the research tools, the decision stays with the user. Pure scoring funcs
// are unit-tested; the gather wires them to live data.

import { getRedditBuzz } from './buzz.js';
import { getInsiderTransactions } from './insider.js';
import { scoreInsiderActivity } from './analytics.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

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

  const [board, insiderData] = await Promise.all([
    getRedditBuzz().catch(() => null),
    getInsiderTransactions().catch(() => null),
  ]);
  if (!board?.available || !board.items?.length) {
    return { available: false, reason: 'The trending board is unavailable, so there are no live candidates to rank right now.' };
  }

  // Score each board symbol's open-market insider activity.
  const txns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const bySym = new Map();
  for (const t of txns) {
    const sym = String(t.symbol || '').toUpperCase();
    if (!sym) continue;
    (bySym.get(sym) || bySym.set(sym, []).get(sym)).push(t);
  }
  const insiderBySymbol = new Map([...bySym].map(([sym, rows]) => [sym, scoreInsiderActivity(rows)]));

  const data = {
    available: true,
    generatedAt: new Date().toISOString(),
    weights: WEIGHTS,
    candidates: buildScreener(board, insiderBySymbol).slice(0, 12),
  };
  cache = { t: Date.now(), data };
  return data;
}
