// Market "Narrative Pulse" — AlphaNote's hybrid of ReturnSignal's narrative-pulse
// card and OpenStock's Claude→Gemini AI. Summarises the day's news + movers into
// a short, plain-English market brief.

import { getWatchlistData, getNews } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { POPULAR_STOCK_SYMBOLS } from './constants.js';

// A representative basket used for breadth/regime + the movers table.
export const MARKET_BASKET = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX',
  'JPM', 'BAC', 'V', 'WMT', 'XOM', 'AMD', 'CRM', 'ORCL',
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
