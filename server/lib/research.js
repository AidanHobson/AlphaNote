// Full AI research note for a single stock — the deep-dive counterpart to the
// quick insight. Gathers everything the app knows about a symbol (quote, news,
// ratings, EDGAR TTM fundamentals + FY history, 1Y price history, insider
// filings) and asks the analyst for a structured, evidence-led note.

import { getQuote, getCompanyProfile, getNews, getNextEarnings } from './finnhub.js';
import { getAnalystRatings } from './analyst.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { getInsiderTransactions } from './insider.js';
import { findSymbolAcrossManagers } from './smartmoney.js';
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
Use the derived multiples when provided (P/E, P/S, P/B, EV/EBITDA, FCF yield — always cite them as "derived"), set them against the 1-year absolute and SPY-relative price move and the fundamental trajectory, and say whether the market appears to be paying for growth, quality, or recovery. If the derived block is missing, say "insufficient data for a valuation view" and move on.

**Sentiment & positioning**
What analyst consensus, news tone, insider activity, and any tracked 13F institutional positions imply is already priced in.

**Scenarios**
Three bullets — Bull, Base, Bear. Each one sentence: what would have to be true, anchored to the drivers above. No invented price targets.

**Risks & catalysts**
Bullets: the key risks visible in the data, and concrete catalysts — when a next earnings date is provided, anchor catalyst timing to it.

Bottom line: one sentence with your analytical view and a conviction score out of 5 (e.g. "cautiously constructive, conviction 3/5"), then the single question a researcher should answer next. This is analysis, not investment advice.

Keep the whole note under 550 words.`;

const fmtUsd = (v) => {
  if (v == null) return null;
  const sign = v < 0 ? '-' : '';
  return Math.abs(v) >= 1e6 ? `${sign}${formatMarketCapValue(Math.abs(v))}` : `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
};

// Multiples computed server-side from market cap + EDGAR TTM figures, so the
// note's valuation section works with real numbers instead of hoping the model
// derives them. Every figure here is labelled "derived" in the prompt.
export function computeValuation(profile, fundamentals) {
  if (!fundamentals?.available || !profile?.marketCapitalization) return null;
  const marketCap = profile.marketCapitalization * 1e6; // Finnhub reports $M
  const cur = (key) => fundamentals.lineItems.find((x) => x.key === key)?.current?.value ?? null;
  const revenue = cur('revenue'); const ni = cur('netIncome'); const ocf = cur('operatingCashFlow');
  const equity = cur('equity'); const cash = cur('cash'); const debt = cur('longTermDebt');
  const opInc = cur('operatingIncome'); const dna = cur('depreciationAmortization'); const capex = cur('capex');

  const ebitda = (opInc != null && dna != null) ? opInc + dna : null;
  const fcf = (ocf != null && capex != null) ? ocf - capex : null;
  const ev = marketCap + (debt ?? 0) - (cash ?? 0);
  const x = (n, d) => (n != null && d != null && d > 0 ? Number((n / d).toFixed(1)) : null);

  return {
    marketCap, ev, ebitda, fcf,
    pe: x(marketCap, ni), ps: x(marketCap, revenue), pb: x(marketCap, equity),
    evEbitda: x(ev, ebitda),
    fcfYield: fcf != null && marketCap ? Number(((fcf / marketCap) * 100).toFixed(1)) : null,
  };
}

export function buildResearchPrompt({ symbol, quote, profile, news, ratings, fundamentals, history, insiders, valuation, nextEarnings, smartMoney, spyStats }) {
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
    if (spyStats?.changePercent != null) {
      const rel = Number((s.changePercent - spyStats.changePercent).toFixed(1));
      lines.push(`- S&P 500 (SPY) over the same period: ${spyStats.changePercent}% → relative performance: ${rel > 0 ? '+' : ''}${rel}pp`);
    }
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
    // Quarterly momentum → sequential acceleration/deceleration is often the story.
    for (const [key, label] of [['revenue', 'Revenue'], ['netIncome', 'Net income']]) {
      const qs = fundamentals.quarterly?.[key];
      if (qs?.length > 1) {
        lines.push(`- ${label} by quarter (period end → value): ${qs.map((p) => `${p.end} ${fmtUsd(p.val)}`).join(', ')}`);
      }
    }
  } else {
    lines.push('');
    lines.push('Fundamentals: not available for this listing (no SEC XBRL filings — likely a non-US filer, ETF, or crypto proxy).');
  }

  if (valuation) {
    const v = valuation;
    lines.push('');
    lines.push('Derived valuation (computed by AlphaNote from market cap + the fundamentals above; cite these as "derived"):');
    lines.push(`- Market cap: ${fmtUsd(v.marketCap)}; Enterprise value: ${fmtUsd(v.ev)} (market cap + long-term debt − cash)`);
    const m = [];
    if (v.pe != null) m.push(`P/E ${v.pe}x`);
    if (v.ps != null) m.push(`P/S ${v.ps}x`);
    if (v.pb != null) m.push(`P/B ${v.pb}x`);
    if (m.length) lines.push(`- Multiples on TTM figures: ${m.join(', ')}`);
    if (v.evEbitda != null) lines.push(`- EV/EBITDA: ${v.evEbitda}x (EBITDA = operating income + D&A = ${fmtUsd(v.ebitda)})`);
    if (v.fcf != null) lines.push(`- Free cash flow (OCF − capex): ${fmtUsd(v.fcf)}${v.fcfYield != null ? `; FCF yield: ${v.fcfYield}%` : ''}`);
  }

  if (nextEarnings?.date) {
    const hour = nextEarnings.hour === 'bmo' ? ' (before market open)' : nextEarnings.hour === 'amc' ? ' (after market close)' : '';
    const eps = nextEarnings.epsEstimate != null ? `; street EPS estimate ${nextEarnings.epsEstimate}` : '';
    lines.push('');
    lines.push(`Next scheduled earnings report: ${nextEarnings.date}${hour}${eps}.`);
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

  if (smartMoney?.length) {
    lines.push('');
    lines.push('Institutional positioning (tracked 13F managers, latest reported quarter):');
    for (const p of smartMoney.slice(0, 6)) {
      const chg = p.change?.type === 'new' ? 'NEW position'
        : p.change?.type === 'add' ? `added ${p.change.sharesPct != null ? `+${p.change.sharesPct}% shares` : 'to position'} QoQ`
        : p.change?.type === 'trim' ? `trimmed ${p.change.sharesPct != null ? `${p.change.sharesPct}% shares` : 'position'} QoQ`
        : 'held flat QoQ';
      lines.push(`- ${p.manager}: ${fmtUsd(p.value)} position (${p.pct}% of portfolio), ${chg} (as of ${p.period})`);
    }
  } else if (smartMoney) {
    lines.push('');
    lines.push(`Institutional positioning: ${symbol} does not appear among the top holdings of any of the tracked 13F managers.`);
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

  const [quote, profile, news, ratings, fundamentals, history, insiderData, nextEarnings, smartMoney, spyHistory] = await Promise.all([
    getQuote(sym),
    getCompanyProfile(sym),
    getNews([sym]).catch(() => []),
    getAnalystRatings(sym).catch(() => null),
    getFundamentals(sym).catch(() => null),
    isEodhdConfigured() ? getPriceHistory(sym).catch(() => null) : Promise.resolve(null),
    getInsiderTransactions().catch(() => null),
    getNextEarnings(sym),
    findSymbolAcrossManagers(sym).catch(() => null),
    isEodhdConfigured() ? getPriceHistory('SPY').catch(() => null) : Promise.resolve(null),
  ]);

  if (!quote || quote.c == null || quote.c === 0) {
    const err = new Error(`No market data found for "${sym}". Double-check the ticker symbol.`);
    err.statusCode = 404;
    throw err;
  }

  const allTxns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const insiders = allTxns.filter((t) => String(t.symbol || '').toUpperCase() === sym);
  const valuation = computeValuation(profile, fundamentals);
  const spyStats = sym !== 'SPY' && spyHistory?.available ? spyHistory.stats : null;

  const prompt = buildResearchPrompt({ symbol: sym, quote, profile, news, ratings, fundamentals, history, insiders, valuation, nextEarnings, smartMoney, spyStats });
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
      hasValuation: Boolean(valuation),
      managers13F: smartMoney?.length ?? 0,
      nextEarnings: nextEarnings?.date || null,
    },
  };
  boundedSet(noteCache, sym, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}
