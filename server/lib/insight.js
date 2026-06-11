// Builds an AI "insight" for a single stock — AlphaNote's senior equity research
// analyst voice: evidence-led, quantified, facts separated from interpretation,
// grounded in ONLY the data provided (quote, news, ratings, EDGAR fundamentals).

import { getQuote, getCompanyProfile, getNews } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { getAnalystRatings } from './analyst.js';
import { getFundamentals } from './fundamentals.js';
import { formatMarketCapValue } from './utils.js';

export const SYSTEM_PROMPT = `You are AlphaNote's senior equity research analyst. You write tight, evidence-led stock briefs for a markets-research dashboard, using ONLY the data provided.

Standards:
- Senior buy-side voice: precise, quantified, no padding and no hype. Plain language over jargon; briefly explain any term a generalist would not know.
- Separate facts from interpretation. Every claim must trace to a number or headline in the input; frame implications as "suggests" or "implies", never as certainty.
- Focus on what actually matters: the one or two drivers material enough to move the investment case, not a laundry list.
- NEVER invent data — no price targets, estimates, or figures that are not in the input. If something important is missing (e.g. no fundamentals), say so plainly.
- Do NOT give buy/sell/hold recommendations, position sizing, or personalised financial advice.
- Plain text only: no markdown headings, no code fences.

Respond in exactly this structure:
1) One sentence: what the stock is doing today and the single most important thing in the data.
2) 3-4 bullet points (each starting with "- "):
   - Price action in context (the day's move vs its range, and what it suggests).
   - Fundamentals: the one or two line items or ratios that drive this name (growth, margins, cash conversion, leverage). If operating cash flow diverges materially from net income, flag it as an earnings-quality question.
   - Sentiment and positioning: what the analyst consensus and news flow imply the market already expects.
   - The key risk visible in the data (only if one is actually visible).
3) A final line starting with "Bottom line:" — one sentence on what a researcher should dig into next (research direction, not advice).`;

// Compact dollar formatting for prompt lines ($12.00B style); EPS stays raw.
// formatMarketCapValue rejects non-positive values, so carry the sign ourselves
// (net income/OCF can be negative for loss-making companies).
const fmtUsd = (v) => {
  if (v == null) return null;
  const sign = v < 0 ? '-' : '';
  return Math.abs(v) >= 1e6 ? `${sign}${formatMarketCapValue(Math.abs(v))}` : `$${v}`;
};

export function buildPrompt({ symbol, quote, profile, news, ratings, fundamentals }) {
  const lines = [];
  lines.push(`Stock symbol: ${symbol}`);
  if (profile?.name) lines.push(`Company: ${profile.name}`);
  if (profile?.finnhubIndustry) lines.push(`Industry: ${profile.finnhubIndustry}`);
  if (profile?.exchange) lines.push(`Exchange: ${profile.exchange}`);
  if (profile?.country) lines.push(`Country: ${profile.country}`);
  if (profile?.marketCapitalization)
    lines.push(`Market cap: ${formatMarketCapValue(profile.marketCapitalization * 1e6)}`);

  if (quote) {
    const cur = profile?.currency || 'USD';
    lines.push('');
    lines.push('Today\'s quote:');
    lines.push(`- Current price: ${quote.c} ${cur}`);
    lines.push(`- Change: ${quote.d} (${quote.dp != null ? quote.dp.toFixed(2) : '0'}%)`);
    lines.push(`- Day range: ${quote.l} – ${quote.h}`);
    lines.push(`- Open: ${quote.o}, Previous close: ${quote.pc}`);
  }

  if (fundamentals?.available) {
    const item = (key) => fundamentals.lineItems.find((li) => li.key === key)?.current;
    const rev = item('revenue');
    const ni = item('netIncome');
    const ocf = item('operatingCashFlow');
    const eps = item('eps');
    lines.push('');
    lines.push(`Fundamentals (${fundamentals.source}; basis as labelled, through ${fundamentals.currentThrough || fundamentals.asOfFY}):`);
    if (rev?.value != null) lines.push(`- Revenue: ${fmtUsd(rev.value)} (${rev.basis})`);
    if (ni?.value != null) lines.push(`- Net income: ${fmtUsd(ni.value)} (${ni.basis})`);
    if (ocf?.value != null) lines.push(`- Operating cash flow: ${fmtUsd(ocf.value)} (${ocf.basis})`);
    if (ocf?.value != null && ni?.value) lines.push(`- OCF / net income: ${(ocf.value / ni.value).toFixed(2)}x (cash conversion; healthy is roughly above 0.8x)`);
    if (eps?.value != null) lines.push(`- Diluted EPS: ${eps.value} (${eps.basis})`);
    for (const r of fundamentals.ratios) lines.push(`- ${r.label}: ${r.value}${r.unit === '%' ? '%' : r.unit === 'x' ? 'x' : ''}`);
  } else {
    lines.push('');
    lines.push('Fundamentals: not available for this listing (no SEC XBRL filings — likely a non-US filer, ETF, or crypto proxy).');
  }

  if (news && news.length) {
    lines.push('');
    lines.push('Recent headlines:');
    news.slice(0, 5).forEach((n) => lines.push(`- ${n.headline} (${n.source})`));
  } else {
    lines.push('');
    lines.push('Recent headlines: none available.');
  }

  if (ratings?.hasCoverage) {
    const l = ratings.latest;
    lines.push('');
    lines.push(`Analyst ratings consensus (${ratings.consensus.total} analysts): ${ratings.consensus.label} — ${l.strongBuy} strong buy, ${l.buy} buy, ${l.hold} hold, ${l.sell} sell, ${l.strongSell} strong sell. (Ratings only; no price targets available.)`);
  }

  lines.push('');
  lines.push('Write the brief now using ONLY the data above.');
  return lines.join('\n');
}

export async function generateStockInsight(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('A stock symbol is required');

  // Gather context (each call is individually fault-tolerant).
  const [quote, profile, news, ratings, fundamentals] = await Promise.all([
    getQuote(sym),
    getCompanyProfile(sym),
    getNews([sym]).catch(() => []),
    getAnalystRatings(sym).catch(() => null),
    getFundamentals(sym).catch(() => null),
  ]);

  if (!quote || quote.c == null || quote.c === 0) {
    // No usable market data — surface a clear, recoverable error.
    const err = new Error(`No market data found for "${sym}". Double-check the ticker symbol.`);
    err.statusCode = 404;
    throw err;
  }

  const prompt = buildPrompt({ symbol: sym, quote, profile, news, ratings, fundamentals });
  const { provider, text, fellBack } = await callAIWithFallback(prompt, SYSTEM_PROMPT);

  return {
    symbol: sym,
    provider,
    fellBack,
    text,
    data: {
      name: profile?.name || sym,
      price: quote.c,
      change: quote.d,
      changePercent: quote.dp,
      currency: profile?.currency || 'USD',
      logo: profile?.logo || '',
    },
  };
}
