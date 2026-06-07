// Macro section — ReturnSignal's "Macro" + grouped market tables (Rates & FX,
// Commodities & Crypto, Equity Indices), built from liquid ETF proxies that the
// free Finnhub tier can quote. Plus a cross-asset tone and an AI macro read.

import { getQuote } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { COMMODITIES } from './brief.js';

export const MACRO_GROUPS = [
  { name: 'Equity Indices', items: [
    { symbol: 'SPY', label: 'S&P 500' }, { symbol: 'QQQ', label: 'Nasdaq 100' },
    { symbol: 'DIA', label: 'Dow Jones' }, { symbol: 'IWM', label: 'Russell 2000' },
  ] },
  { name: 'Rates & Credit', items: [
    { symbol: 'TLT', label: '20Y+ Treasuries' }, { symbol: 'IEF', label: '7–10Y Treasuries' },
    { symbol: 'LQD', label: 'IG Corp Bonds' }, { symbol: 'HYG', label: 'High-Yield Bonds' },
  ] },
  { name: 'FX', items: [
    { symbol: 'UUP', label: 'US Dollar' }, { symbol: 'FXE', label: 'Euro' }, { symbol: 'FXY', label: 'Japanese Yen' },
  ] },
  // Commodities: shared with the Daily Update board (single source of truth).
  { name: 'Commodities', items: COMMODITIES },
  { name: 'Crypto', items: [
    { symbol: 'BITO', label: 'Bitcoin (BITO)' }, { symbol: 'ETHE', label: 'Ethereum (ETHE)' },
  ] },
];

// Run async tasks with a concurrency cap so we never fire all ~18 quote requests
// at once (bursts trip Finnhub's free-tier limiter even when under 60/min).
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, arr.length) }, async () => {
      while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx]); }
    })
  );
  return out;
}

async function fetchBoard() {
  const flat = MACRO_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.name })));
  const quotes = await mapLimit(flat, 4, async (it) => {
    const q = await getQuote(it.symbol);
    return { symbol: it.symbol, label: it.label, group: it.group, price: q?.c || 0, change: q?.d || 0, changePercent: q?.dp || 0 };
  });
  const groups = MACRO_GROUPS.map((g) => ({ name: g.name, items: quotes.filter((q) => q.group === g.name) }));
  return { groups, tone: computeTone(groups) };
}

// Cache the board as a shared in-flight promise so /api/macro and /api/macro/brief
// (fired together on page load) reuse ONE fetch instead of 36 concurrent quote
// calls that would trip Finnhub's free-tier rate limit.
let boardCache = { t: 0, promise: null };
export async function getMacroBoard() {
  const now = Date.now();
  if (boardCache.promise && now - boardCache.t < 20000) return boardCache.promise;
  boardCache = { t: now, promise: fetchBoard() };
  try {
    const board = await boardCache.promise;
    // If any quote came back empty (transient rate-limit), don't keep the partial
    // board cached — let the next request retry the failed symbols.
    const items = board.groups.flatMap((g) => g.items);
    if (items.some((i) => i.price === 0)) boardCache = { t: 0, promise: null };
    return board;
  } catch (e) {
    boardCache = { t: 0, promise: null };
    throw e;
  }
}

function avg(items) {
  const v = items.filter((i) => i.price > 0);
  return v.length ? v.reduce((s, i) => s + i.changePercent, 0) / v.length : 0;
}
function pick(groups, name) { return groups.find((g) => g.name === name)?.items || []; }
function one(groups, sym) {
  for (const g of groups) { const f = g.items.find((i) => i.symbol === sym); if (f) return f.changePercent; }
  return 0;
}

export function computeTone(groups) {
  const equities = avg(pick(groups, 'Equity Indices'));
  const gold = one(groups, 'GLD');
  const tlt = one(groups, 'TLT');
  const hyg = one(groups, 'HYG');
  const dollar = one(groups, 'UUP');
  const oil = one(groups, 'USO');
  let tone = 'Mixed';
  if (equities > 0.2 && hyg >= 0 && tlt <= equities) tone = 'Risk-on';
  else if (equities < -0.2 && (tlt > 0 || gold > 0)) tone = 'Risk-off';
  return { tone, equities, gold, tlt, hyg, dollar, oil };
}

const SYSTEM_PROMPT = `You are the macro strategist for AlphaNote. Write a short "Macro Read" using ONLY the cross-asset data provided (equity indices, rates/credit, FX, commodities, crypto — all as ETF proxies, daily % change).

Rules:
- Lead with one sentence naming the cross-asset tone (risk-on / risk-off / mixed) and the main tension.
- Then 3 bullets (start each with "- ") connecting moves ACROSS asset classes (e.g. equities vs bonds vs the dollar vs gold/oil).
- End with a line starting "Watch:" naming one cross-asset relationship to monitor.
- Plain English. Note these are ETF proxies, not the underlying. No advice, no invented numbers, no markdown headings.`;

function buildPrompt(board) {
  const lines = [`Cross-asset tone (computed): ${board.tone.tone}.`, ''];
  for (const g of board.groups) {
    lines.push(`${g.name}:`);
    g.items.forEach((i) => lines.push(`- ${i.label} (${i.symbol}): ${i.changePercent >= 0 ? '+' : ''}${i.changePercent.toFixed(2)}%`));
    lines.push('');
  }
  lines.push('Write the Macro Read now.');
  return lines.join('\n');
}

export async function generateMacroBrief() {
  const board = await getMacroBoard();
  const { provider, text, fellBack } = await callAIWithFallback(buildPrompt(board), SYSTEM_PROMPT);
  return { generatedAt: new Date().toISOString(), tone: board.tone, provider, fellBack, text };
}
