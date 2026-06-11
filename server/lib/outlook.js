// Speculative outlooks — the forward-looking counterpart to the evidence-led
// research notes. Accepts a THEME ("Photonics", "Robotics", "Energy") or a
// single TICKER. Unlike research notes, the model is explicitly allowed to
// draw on its general knowledge — with speculation clearly labelled and a
// knowledge-cutoff caveat — because themes have no single data feed to cite.

import { getQuote, getCompanyProfile, getNextEarnings } from './finnhub.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { computeValuation } from './research.js';
import { callAIWithFallback } from './ai-provider.js';
import { formatMarketCapValue, boundedSet } from './utils.js';

const SHARED_RAILS = `Rails (these still apply even though this note is speculative):
- Distinguish three layers explicitly: (1) live data provided in the input, (2) general knowledge you are confident in, (3) informed speculation — never present one as another.
- Your general knowledge ends at your training cutoff: company line-ups, market sizes, and leadership change — say so where it matters, and suggest verifying specifics in AlphaNote's Research tab.
- Rough market-size or growth figures are fine as labelled estimates ("on the order of", "estimated"); never present an invented number as a current data point.
- No personalised investment advice and no position sizing. Views and conviction scores are analytical opinions.
- Plain text only: section titles as bold lines, bullets starting with "- ".`;

export const THEME_PROMPT = `You are AlphaNote's thematic strategist. You write SPECULATIVE theme outlooks — the forward-looking counterpart to the firm's evidence-led research notes. The reader wants the shape of the opportunity, who is exposed to it, and what would make it real, with uncertainty stated honestly rather than hidden.

${SHARED_RAILS}

Write the outlook in exactly this structure:

**The theme**
Two or three sentences: what it is, and why it could matter to public-market investors at all.

**Why now**
What has changed recently (technology, cost curves, policy, demand) that puts this theme on the clock — and how confident you are in each driver.

**Value chain**
Bullets mapping the sub-segments (e.g. components → systems → applications) and where the economic leverage likely sits.

**Public-market exposure**
5-8 bullets: ticker (exchange), one-line role in the theme, and whether it is a pure-play or a diversified company with theme exposure. State plainly that this list comes from general knowledge — it may be stale or incomplete, and tickers should be verified in the Research tab before acting.

**Bull case**
What the theme looks like if it works: adoption path, who wins, rough order-of-magnitude prize (labelled as estimate).

**Bear case**
Why it might disappoint: technology risk, cost, competition, hype cycles, timing.

**Wildcards**
One or two genuinely speculative scenarios — low probability, high impact, clearly flagged as such.

**What to watch**
Concrete signposts: KPIs, product milestones, policy decisions, earnings lines that would confirm or kill the thesis.

A final line starting with "Bottom line:" — your stance on the theme with a conviction score out of 5 and a time horizon (e.g. "Bottom line: constructive over 3-5 years, conviction 2/5 — early but real"). This is speculative analysis, not investment advice.

Keep the whole note under 650 words.`;

export const STOCK_OUTLOOK_PROMPT = `You are AlphaNote's thematic strategist writing a SPECULATIVE outlook on a single stock — the blue-sky/bear-trap counterpart to the firm's evidence-led research note on the same name. Anchor on the live data provided, then go beyond it: what the bulls dream about, what the bears fear, and what the skew looks like.

${SHARED_RAILS}

Write the outlook in exactly this structure:

**Setup**
Two or three sentences anchored to the live data: where the stock and valuation stand today.

**The dream**
What the most ambitious credible bulls believe: optionality not yet in the numbers, new markets, platform effects. Label which parts are general knowledge and which are speculation.

**The nightmare**
The bear case at its worst: disruption, multiple compression, thesis breaks.

**Asymmetry**
Qualitatively, how the risk/reward skews from today's valuation (use the derived multiples provided), and what you would need to believe for each side.

**Signposts**
Concrete, watchable indicators that the dream or the nightmare is starting to play out — anchor timing to the next earnings date when provided.

A final line starting with "Bottom line:" — your speculative stance with a conviction score out of 5 and a time horizon. This is speculative analysis, not investment advice.

Keep the whole note under 550 words.`;

const fmtUsd = (v) => {
  if (v == null) return null;
  const sign = v < 0 ? '-' : '';
  return Math.abs(v) >= 1e6 ? `${sign}${formatMarketCapValue(Math.abs(v))}` : `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
};

export function buildThemePrompt(topic) {
  return [
    `Theme: ${topic}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)} (your general knowledge may end earlier — caveat where it matters).`,
    '',
    'Write the speculative theme outlook now.',
  ].join('\n');
}

export function buildStockOutlookPrompt({ symbol, quote, profile, valuation, history, spyStats, nextEarnings }) {
  const lines = [];
  lines.push(`Stock symbol: ${symbol}`);
  if (profile?.name) lines.push(`Company: ${profile.name}`);
  if (profile?.finnhubIndustry) lines.push(`Industry: ${profile.finnhubIndustry}`);
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
  if (valuation) {
    const m = [];
    if (valuation.pe != null) m.push(`P/E ${valuation.pe}x`);
    if (valuation.ps != null) m.push(`P/S ${valuation.ps}x`);
    if (valuation.evEbitda != null) m.push(`EV/EBITDA ${valuation.evEbitda}x`);
    if (valuation.fcfYield != null) m.push(`FCF yield ${valuation.fcfYield}%`);
    if (m.length) lines.push(`Derived valuation (TTM): ${m.join(', ')}${valuation.fcf != null ? `; FCF ${fmtUsd(valuation.fcf)}` : ''}`);
  }
  if (nextEarnings?.date) lines.push(`Next scheduled earnings: ${nextEarnings.date}.`);
  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}.`);
  lines.push('');
  lines.push('Write the speculative stock outlook now, anchored to the data above.');
  return lines.join('\n');
}

// A topic is "ticker-like" when it could be a symbol; we then confirm with a
// live quote and fall back to theme mode when no market data exists.
export const isTickerLike = (topic) => /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(topic) && !topic.includes(' ');

const cache = new Map();
const TTL = 3600_000;

export async function generateOutlook(rawTopic, { force = false } = {}) {
  const topic = String(rawTopic || '').trim().replace(/\s+/g, ' ');
  if (!topic) throw Object.assign(new Error('A theme or ticker is required.'), { statusCode: 400 });
  if (topic.length > 60 || !/^[A-Za-z0-9 .&\-/+']+$/.test(topic)) {
    throw Object.assign(new Error('Topic must be under 60 characters (letters, numbers, basic punctuation).'), { statusCode: 400 });
  }

  const key = topic.toUpperCase();
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.t < TTL) return { ...hit.note, cached: true };

  // Stock mode only when the topic is ticker-shaped AND has live market data.
  let mode = 'theme';
  let prompt; let system; let data = { name: topic };
  if (isTickerLike(topic)) {
    const sym = topic.toUpperCase();
    const quote = await getQuote(sym);
    if (quote && quote.c) {
      mode = 'stock';
      const [profile, fundamentals, history, spyHistory, nextEarnings] = await Promise.all([
        getCompanyProfile(sym),
        getFundamentals(sym).catch(() => null),
        isEodhdConfigured() ? getPriceHistory(sym).catch(() => null) : Promise.resolve(null),
        isEodhdConfigured() ? getPriceHistory('SPY').catch(() => null) : Promise.resolve(null),
        getNextEarnings(sym),
      ]);
      const valuation = computeValuation(profile, fundamentals);
      const spyStats = sym !== 'SPY' && spyHistory?.available ? spyHistory.stats : null;
      prompt = buildStockOutlookPrompt({ symbol: sym, quote, profile, valuation, history, spyStats, nextEarnings });
      system = STOCK_OUTLOOK_PROMPT;
      data = {
        name: profile?.name || sym,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        currency: profile?.currency || 'USD',
        logo: profile?.logo || '',
      };
    }
  }
  if (mode === 'theme') {
    prompt = buildThemePrompt(topic);
    system = THEME_PROMPT;
  }

  const { provider, text, fellBack } = await callAIWithFallback(prompt, system, { maxTokens: 1700 });

  const note = {
    topic,
    mode,
    speculative: true,
    provider,
    fellBack,
    text,
    generatedAt: new Date().toISOString(),
    data,
  };
  boundedSet(cache, key, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}
