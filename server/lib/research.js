// Full AI research note for a single stock — the deep-dive counterpart to the
// quick insight. Gathers everything the app knows about a symbol (quote, news,
// ratings, EDGAR TTM fundamentals + FY history, 1Y price history, insider
// filings) and asks the analyst for a structured, evidence-led note.

import { getQuote, getCompanyProfile, getNews } from './finnhub.js';
import { getAnalystRatings } from './analyst.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { getInsiderTransactions } from './insider.js';
import { callAIWithFallback } from './ai-provider.js';
import { formatMarketCapValue, boundedSet } from './utils.js';

export const SYSTEM_PROMPT = `You are AlphaNote's senior equity research analyst writing a full research note for a markets-research dashboard, using ONLY the data provided.

Standards:
- Senior buy-side voice: precise, quantified, evidence-led, no padding. Plain language over jargon; briefly explain any term a generalist would not know.
- Separate facts from interpretation. Every claim must trace to a number or headline in the input; frame implications as "suggests" or "implies".
- NEVER invent data. No price targets, estimates, or figures not present in or directly derivable from the input. If you derive a figure (e.g. an implied P/E from market cap and EPS), label it "derived". Where data is missing, write "insufficient data" rather than guessing.
- The note expresses an analytical view, NOT advice: no position sizing, no personalised recommendations.

Write the note in exactly this structure (plain text; section titles as bold lines, bullets starting with "- "):

**Snapshot**
Two or three sentences: what the company is, where the stock stands today, and the single most important thing in the data.

**What matters**
The 2-3 drivers material enough to move the investment case. For each: one bullet naming the driver, why it is material, and what the data suggests the market currently assumes about it. Skip anything that is merely interesting.

**Fundamentals & earnings quality**
Bullets on the trajectory (use the fiscal-year history), current TTM profitability, and cash conversion. If operating cash flow diverges materially from net income (below roughly 0.8x), flag it as an earnings-quality question; if it is healthy, say so in one clause.

**Valuation context**
Only what the data supports: derived multiples (label them), the 1-year price move vs the fundamental trajectory, and whether the market appears to be paying for growth, quality, or recovery. If there is not enough to say anything grounded, say "insufficient data for a valuation view" and move on.

**Sentiment & positioning**
What analyst consensus, news tone, and any insider activity imply is already priced in.

**Scenarios**
Three bullets — Bull, Base, Bear. Each one sentence: what would have to be true, anchored to the drivers above. No invented price targets.

**Risks & catalysts**
Bullets: the key risks visible in the data, and any catalysts the news flow points to.

Bottom line: one sentence with your analytical view and a conviction score out of 5 (e.g. "cautiously constructive, conviction 3/5"), then the single question a researcher should answer next. This is analysis, not investment advice.

Keep the whole note under 550 words.`;

const fmtUsd = (v) => {
  if (v == null) return null;
  const sign = v < 0 ? '-' : '';
  return Math.abs(v) >= 1e6 ? `${sign}${formatMarketCapValue(Math.abs(v))}` : `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
};

export function buildResearchPrompt({ symbol, quote, profile, news, ratings, fundamentals, history, insiders }) {
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
    lines.push("Today's quote:");
    lines.push(`- Current price: ${quote.c} ${cur}`);
    lines.push(`- Change: ${quote.d} (${quote.dp != null ? quote.dp.toFixed(2) : '0'}%)`);
    lines.push(`- Day range: ${quote.l} – ${quote.h}`);
  }

  if (history?.available && history.stats) {
    const s = history.stats;
    lines.push('');
    lines.push(`Price history (${history.source}; ${s.first} → ${s.last}):`);
    lines.push(`- 1-year change: ${s.changePercent}%`);
    lines.push(`- 52-week range: ${s.low} – ${s.high} (last close ${s.lastClose})`);
  }

  if (fundamentals?.available) {
    const li = (key) => fundamentals.lineItems.find((x) => x.key === key);
    const cur = (key) => li(key)?.current;
    const rev = cur('revenue'); const ni = cur('netIncome'); const ocf = cur('operatingCashFlow'); const eps = cur('eps');
    lines.push('');
    lines.push(`Fundamentals (${fundamentals.source}; basis as labelled, through ${fundamentals.currentThrough || fundamentals.asOfFY}):`);
    if (rev?.value != null) lines.push(`- Revenue: ${fmtUsd(rev.value)} (${rev.basis})`);
    if (ni?.value != null) lines.push(`- Net income: ${fmtUsd(ni.value)} (${ni.basis})`);
    if (ocf?.value != null) lines.push(`- Operating cash flow: ${fmtUsd(ocf.value)} (${ocf.basis})`);
    if (ocf?.value != null && ni?.value) lines.push(`- OCF / net income: ${(ocf.value / ni.value).toFixed(2)}x (cash conversion)`);
    if (eps?.value != null) lines.push(`- Diluted EPS: ${eps.value} (${eps.basis})`);
    for (const r of fundamentals.ratios) lines.push(`- ${r.label}: ${r.value}${r.unit === '%' ? '%' : r.unit === 'x' ? 'x' : ''}`);
    // Fiscal-year history → the trajectory the note should reason about.
    for (const key of ['revenue', 'netIncome', 'operatingCashFlow', 'eps']) {
      const item = li(key);
      if (item?.history?.length > 1) {
        const fmt = key === 'eps' ? (v) => v : fmtUsd;
        lines.push(`- ${item.label} by fiscal year: ${item.history.map((p) => `FY${p.fy} ${fmt(p.val)}`).join(', ')}`);
      }
    }
  } else {
    lines.push('');
    lines.push('Fundamentals: not available for this listing (no SEC XBRL filings — likely a non-US filer, ETF, or crypto proxy).');
  }

  if (news && news.length) {
    lines.push('');
    lines.push('Recent headlines:');
    news.slice(0, 6).forEach((n) => lines.push(`- ${n.headline} (${n.source})`));
  } else {
    lines.push('');
    lines.push('Recent headlines: none available.');
  }

  if (ratings?.hasCoverage) {
    const l = ratings.latest;
    lines.push('');
    lines.push(`Analyst ratings consensus (${ratings.consensus.total} analysts): ${ratings.consensus.label} — ${l.strongBuy} strong buy, ${l.buy} buy, ${l.hold} hold, ${l.sell} sell, ${l.strongSell} strong sell. (Ratings only; no price targets available.)`);
  }

  if (insiders?.length) {
    lines.push('');
    lines.push(`Recent insider Form 4 filings for ${symbol} (open-market only):`);
    insiders.slice(0, 5).forEach((t) => {
      const val = t.value ? ` ~${fmtUsd(t.value)}` : '';
      lines.push(`- ${t.insider || 'Insider'}${t.title ? ` (${t.title})` : ''}: ${t.side}${val}${t.transactionDate ? ` on ${t.transactionDate}` : ''}`);
    });
  } else {
    lines.push('');
    lines.push('Recent insider filings: none for this symbol in the current market-wide window.');
  }

  lines.push('');
  lines.push('Write the research note now using ONLY the data above.');
  return lines.join('\n');
}

// Notes are expensive (long AI generation), so cache per symbol for an hour;
// "Regenerate" in the UI passes force=true to bypass.
const noteCache = new Map();
const NOTE_TTL = 3600_000;

export async function generateResearchNote(symbol, { force = false } = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('A stock symbol is required');
  if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) throw new Error('Invalid symbol.');

  const hit = noteCache.get(sym);
  if (!force && hit && Date.now() - hit.t < NOTE_TTL) return { ...hit.note, cached: true };

  const [quote, profile, news, ratings, fundamentals, history, insiderData] = await Promise.all([
    getQuote(sym),
    getCompanyProfile(sym),
    getNews([sym]).catch(() => []),
    getAnalystRatings(sym).catch(() => null),
    getFundamentals(sym).catch(() => null),
    isEodhdConfigured() ? getPriceHistory(sym).catch(() => null) : Promise.resolve(null),
    getInsiderTransactions().catch(() => null),
  ]);

  if (!quote || quote.c == null || quote.c === 0) {
    const err = new Error(`No market data found for "${sym}". Double-check the ticker symbol.`);
    err.statusCode = 404;
    throw err;
  }

  const allTxns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const insiders = allTxns.filter((t) => String(t.symbol || '').toUpperCase() === sym);

  const prompt = buildResearchPrompt({ symbol: sym, quote, profile, news, ratings, fundamentals, history, insiders });
  // A full note runs ~550 words; give the model ample output budget so it never truncates mid-section.
  const { provider, text, fellBack } = await callAIWithFallback(prompt, SYSTEM_PROMPT, { maxTokens: 1600 });

  const note = {
    symbol: sym,
    provider,
    fellBack,
    text,
    generatedAt: new Date().toISOString(),
    data: {
      name: profile?.name || sym,
      price: quote.c,
      change: quote.d,
      changePercent: quote.dp,
      currency: profile?.currency || 'USD',
      logo: profile?.logo || '',
      hasFundamentals: Boolean(fundamentals?.available),
      hasHistory: Boolean(history?.available),
      insiderCount: insiders.length,
    },
  };
  boundedSet(noteCache, sym, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}
