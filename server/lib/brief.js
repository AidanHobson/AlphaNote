// Market "Narrative Pulse" — AlphaNote's hybrid of ReturnSignal's narrative-pulse
// card and OpenStock's Claude→Gemini AI. Summarises the day's news + movers into
// a short, plain-English market brief.

import { getQuote, getWatchlistData, getNews } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { POPULAR_STOCK_SYMBOLS } from './constants.js';

// A representative basket used for breadth/regime + the movers table.
export const MARKET_BASKET = [
  // Tech / comms
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'AMD', 'CRM',
  'ORCL', 'ADBE', 'AVGO', 'QCOM', 'PLTR', 'INTC', 'CSCO', 'IBM',
  // Financials
  'JPM', 'BAC', 'WFC', 'GS', 'V', 'MA', 'MS', 'AXP',
  // Healthcare
  'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO',
  // Consumer
  'WMT', 'HD', 'COST', 'NKE', 'MCD', 'DIS', 'KO', 'PG',
  // Energy / industrials
  'XOM', 'CVX', 'CAT', 'BA', 'GE',
];

// Commodity exposure via liquid, US-listed ETF proxies the free Finnhub tier can
// quote (futures themselves are premium). Shared with the Macro page's Commodities
// group and the Daily Update commodities card.
export const COMMODITIES = [
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'SLV', label: 'Silver' },
  { symbol: 'PPLT', label: 'Platinum' },
  { symbol: 'PALL', label: 'Palladium' },
  { symbol: 'CPER', label: 'Copper' },
  { symbol: 'USO', label: 'Crude Oil (WTI)' },
  { symbol: 'BNO', label: 'Brent Crude' },
  { symbol: 'UNG', label: 'Natural Gas' },
  { symbol: 'UGA', label: 'Gasoline' },
  { symbol: 'DBA', label: 'Agriculture' },
  { symbol: 'CORN', label: 'Corn' },
  { symbol: 'URA', label: 'Uranium' },
  { symbol: 'DBC', label: 'Broad Basket' },
];

// Deterministic market-regime read from cross-sectional breadth (no AI, no candles).
export function computeRegime(items) {
  const valid = items.filter((i) => Number.isFinite(i.changePercent) && i.price > 0);
  if (!valid.length) return { label: 'Unknown', breadth: 0, avgChange: 0, advancers: 0, decliners: 0, total: 0 };
  const advancers = valid.filter((i) => i.changePercent > 0).length;
  const decliners = valid.filter((i) => i.changePercent < 0).length;
  const avgChange = valid.reduce((s, i) => s + i.changePercent, 0) / valid.length;
  const breadth = advancers / valid.length; // 0..1
  let label = 'Mixed';
  if (breadth >= 0.66 && avgChange > 0.2) label = 'Risk-on';
  else if (breadth <= 0.34 && avgChange < -0.2) label = 'Risk-off';
  else if (avgChange > 0.4) label = 'Risk-on';
  else if (avgChange < -0.4) label = 'Risk-off';
  return { label, breadth, avgChange, advancers, decliners, total: valid.length };
}

// Cross-sectional movers board (quotes + regime). Cached briefly, but an empty
// result (e.g. a transient Finnhub rate-limit) is NOT cached, so the page keeps
// the last good board instead of showing nothing.
let moversCache = { t: 0, data: null };
export async function getMoversBoard(symbols = MARKET_BASKET, useCache = true) {
  if (useCache && moversCache.data && Date.now() - moversCache.t < 20_000) return moversCache.data;
  const items = (await getWatchlistData(symbols)).filter((i) => i.price > 0);
  const regime = computeRegime(items);
  items.sort((a, b) => b.changePercent - a.changePercent);
  const data = { items, regime };
  // Only cache a reasonably-complete board — a big shortfall usually means a
  // transient rate-limit, and we don't want to pin a partial result for 20s.
  if (useCache && items.length >= Math.ceil(symbols.length * 0.8)) moversCache = { t: Date.now(), data };
  return data;
}

// Commodities board (ETF-proxy day moves). Quotes only — no profiles needed — so
// it's light on the Finnhub budget. Cached 20s; partial results (transient
// rate-limit) are not cached, mirroring the movers board.
let commoditiesCache = { t: 0, data: null };
export async function getCommoditiesBoard() {
  if (commoditiesCache.data && Date.now() - commoditiesCache.t < 20_000) return commoditiesCache.data;
  const out = new Array(COMMODITIES.length);
  let i = 0;
  const worker = async () => {
    while (i < COMMODITIES.length) {
      const idx = i++;
      const c = COMMODITIES[idx];
      const q = await getQuote(c.symbol);
      out[idx] = {
        symbol: c.symbol, label: c.label,
        price: q?.c || 0, change: q?.d || 0, changePercent: q?.dp || 0,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, COMMODITIES.length) }, worker));
  const items = out.filter((x) => x.price > 0).sort((a, b) => b.changePercent - a.changePercent);
  const data = { items };
  if (items.length >= Math.ceil(COMMODITIES.length * 0.8)) commoditiesCache = { t: Date.now(), data };
  return data;
}

const SYSTEM_PROMPT = `You are the market-desk writer for AlphaNote, a markets research dashboard.
Write a short, plain-English "Narrative Pulse" for today's market using ONLY the data provided
(a market-regime read, a list of movers with % changes, and recent headlines).

Rules:
- Lead with one sentence naming the regime and what's driving it.
- Then 3 bullets (each starting with "- ") tying specific movers and/or headlines to the tape.
- End with a line starting "Watch:" naming one thing to monitor next.
- Plain English, no jargon dumps, no markdown headings/code fences.
- Never invent numbers, prices, or facts not in the input. No investment advice.`;

function buildPrompt({ regime, movers, headlines }) {
  const lines = [];
  lines.push(`Market regime: ${regime.label} (breadth ${(regime.breadth * 100).toFixed(0)}% advancing, avg change ${regime.avgChange.toFixed(2)}%, ${regime.advancers} up / ${regime.decliners} down of ${regime.total}).`);
  lines.push('');
  lines.push('Movers (symbol: % change):');
  movers.slice(0, 10).forEach((m) => lines.push(`- ${m.symbol} (${m.name}): ${m.changePercent >= 0 ? '+' : ''}${m.changePercent.toFixed(2)}%`));
  lines.push('');
  if (headlines.length) {
    lines.push('Recent headlines:');
    headlines.slice(0, 6).forEach((h) => lines.push(`- ${h.headline} (${h.source})`));
  } else {
    lines.push('Recent headlines: none available.');
  }
  lines.push('');
  lines.push('Write the Narrative Pulse now.');
  return lines.join('\n');
}

export async function generateMarketBrief() {
  const [items, news] = await Promise.all([
    getWatchlistData(MARKET_BASKET),
    getNews([]).catch(() => []),
  ]);

  const regime = computeRegime(items);
  const movers = [...items]
    .filter((i) => i.price > 0)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  const prompt = buildPrompt({ regime, movers, headlines: news });
  const { provider, text, fellBack } = await callAIWithFallback(prompt, SYSTEM_PROMPT);

  return {
    generatedAt: new Date().toISOString(),
    regime,
    provider,
    fellBack,
    text,
    movers: movers.slice(0, 12),
  };
}
