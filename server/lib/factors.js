// Factors section — ReturnSignal's "Factors". Tracks equity style factors via
// liquid factor-ETF proxies, plus long/short factor SPREADS that reveal rotation.

import { getQuote } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';

export const FACTORS = [
  { symbol: 'MTUM', label: 'Momentum' },
  { symbol: 'VLUE', label: 'Value' },
  { symbol: 'IWF', label: 'Growth' },
  { symbol: 'QUAL', label: 'Quality' },
  { symbol: 'USMV', label: 'Low Volatility' },
  { symbol: 'SPHB', label: 'High Beta' },
  { symbol: 'VYM', label: 'High Dividend' },
  { symbol: 'IWM', label: 'Small Cap' },
  { symbol: 'RSP', label: 'Equal Weight' },
];

// Long/short tilts (difference of daily % changes) — the factor-rotation signal.
const SPREADS = [
  { label: 'Value − Growth', long: 'VLUE', short: 'IWF' },
  { label: 'Small − Large', long: 'IWM', short: 'SPY' },
  { label: 'High Beta − Low Vol', long: 'SPHB', short: 'USMV' },
  { label: 'Momentum − Market', long: 'MTUM', short: 'SPY' },
  { label: 'Equal − Cap Weight', long: 'RSP', short: 'SPY' },
  { label: 'Quality − Market', long: 'QUAL', short: 'SPY' },
];

const ALL_SYMBOLS = [...new Set([...FACTORS.map((f) => f.symbol), 'SPY', 'USMV', 'IWF'])];

// Concurrency cap so we don't fire all quote requests at once (rate-limit safe).
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx]); }
  }));
  return out;
}

async function fetchBoard() {
  const quotes = await mapLimit(ALL_SYMBOLS, 4, async (sym) => {
    const q = await getQuote(sym);
    return [sym, q?.dp || 0, q?.c || 0];
  });
  const dp = Object.fromEntries(quotes.map(([s, d]) => [s, d]));
  const px = Object.fromEntries(quotes.map(([s, , c]) => [s, c]));

  const factors = FACTORS.map((f) => ({ symbol: f.symbol, label: f.label, changePercent: dp[f.symbol], price: px[f.symbol] }))
    .sort((a, b) => b.changePercent - a.changePercent);
  const spreads = SPREADS.map((s) => ({ label: s.label, long: s.long, short: s.short, value: dp[s.long] - dp[s.short] }))
    .sort((a, b) => b.value - a.value);

  const leader = factors[0];
  const laggard = factors[factors.length - 1];
  return { factors, spreads, leader, laggard, market: dp['SPY'], anyZero: quotes.some(([, , c]) => c === 0) };
}

let cache = { t: 0, promise: null };
export async function getFactorBoard() {
  const now = Date.now();
  if (cache.promise && now - cache.t < 20000) return cache.promise;
  cache = { t: now, promise: fetchBoard() };
  try {
    const board = await cache.promise;
    if (board.anyZero) cache = { t: 0, promise: null }; // don't keep a partial board cached
    return board;
  } catch (e) {
    cache = { t: 0, promise: null };
    throw e;
  }
}

const SYSTEM_PROMPT = `You are the quant factor strategist for AlphaNote. Write a short "Factor Read" using ONLY the data provided: today's % change for equity style factors (via factor-ETF proxies) and long/short factor spreads (e.g. Value−Growth, Small−Large, High Beta−Low Vol).

Rules:
- Lead with one sentence naming which factors are in/out of favor today and what that rotation implies.
- Then 3 bullets connecting the single-factor moves and the spreads into a coherent rotation story (e.g. value over growth + small over large = a reflation/cyclical tilt).
- End with a line starting "Watch:" naming one factor spread to monitor.
- Plain English. Note these are ETF proxies. No advice, no invented numbers, no markdown headings.`;

function buildPrompt(board) {
  const lines = ['Single factors (today %):'];
  board.factors.forEach((f) => lines.push(`- ${f.label} (${f.symbol}): ${f.changePercent >= 0 ? '+' : ''}${f.changePercent.toFixed(2)}%`));
  lines.push('', 'Factor spreads (long − short, % points):');
  board.spreads.forEach((s) => lines.push(`- ${s.label}: ${s.value >= 0 ? '+' : ''}${s.value.toFixed(2)}`));
  lines.push('', `Market (SPY): ${board.market >= 0 ? '+' : ''}${board.market.toFixed(2)}%`, '', 'Write the Factor Read now.');
  return lines.join('\n');
}

export async function generateFactorBrief() {
  const board = await getFactorBoard();
  const { provider, text, fellBack } = await callAIWithFallback(buildPrompt(board), SYSTEM_PROMPT);
  return { generatedAt: new Date().toISOString(), leader: board.leader, laggard: board.laggard, provider, fellBack, text };
}
