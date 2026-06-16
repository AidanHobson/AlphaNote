// Full AI research note for a single stock — the deep-dive counterpart to the
// quick insight. Gathers everything the app knows about a symbol (quote, news,
// ratings, EDGAR TTM fundamentals + FY history, 1Y price history, insider
// filings) and asks the analyst for a structured, evidence-led note.

import { getQuote, getCompanyProfile, getNews, getNextEarnings, getBasicFinancials, getEarningsSurprises } from './finnhub.js';
import { getAnalystRatings } from './analyst.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { getInsiderTransactions } from './insider.js';
import { findSymbolAcrossManagers } from './smartmoney.js';
import { scoreInsiderActivity, insiderScoreLine, peerCompLines } from './analytics.js';
import { getPeerComps } from './peers.js';
import { getFilingResearch } from './filings.js';
import { callAIWithFallback } from './ai-provider.js';
import { formatMarketCapValue, fmtUsd, boundedSet } from './utils.js';

export const SYSTEM_PROMPT = `You are AlphaNote's senior equity research analyst writing a full research note for a markets-research dashboard, using ONLY the data provided.

Standards:
- Senior buy-side voice: precise, quantified, evidence-led, no padding. Plain language over jargon; briefly explain any term a generalist would not know.
- Separate facts from interpretation. Every claim must trace to a number or headline in the input; frame implications as "suggests" or "implies".
- NEVER invent data. No price targets, estimates, or figures not present in or directly derivable from the input. If you derive a figure (e.g. an implied P/E from market cap and EPS), label it "derived". Where data is missing, write "insufficient data" rather than guessing.
- When SEC filing excerpts are provided, treat them as primary source: prefer management's own words over headlines for the business narrative, quote sparingly and verbatim, cite the form and filing date (e.g. "(10-Q, 2026-05-01)"), and never claim or imply you have read the full filing — they are excerpts.
- The note expresses an analytical view, NOT advice: no position sizing, no personalised recommendations.

Write the note in exactly this structure (plain text; section titles as bold lines, bullets starting with "- "):

**Snapshot**
Two or three sentences: what the company is, where the stock stands today, and the single most important thing in the data.

**What matters**
The 2-3 drivers material enough to move the investment case. For each: one bullet naming the driver, why it is material, and what the data suggests the market currently assumes about it. Skip anything that is merely interesting.

**Fundamentals & earnings quality**
Bullets on the trajectory (use the fiscal-year history), current TTM profitability, and cash conversion. If operating cash flow diverges materially from net income (below roughly 0.8x), flag it as an earnings-quality question; if it is healthy, say so in one clause. Bring in the return profile (ROE/ROIC) and whether margins are above or below their 5-year average (expanding vs compressing). When an earnings-surprise history is provided, state the beat/miss track record and whether the bar looks high or low going into the next print.

**Valuation context**
Use the multiples when provided: the AlphaNote-derived block (P/E, P/S, P/B, EV/EBITDA, FCF yield — always cite as "derived") AND the market block (trailing P/E, forward P/E, PEG — cite as "market"). Anchor the read on three things: the trailing P/E (what the market pays today), the forward P/E versus trailing (what it expects earnings to do), and the PEG (whether the price is justified by the growth — flag a PEG well above 1 as paying up, and don't trust a low PEG if the growth looks one-off). Set all of it against the 1-year absolute and SPY-relative price move and the fundamental trajectory, and say whether the market appears to be paying for growth, quality, or recovery. Factor in where the price sits in its 52-week range, its relative strength versus the S&P 500, and the dividend yield/payout if any. If both blocks are missing, say "insufficient data for a valuation view" and move on.

**Peer comparables**
When peer multiples are provided, render a short markdown table — | Ticker | P/E | P/S | EV/EBITDA | — with the subject and its peers, then one line on whether the subject trades at a premium or discount to the set and what that implies. All figures are derived; if no peer data is provided, omit this section.

**Sentiment & positioning**
What analyst consensus, news tone, the scored insider signal (weight a multi-insider cluster or officer/director buying more than a lone filing), and any tracked 13F institutional positions imply is already priced in.

**Scenarios**
Three bullets — Bull, Base, Bear. Each one sentence: what would have to be true, anchored to the drivers above. No invented price targets.

**Risks & catalysts**
Bullets: the key risks visible in the data, and concrete catalysts — when a next earnings date is provided, anchor catalyst timing to it. When Risk Factors or 8-K items are provided, draw the named risks and catalysts from them and cite the form + date (e.g. a 5.02 officer departure or a 2.02 earnings release is a dated, concrete event).

Bottom line: one sentence with your analytical view and a conviction score out of 5 (e.g. "cautiously constructive, conviction 3/5"), then the single question a researcher should answer next. This is analysis, not investment advice.

Keep the whole note under 600 words — be selective: more inputs are provided than will fit, so lead with what is material and leave the rest.`;


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

// Market-based valuation multiples from Finnhub basic financials. Distinct from
// computeValuation's SEC-derived block: forward P/E and PEG use consensus
// estimates, so the note can contrast what the market PAYS today (trailing P/E)
// with what it EXPECTS (forward P/E) and the price of that growth (PEG). Returns
// null when the listing has no usable metrics (common for ADRs / ETFs).
export function marketMultiples(metric) {
  if (!metric) return null;
  const num = (v) => (Number.isFinite(v) ? Number(Number(v).toFixed(2)) : null);
  const out = {
    pe: num(metric.peTTM ?? metric.peBasicExclExtraTTM),
    forwardPE: num(metric.forwardPE),
    peg: num(metric.pegTTM),
    forwardPeg: num(metric.forwardPEG),
    epsTTM: num(metric.epsTTM),
    epsGrowthTTMYoy: num(metric.epsGrowthTTMYoy),
    epsGrowth5Y: num(metric.epsGrowth5Y),
    revenueGrowthTTMYoy: num(metric.revenueGrowthTTMYoy),
  };
  if (out.pe == null && out.forwardPE == null && out.peg == null && out.forwardPeg == null) return null;
  return out;
}

// A curated, high-signal subset of Finnhub's basic-financials blob (already
// fetched for the multiples). These fill real gaps the SEC-derived block does
// not cover: the return profile (ROE/ROA/ROIC), margin TREND (TTM vs 5Y avg),
// balance-sheet health, capital return, and market profile (beta, 52-week range,
// relative strength). Zero extra API calls. Returns null when nothing is usable.
export function companyMetrics(metric) {
  if (!metric) return null;
  const n = (v) => (Number.isFinite(v) ? Number(Number(v).toFixed(2)) : null);
  const out = {
    roeTTM: n(metric.roeTTM), roe5Y: n(metric.roe5Y), roaTTM: n(metric.roaTTM), roiTTM: n(metric.roiTTM),
    grossMarginTTM: n(metric.grossMarginTTM), grossMargin5Y: n(metric.grossMargin5Y),
    operatingMarginTTM: n(metric.operatingMarginTTM), operatingMargin5Y: n(metric.operatingMargin5Y),
    netMarginTTM: n(metric.netProfitMarginTTM), netMargin5Y: n(metric.netProfitMargin5Y),
    currentRatio: n(metric.currentRatioQuarterly ?? metric.currentRatioAnnual),
    debtToEquity: n(metric['totalDebt/totalEquityQuarterly'] ?? metric['totalDebt/totalEquityAnnual']),
    interestCoverage: n(metric.netInterestCoverageTTM ?? metric.netInterestCoverageAnnual),
    dividendYield: n(metric.currentDividendYieldTTM ?? metric.dividendYieldIndicatedAnnual),
    payoutRatio: n(metric.payoutRatioTTM ?? metric.payoutRatioAnnual),
    dividendGrowth5Y: n(metric.dividendGrowthRate5Y),
    beta: n(metric.beta),
    high52w: n(metric['52WeekHigh']), low52w: n(metric['52WeekLow']),
    priceReturn52w: n(metric['52WeekPriceReturnDaily']),
    relToSpy52w: n(metric['priceRelativeToS&P50052Week']),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// Where the last price sits within the 52-week range, as a 0-100% position.
export function rangePosition(price, low, high) {
  if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  return Math.round(Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100)));
}

export function buildResearchPrompt({ symbol, quote, profile, news, ratings, fundamentals, history, insiders, valuation, marketMult, keyMetrics, surprises, nextEarnings, smartMoney, spyStats, peerComps, filings }) {
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

  if (marketMult) {
    const mm = marketMult;
    lines.push('');
    lines.push('Market valuation multiples (Finnhub; these are market/consensus figures, NOT AlphaNote-derived — cite them as "market"):');
    if (mm.pe != null) lines.push(`- Trailing P/E (TTM): ${mm.pe}x${mm.epsTTM != null ? ` on TTM EPS ${mm.epsTTM}` : ''}`);
    if (mm.forwardPE != null) lines.push(`- Forward P/E: ${mm.forwardPE}x (on consensus forward EPS; a forward P/E below the trailing P/E means the market expects EPS to grow, and by roughly how much)`);
    if (mm.peg != null) lines.push(`- PEG (trailing): ${mm.peg} (trailing P/E ÷ earnings-growth rate; ~1 is fairly priced for its growth, >1 is paying up, <1 is cheap relative to growth — only trust it if the growth looks durable)`);
    if (mm.forwardPeg != null) lines.push(`- PEG (forward): ${mm.forwardPeg} (uses consensus forward growth)`);
    const g = [];
    if (mm.epsGrowthTTMYoy != null) g.push(`EPS TTM YoY ${mm.epsGrowthTTMYoy}%`);
    if (mm.epsGrowth5Y != null) g.push(`EPS 5Y CAGR ${mm.epsGrowth5Y}%`);
    if (mm.revenueGrowthTTMYoy != null) g.push(`revenue TTM YoY ${mm.revenueGrowthTTMYoy}%`);
    if (g.length) lines.push(`- Growth context behind the PEG: ${g.join(', ')}`);
  }

  if (keyMetrics) {
    const k = keyMetrics;
    lines.push('');
    lines.push('Key metrics (Finnhub basic financials; TTM unless noted — use these for the return profile, the margin TREND, balance-sheet health, capital return, and relative strength):');
    const ret = [];
    if (k.roeTTM != null) ret.push(`ROE ${k.roeTTM}%${k.roe5Y != null ? ` (5Y avg ${k.roe5Y}%)` : ''}`);
    if (k.roaTTM != null) ret.push(`ROA ${k.roaTTM}%`);
    if (k.roiTTM != null) ret.push(`ROIC ${k.roiTTM}%`);
    if (ret.length) lines.push(`- Returns: ${ret.join(', ')}`);
    const mar = [];
    if (k.grossMarginTTM != null) mar.push(`gross ${k.grossMarginTTM}%${k.grossMargin5Y != null ? ` vs 5Y ${k.grossMargin5Y}%` : ''}`);
    if (k.operatingMarginTTM != null) mar.push(`operating ${k.operatingMarginTTM}%${k.operatingMargin5Y != null ? ` vs 5Y ${k.operatingMargin5Y}%` : ''}`);
    if (k.netMarginTTM != null) mar.push(`net ${k.netMarginTTM}%${k.netMargin5Y != null ? ` vs 5Y ${k.netMargin5Y}%` : ''}`);
    if (mar.length) lines.push(`- Margins (TTM vs 5-year average → expanding or compressing): ${mar.join('; ')}`);
    const bs = [];
    if (k.currentRatio != null) bs.push(`current ratio ${k.currentRatio}`);
    if (k.debtToEquity != null) bs.push(`debt/equity ${k.debtToEquity}`);
    if (k.interestCoverage != null) bs.push(`interest coverage ${k.interestCoverage}x`);
    if (bs.length) lines.push(`- Balance sheet: ${bs.join(', ')}`);
    if (k.dividendYield != null && k.dividendYield > 0) {
      lines.push(`- Capital return: dividend yield ${k.dividendYield}%${k.payoutRatio != null ? `, payout ${k.payoutRatio}%` : ''}${k.dividendGrowth5Y != null ? `, 5Y dividend growth ${k.dividendGrowth5Y}%` : ''}`);
    } else if (k.dividendYield === 0) {
      lines.push('- Capital return: pays no dividend.');
    }
    const mkt = [];
    if (k.beta != null) mkt.push(`beta ${k.beta}`);
    const rp = rangePosition(quote?.c, k.low52w, k.high52w);
    if (k.low52w != null && k.high52w != null) mkt.push(`52-week range ${k.low52w}–${k.high52w}${rp != null ? ` (now at ${rp}% of range)` : ''}`);
    if (k.priceReturn52w != null) mkt.push(`52-week price return ${k.priceReturn52w}%`);
    if (k.relToSpy52w != null) mkt.push(`relative to S&P 500 over 52 weeks: ${k.relToSpy52w > 0 ? '+' : ''}${k.relToSpy52w}pp`);
    if (mkt.length) lines.push(`- Market profile: ${mkt.join(', ')}`);
  }

  if (surprises?.length) {
    lines.push('');
    lines.push('Earnings surprise history (reported EPS vs consensus estimate, most recent first):');
    for (const s of surprises) {
      const tag = s.surprisePercent == null ? '' : ` → ${s.surprisePercent >= 0 ? 'beat' : 'miss'} ${s.surprisePercent >= 0 ? '+' : ''}${s.surprisePercent}%`;
      const label = s.quarter && s.year ? `Q${s.quarter} ${s.year}` : s.period;
      lines.push(`- ${label} (${s.period}): actual ${s.actual} vs est ${s.estimate}${tag}`);
    }
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

  if (filings?.available || filings?.periodic || filings?.events?.length) {
    lines.push('');
    lines.push('From the SEC filings (primary source via EDGAR — quote management verbatim where it sharpens a point and cite the form + date; each is an EXCERPT, not the full filing, so do not infer beyond it):');
    if (filings.periodic) {
      const p = filings.periodic;
      lines.push(`- Latest periodic report: ${p.form} filed ${p.filingDate}.`);
      if (p.mdna) lines.push(`  MD&A excerpt: "${p.mdna.slice(0, 1600)}"`);
      if (p.riskFactors) lines.push(`  Risk Factors excerpt: "${p.riskFactors.slice(0, 1100)}"`);
    }
    for (const ev of filings.events || []) {
      lines.push(`- ${ev.form} filed ${ev.filingDate}: ${ev.items.join('; ') || 'material event'}.`);
      if (ev.excerpt) lines.push(`  Excerpt: "${ev.excerpt.slice(0, 450)}"`);
    }
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

  const peerLines = peerCompLines(peerComps || []);
  if (peerLines.length) { lines.push(''); lines.push(...peerLines); }

  if (insiders?.length) {
    const score = scoreInsiderActivity(insiders);
    lines.push('');
    lines.push(insiderScoreLine(score, symbol));
    insiders.slice(0, 4).forEach((t) => {
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

export async function generateResearchNote(symbol, { force = false, onDelta } = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('A stock symbol is required');
  if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) throw new Error('Invalid symbol.');

  const hit = noteCache.get(sym);
  if (!force && hit && Date.now() - hit.t < NOTE_TTL) return { ...hit.note, cached: true };

  const [quote, profile, news, ratings, fundamentals, history, insiderData, nextEarnings, smartMoney, spyHistory, metric, surprises] = await Promise.all([
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
    getBasicFinancials(sym).catch(() => null),
    getEarningsSurprises(sym).catch(() => []),
  ]);

  if (!quote || quote.c == null || quote.c === 0) {
    const err = new Error(`No market data found for "${sym}". Double-check the ticker symbol.`);
    err.statusCode = 404;
    throw err;
  }

  const allTxns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const insiders = allTxns.filter((t) => String(t.symbol || '').toUpperCase() === sym);
  const valuation = computeValuation(profile, fundamentals);
  const marketMult = marketMultiples(metric);
  const keyMetrics = companyMetrics(metric);
  const spyStats = sym !== 'SPY' && spyHistory?.available ? spyHistory.stats : null;
  // Relative-valuation context + SEC filing narrative (both best-effort; peer
  // multiples are cached/free, the filing read needs the CIK from fundamentals).
  const [peerComps, filings] = await Promise.all([
    getPeerComps(sym, profile).catch(() => []),
    fundamentals?.cik ? getFilingResearch(fundamentals.cik).catch(() => null) : Promise.resolve(null),
  ]);

  const prompt = buildResearchPrompt({ symbol: sym, quote, profile, news, ratings, fundamentals, history, insiders, valuation, marketMult, keyMetrics, surprises, nextEarnings, smartMoney, spyStats, peerComps, filings });
  // A full note runs ~550 words; give the model ample output budget so it never truncates mid-section.
  const { provider, text, fellBack } = await callAIWithFallback(prompt, SYSTEM_PROMPT, { maxTokens: 1600, onDelta });

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
      valuationMultiples: marketMult
        ? { pe: marketMult.pe, forwardPE: marketMult.forwardPE, peg: marketMult.peg, forwardPeg: marketMult.forwardPeg }
        : null,
      keyStats: keyMetrics
        ? {
            roe: keyMetrics.roeTTM, dividendYield: keyMetrics.dividendYield, beta: keyMetrics.beta,
            low52w: keyMetrics.low52w, high52w: keyMetrics.high52w,
            range52wPct: rangePosition(quote.c, keyMetrics.low52w, keyMetrics.high52w),
          }
        : null,
      managers13F: smartMoney?.length ?? 0,
      nextEarnings: nextEarnings?.date || null,
      peerCount: Math.max(0, (peerComps?.length ?? 0) - 1),
      insiderSignal: insiders.length ? scoreInsiderActivity(insiders).label : null,
      filings: filings?.available
        ? {
            periodic: filings.periodic
              ? { form: filings.periodic.form, date: filings.periodic.filingDate, mdna: Boolean(filings.periodic.mdna), riskFactors: Boolean(filings.periodic.riskFactors) }
              : null,
            events: (filings.events || []).map((e) => ({ form: e.form, date: e.filingDate, items: e.items })),
          }
        : null,
    },
  };
  boundedSet(noteCache, sym, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}
