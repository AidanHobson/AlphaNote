// Builds an AI "insight" for a single stock from live Finnhub data.
// Tone mirrors the original OpenStock email prompts: plain English, accessible,
// grounded in the data provided, ending with a "Bottom line".

import { getQuote, getCompanyProfile, getNews } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { getAnalystRatings } from './analyst.js';
import { formatMarketCapValue } from './utils.js';

const SYSTEM_PROMPT = `You are a concise, plain-English market explainer for OpenStock, an open-source stock app.
You help everyday investors quickly understand a stock using ONLY the data you are given.

Rules:
- Use simple, accessible language. Avoid jargon; when you must use a term, explain it briefly.
- Be specific: reference the actual numbers provided (price, % change, market cap, news).
- NEVER invent data, price targets, earnings figures, or facts not present in the input.
- Do NOT give buy/sell/hold recommendations or financial advice.
- Keep it tight. No preamble, no markdown headings, no code fences.

Respond in exactly this structure (plain text):
1) One short summary sentence about how the stock is doing today.
2) 3 bullet points (each starting with "- ") covering price action, the company/sector, and what the recent news suggests.
3) A final line starting with "Bottom line:" — one sentence a beginner can act on for their own research (not advice).`;

function buildPrompt({ symbol, quote, profile, news, ratings }) {
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
  lines.push('Write the insight now using ONLY the data above.');
  return lines.join('\n');
}

export async function generateStockInsight(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('A stock symbol is required');

  // Gather context (each call is individually fault-tolerant).
  const [quote, profile, news, ratings] = await Promise.all([
    getQuote(sym),
    getCompanyProfile(sym),
    getNews([sym]).catch(() => []),
    getAnalystRatings(sym).catch(() => null),
  ]);

  if (!quote || quote.c == null || quote.c === 0) {
    // No usable market data — surface a clear, recoverable error.
    const err = new Error(`No market data found for "${sym}". Double-check the ticker symbol.`);
    err.statusCode = 404;
    throw err;
  }

  const prompt = buildPrompt({ symbol: sym, quote, profile, news, ratings });
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
