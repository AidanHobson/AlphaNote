// Monopoly research — structural monopolists and near-monopolists in niche,
// critical, or emerging markets, across ALL market caps (the under-followed
// sub-$5B tier explicitly included). Two engines:
//   - generateMonopolyNote(ticker): the full 8-section profile, grounded in
//     the app's live data stack (quote, EDGAR fundamentals, derived multiples,
//     SPY-relative price action, insiders, 13F, FINRA short volume, pulse).
//   - generateMonopolyRadar(): discovery — candidates per cap tier with the
//     archetype taxonomy, honesty rails, and a mandatory small/micro quota.

import { getQuote, getCompanyProfile, getNextEarnings } from './finnhub.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { computeValuation } from './research.js';
import { getSocialPulse, socialPulseToLines } from './social.js';
import { getInsiderTransactions } from './insider.js';
import { findSymbolAcrossManagers } from './smartmoney.js';
import { shortVolFor } from './shortvol.js';
import { marketSnippetLines } from './websearch.js';
import { scoreInsiderActivity, insiderScoreLine } from './analytics.js';
import { callAIWithFallback } from './ai-provider.js';
import { formatMarketCapValue, fmtUsd, boundedSet } from './utils.js';

const TAXONOMY = `Monopoly archetypes (classify against these):
1. TECHNICAL — sole/dominant supplier of a technology with no viable substitute (ASML in EUV lithography).
2. SPECTRUM/REGULATORY — exclusive government-granted licence or spectrum that structurally excludes competition (Anterix's 900 MHz private broadband).
3. NETWORK/DATA — platform, dataset, or network effect with prohibitive displacement cost.
4. GEOGRAPHY/CHOKEPOINT — controls a physical, logistical, or jurisdictional chokepoint (ports, pipelines, grid interconnects, orbital slots).
5. CERTIFICATION/COMPLIANCE — sole or near-sole provider of a safety-critical certification or qualification (aerospace, nuclear, medical).
6. NICHE INDUSTRIAL — dominant supplier of a specialised industrial input with high switching costs and low substitutability.`;

export const MONOPOLY_PROMPT = `You are AlphaNote's monopoly analyst — institutional-grade research on companies holding structural monopolies or near-monopolies in niche, critical, or emerging markets. The note blends the live data provided with your general knowledge of the company's competitive position, with each labelled as such.

${TAXONOMY}

Rails (fact-driven):
- Distinguish three layers explicitly: (1) live data provided, (2) general knowledge you are confident in (state its vintage where it matters — your knowledge has a training cutoff), (3) informed speculation. Never present one as another.
- Market-share, licence, and "sole supplier" claims are the heart of this note — each needs a stated factual basis or a confidence label; if you cannot support the monopoly claim at all, say so plainly and classify the moat as unproven.
- Scenario moves must be anchored to the derived multiples provided (label them "derived"); no invented price targets. Probabilities are your analytical estimates — say so.
- No personalised investment advice or position sizing. Plain text; section titles as bold lines; bullets start with "- ".

Write the profile in exactly this structure:

**Monopoly classification**
One line each: archetype (from the taxonomy), moat strength (Narrow / Wide / Entrenched) with a one-line rationale, consensus awareness (Widely known / Partially recognised / Underfollowed), and market-cap tier from the supplied market cap (mega >$100B / large $10-100B / mid $2-10B / small $300M-2B / micro <$300M — flag liquidity risk for small/micro).

**The structural advantage**
Open with two or three sentences on what the company actually DOES in plain terms — products, who buys them, how it makes money (do not assume the reader knows the name). Then: what the monopoly is, why it persists, and the barriers to entry — be specific about WHAT excludes competitors (physics, licence, certification, switching costs), not adjectives. Close with the size and expected growth of the niche it controls: when live web snippets are provided, cite their figures with source domains (present ranges where sources disagree); otherwise labelled estimates with vintage ("on the order of $X bn as of [year] — verify").

**Financial fingerprint**
Read the supplied financials for monopoly evidence: are margins and ROE consistent with pricing power? Is cash conversion (OCF/NI) confirming earnings quality? Does revenue growth suggest rent extraction or a maturing franchise? Use the quarterly trajectory where supplied.

**EPIC & FaVeS assessment**
- Effect: does the monopoly materially drive intrinsic value?
- Predictability: can moat duration and pricing power be estimated with edge?
- Independence + consensus gap: what is the market systematically mispricing? State your variant perception in one clear sentence.
- Valuation: what does the current derived multiple imply about moat duration, and which methodology fits this monopoly type (capital-light → FCF multiples; asset-heavy → EV/EBITDA; pre-profit → revenue multiple with long CAP)?

**Speculative thesis**
Moat-extension optionality: adjacencies this position could monopolise next, underappreciated licences/patents/regulatory positions, and any "hidden national security moat" — labelled speculation.

**Disruption risk**
What breaks the monopoly (technological, geopolitical, regulatory), with an explicit probability bucket and timeline (e.g. "low risk, 10+ years" / "moderate, 3-5 years if [trigger]").

**Scenarios**
A markdown table with exactly this header: | Scenario | Probability | Key assumption | Implied move (derived) |
One row each for Bull, Base, Bear: your probability estimates (they must sum to 100%), the key assumption in a short phrase, and the implied direction/magnitude anchored to the derived multiples (labelled derived, ranges not point targets). After the table, one line: the probability-weighted balance of the three.

**Catalysts & watch list**
Concrete dated or watchable events: the next earnings date when provided, licence renewals, regulatory decisions, contract awards. Label which are from live data vs general knowledge.

A final line starting with "Bottom line:" — conviction 1-5 with what would move it up or down one notch. Analysis, not investment advice.

Keep the whole note under 900 words.`;

export function buildMonopolyPrompt({ symbol, quote, profile, valuation, fundamentals, history, spyStats, nextEarnings, insiders, smartMoney, shortVol, pulse, webLines = [] }) {
  const lines = [];
  lines.push(`Stock symbol: ${symbol}`);
  if (profile?.name) lines.push(`Company: ${profile.name}`);
  if (profile?.finnhubIndustry) lines.push(`Industry: ${profile.finnhubIndustry}`);
  if (profile?.exchange) lines.push(`Exchange: ${profile.exchange}`);
  if (profile?.marketCapitalization) lines.push(`Market cap: ${formatMarketCapValue(profile.marketCapitalization * 1e6)}`);
  if (quote) lines.push(`Current price: ${quote.c} ${profile?.currency || 'USD'} (${quote.dp != null ? quote.dp.toFixed(2) : '0'}% today)`);

  if (history?.available && history.stats) {
    const s = history.stats;
    let rel = '';
    if (spyStats?.changePercent != null) {
      const d = Number((s.changePercent - spyStats.changePercent).toFixed(1));
      rel = `; vs SPY ${d > 0 ? '+' : ''}${d}pp`;
    }
    lines.push(`1-year price change: ${s.changePercent}%${rel}; 52-week range ${s.low} – ${s.high}`);
  }

  if (fundamentals?.available) {
    const li = (key) => fundamentals.lineItems.find((x) => x.key === key);
    const cur = (key) => li(key)?.current;
    const rev = cur('revenue'); const ni = cur('netIncome'); const ocf = cur('operatingCashFlow');
    lines.push('');
    lines.push(`Fundamentals (${fundamentals.source}; through ${fundamentals.currentThrough || fundamentals.asOfFY}):`);
    if (rev?.value != null) lines.push(`- Revenue: ${fmtUsd(rev.value)} (${rev.basis})`);
    if (ni?.value != null) lines.push(`- Net income: ${fmtUsd(ni.value)} (${ni.basis})`);
    if (ocf?.value != null && ni?.value) lines.push(`- OCF / net income: ${(ocf.value / ni.value).toFixed(2)}x (cash conversion)`);
    for (const r of fundamentals.ratios) lines.push(`- ${r.label}: ${r.value}${r.unit === '%' ? '%' : 'x'}`);
    for (const key of ['revenue', 'netIncome']) {
      const item = li(key);
      if (item?.history?.length > 1) lines.push(`- ${item.label} by fiscal year: ${item.history.map((p) => `FY${p.fy} ${fmtUsd(p.val)}`).join(', ')}`);
      const qs = fundamentals.quarterly?.[key];
      if (qs?.length > 1) lines.push(`- ${item?.label || key} by quarter: ${qs.map((p) => `${p.end} ${fmtUsd(p.val)}`).join(', ')}`);
    }
  } else {
    lines.push('');
    lines.push('Fundamentals: not available (no SEC XBRL filings — non-US filer or recent listing). Lean on labelled general knowledge and say so.');
  }

  if (valuation) {
    const v = valuation;
    const m = [];
    if (v.pe != null) m.push(`P/E ${v.pe}x`);
    if (v.ps != null) m.push(`P/S ${v.ps}x`);
    if (v.pb != null) m.push(`P/B ${v.pb}x`);
    if (v.evEbitda != null) m.push(`EV/EBITDA ${v.evEbitda}x`);
    if (v.fcfYield != null) m.push(`FCF yield ${v.fcfYield}%`);
    lines.push('');
    lines.push(`Derived valuation (computed from market cap + the fundamentals above; cite as "derived"): ${m.join(', ') || 'insufficient data'}${v.fcf != null ? `; FCF ${fmtUsd(v.fcf)}` : ''}; EV ${fmtUsd(v.ev)}`);
  }

  if (shortVol?.ratio != null) lines.push(`FINRA daily short volume (${shortVol.date}): ${shortVol.ratio}% of volume sold short (flow, not short interest; ~40-50% is typical).`);
  if (nextEarnings?.date) lines.push(`Next scheduled earnings: ${nextEarnings.date}.`);

  if (insiders?.length) {
    lines.push(insiderScoreLine(scoreInsiderActivity(insiders), symbol));
    lines.push(`Filings: ${insiders.slice(0, 4).map((t) => `${t.insider || 'Insider'}${t.title ? ` (${t.title})` : ''} ${t.side}${t.value ? ` ~$${Math.round(t.value).toLocaleString('en-US')}` : ''}`).join('; ')}.`);
  }
  if (smartMoney?.length) {
    lines.push(`Tracked 13F managers holding it: ${smartMoney.slice(0, 4).map((p) => `${p.manager} ($${(p.value / 1e9).toFixed(1)}B, ${p.change?.type || 'held'})`).join('; ')}.`);
  } else if (smartMoney) {
    lines.push('Tracked 13F managers: none of the followed institutions held it among top positions last quarter — a possible under-followed signal (the tracked set is small; do not over-read).');
  }

  if (webLines.length) lines.push('', ...webLines);
  const social = socialPulseToLines(pulse);
  if (social.length) lines.push('', ...social);

  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}.`);
  lines.push('');
  lines.push('Write the monopoly research profile now.');
  return lines.join('\n');
}

export const MONOPOLY_RADAR_PROMPT = `You are AlphaNote's monopoly scout. Identify public companies holding structural monopolies or near-monopolies in niche, critical, or emerging markets — with a hard bias toward the under-followed names institutional consensus ignores.

${TAXONOMY}

Coverage mandate:
- Present 8-12 candidates spanning the market-cap tiers, ordered largest to smallest: at most 2 mega/large-cap anchors, and AT LEAST 4 must be sub-$5B (small- or micro-cap) — that is where the mandate's alpha lives. Flag liquidity risk on micro-caps.
- Hunt in the classic under-followed monopoly habitats: sole-source defence/aerospace components, certification and testing authorities, exclusive spectrum or licence holders, rare-earth and speciality-materials processing, grid/utility chokepoints, satellite slots and cable landing rights, nuclear-qualified suppliers.
- Do NOT pad with famous mega-cap monopolists beyond the 2 anchors (ASML, Moody's, Veeva, TransDigm and the like are known; mention at most briefly).

Rails (fact-driven):
- All of this comes from your general knowledge: state plainly that tiers, market caps, and even listing status are as of your training cutoff and MUST be verified before acting.
- Every candidate needs the factual basis of its monopoly stated concretely ("sole holder of X licence", "only FAA-certified supplier of Y") with a confidence label — if you cannot state the basis, leave the name out. Fewer credible names beats padding.
- One candidate per bold line, with its FINAL ticker — never emit corrections, "pivot to", or alternative tickers inside a line. If you are unsure of a company's ticker, choose a different candidate whose ticker you are sure of.
- No personalised investment advice. Plain text; bullets start with "- ".

Format — for EACH candidate, exactly this shape:
A bold line: TICKER — Company name (cap tier, archetype number/name).
Then:
- The monopoly: one or two sentences with the concrete factual basis and your confidence in it.
- Why under-followed (or not): one line.
- Key risk: the most plausible disruption pathway, one line.

A final line starting with "Bottom line:" — the 1-2 names you would profile first and why. Speculative research, not investment advice.

Keep it under 700 words.`;

// ── Generation ────────────────────────────────────────────────────────────────
const noteCache = new Map();
const NOTE_TTL = 3600_000;
let radarCache = { t: 0, note: null };
const RADAR_TTL = 6 * 3600_000;

export async function generateMonopolyNote(rawTopic, { force = false, onDelta } = {}) {
  const sym = String(rawTopic || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
    throw Object.assign(new Error('Monopoly profiles are per-ticker — enter a symbol, or use the radar to discover names.'), { statusCode: 400 });
  }
  const hit = noteCache.get(sym);
  if (!force && hit && Date.now() - hit.t < NOTE_TTL) return { ...hit.note, cached: true };

  const quote = await getQuote(sym);
  if (!quote || !quote.c) {
    throw Object.assign(new Error(`No market data found for "${sym}". Double-check the ticker symbol.`), { statusCode: 404 });
  }
  const [profile, fundamentals, history, spyHistory, nextEarnings, insiderData, smartMoney, shortVol] = await Promise.all([
    getCompanyProfile(sym),
    getFundamentals(sym).catch(() => null),
    isEodhdConfigured() ? getPriceHistory(sym).catch(() => null) : Promise.resolve(null),
    isEodhdConfigured() ? getPriceHistory('SPY').catch(() => null) : Promise.resolve(null),
    getNextEarnings(sym),
    getInsiderTransactions().catch(() => null),
    findSymbolAcrossManagers(sym).catch(() => null),
    shortVolFor(sym).catch(() => null),
  ]);
  const [pulse, webLines] = await Promise.all([
    getSocialPulse(profile?.name || sym).catch(() => null),
    marketSnippetLines(`${profile?.name || sym} ${profile?.finnhubIndustry || ''}`).catch(() => []),
  ]);
  const valuation = computeValuation(profile, fundamentals);
  const spyStats = sym !== 'SPY' && spyHistory?.available ? spyHistory.stats : null;
  const allTxns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
  const insiders = allTxns.filter((t) => String(t.symbol || '').toUpperCase() === sym);

  const prompt = buildMonopolyPrompt({ symbol: sym, quote, profile, valuation, fundamentals, history, spyStats, nextEarnings, insiders, smartMoney, shortVol, pulse, webLines });
  const { provider, text, fellBack } = await callAIWithFallback(prompt, MONOPOLY_PROMPT, { maxTokens: 2300, onDelta });

  const note = {
    topic: sym,
    kind: 'monopoly',
    speculative: true,
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
      hasValuation: Boolean(valuation),
      shortVol: shortVol ? { ratio: shortVol.ratio, date: shortVol.date } : undefined,
      insiderCount: insiders.length,
      managers13F: smartMoney?.length ?? 0,
    },
  };
  boundedSet(noteCache, sym, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}

// Tickers surfaced by the previous scan — fed back as exclusions on a forced
// rescan, so each ↻ digs into NEW territory instead of repeating itself.
export function extractRadarTickers(text) {
  return [...new Set(
    [...String(text).matchAll(/^\*\*([^*\n]+)\*\*\s*$/gm)]
      .map((m) => /^([A-Z][A-Z0-9.\-]{0,9})\s*[—–-]/.exec(m[1])?.[1]
        || /\(([A-Z][A-Z0-9.\-]{1,9})\)/.exec(m[1])?.[1]
        || null)
      .filter(Boolean),
  )];
}

export async function generateMonopolyRadar({ force = false, onDelta } = {}) {
  if (!force && radarCache.note && Date.now() - radarCache.t < RADAR_TTL) {
    return { ...radarCache.note, cached: true };
  }
  const previously = radarCache.note ? extractRadarTickers(radarCache.note.text) : [];
  const lines = [
    `Today's date: ${new Date().toISOString().slice(0, 10)} (your knowledge has a training cutoff — caveat accordingly).`,
    'Known anchors already on the user\'s seed list (do not re-pitch beyond brief mentions): ASML, Moody\'s/S&P Global, VeriSign, Fair Isaac, Veeva, Tyler Technologies, TransDigm, HEICO, Moog, Anterix, NV5 Global, Preformed Line Products, Clearfield, Mesa Laboratories, Core Molding, Ultralife.',
  ];
  if (previously.length) {
    lines.push(`Candidates you surfaced on the previous scan (find DIFFERENT names this time): ${previously.join(', ')}.`);
  }
  lines.push('', 'Scout for structural monopolists now, honouring the cap-tier mandate.');
  const { provider, text, fellBack } = await callAIWithFallback(lines.join('\n'), MONOPOLY_RADAR_PROMPT, { maxTokens: 1900, onDelta });
  const note = { kind: 'monopoly-radar', speculative: true, provider, fellBack, text, generatedAt: new Date().toISOString() };
  radarCache = { t: Date.now(), note };
  return { ...note, cached: false };
}
