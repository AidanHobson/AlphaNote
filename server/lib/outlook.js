// Speculative outlooks — the forward-looking counterpart to the evidence-led
// research notes. Accepts a THEME ("Photonics", "Robotics", "Energy") or a
// single TICKER. Unlike research notes, the model is explicitly allowed to
// draw on its general knowledge — with speculation clearly labelled and a
// knowledge-cutoff caveat — because themes have no single data feed to cite.

import { getQuote, getCompanyProfile, getNextEarnings } from './finnhub.js';
import { getFundamentals } from './fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './eodhd.js';
import { computeValuation } from './research.js';
import { getSocialPulse, socialPulseToLines, getPostBody } from './social.js';
import { marketSnippetLines } from './websearch.js';
import { getRedditBuzz } from './buzz.js';
import { getInsiderTransactions } from './insider.js';
import { findSymbolAcrossManagers } from './smartmoney.js';
import { shortVolFor } from './shortvol.js';
import { callAIWithFallback } from './ai-provider.js';
import { formatMarketCapValue, fmtUsd, boundedSet } from './utils.js';

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
What has changed recently (technology, cost curves, policy, demand) that puts this theme on the clock — and how confident you are in each driver. When a "Last 30 days" social/forum signal is provided, use it to ground what is actually being discussed right now (and note where current attention diverges from your prior knowledge).

**Market size & trajectory**
The market today and how it is expected to expand: rough current size, the commonly projected growth path, and — more importantly — WHAT drives that expansion (adoption curves, regulation, cost declines, replacement cycles) and what would stall it. When live web snippets are provided, build this section on THEM — cite figures with their source domain, and present the range when sources disagree. Without snippets, figures are labelled estimates with vintage ("on the order of $X bn as of [year] — verify current forecasts"). Either way, distinguish sourced projections from your own speculation about where growth could surprise.

**Value chain**
Bullets mapping the sub-segments (e.g. components → systems → applications) and where the economic leverage likely sits.

**Picks & shovels**
The enabling layer: the toolmakers, test and measurement houses, equipment, components, and materials suppliers that get paid regardless of which application-layer player wins — the classic picks-and-shovels thesis (e.g. semiconductor test-probe makers like Technoprobe, or wafer-level test systems like Aehr: the testers earn whichever chipmaker takes the crown). Name the strongest public candidates for THIS theme (general knowledge — may be stale), explain why their economics capture the theme's growth with less winner-picking risk, and flag the classic caveats: capex cyclicality, customer concentration, and that a consensus "enabler" trade can itself get crowded.

**Bottlenecks**
The scarce inputs that gate the theme's growth — where demand outruns supply and pricing power concentrates (in the AI buildout, think electrical power and grid interconnects, HBM memory, advanced packaging capacity, and optical interconnects). This section is FACT-DRIVEN: each bottleneck must name (1) the constraint, (2) the public companies positioned at it, and (3) a supporting fact — a concrete number or datapoint you are confident in, stated with its vintage ("as of …"), or evidence from the live signal provided. If you cannot support a claimed bottleneck with a fact, leave it out entirely. For each, say what relieves it and roughly when — a bottleneck with a visible relief date is a trade, not a thesis.

**Public-market exposure**
8-12 bullets spanning the market-cap spectrum, ordered roughly largest to smallest. Each bullet: ticker (exchange), then TWO OR THREE SENTENCES on what the company actually does — its products, who buys them, and how it makes money — and its specific role in this theme (not just a sector label), plus a role tag — pure-play, diversified, or picks-and-shovels enabler — and an approximate market-cap tier from your training data: [mega/large: >$10B], [mid: $2-10B], or [small: <$2B]. Requirements:
- At LEAST 4 of the names must be small- or mid-cap. The speculative reader already knows the mega-caps; the differentiated value of this list is the smaller, less-obvious names closer to pure-play exposure.
- For each small/mid name, say whether its theme revenue is REAL today or still prospective (pre-revenue story stocks must be labelled as such), and flag the small-cap hazards where relevant: thin liquidity, dilution risk, customer concentration, going-concern risk.
- Market caps move — tiers are approximate as of your training data. State plainly that the whole list comes from general knowledge, may be stale or incomplete, and must be verified in the Research tab before acting. If you genuinely cannot name enough credible small/mid-cap names for this theme, say so rather than padding with weak fits.

**Bull case**
What the theme looks like if it works: adoption path, who wins, rough order-of-magnitude prize (labelled as estimate).

**Bear case**
Why it might disappoint: technology risk, cost, competition, hype cycles, timing.

**Wildcards**
One or two genuinely speculative scenarios — low probability, high impact, clearly flagged as such.

**What to watch**
Concrete signposts: KPIs, product milestones, policy decisions, earnings lines that would confirm or kill the thesis. Where Polymarket odds are provided, cite them as the crowd's current probability on relevant outcomes.

A final line starting with "Bottom line:" — your stance on the theme with a conviction score out of 5 and a time horizon (e.g. "Bottom line: constructive over 3-5 years, conviction 2/5 — early but real"). This is speculative analysis, not investment advice.

Keep the whole note under 900 words.`;

export const STOCK_OUTLOOK_PROMPT = `You are AlphaNote's thematic strategist writing a SPECULATIVE outlook on a single stock — the blue-sky/bear-trap counterpart to the firm's evidence-led research note on the same name. Anchor on the live data provided, then go beyond it: what the bulls dream about, what the bears fear, and what the skew looks like.

${SHARED_RAILS}

Write the outlook in exactly this structure:

**Setup**
Open with two or three sentences on what the company actually DOES — its products, who buys them, and how it makes money (general knowledge, labelled; do not assume the reader knows the name). Then anchor to the live data: where the stock and valuation stand today. Classify the business: is this a picks-and-shovels enabler (it sells the tools, tests, equipment, or infrastructure an industry needs, and gets paid whichever player wins — e.g. Technoprobe in semiconductor test, Aehr in wafer-level test) or an end-market bet on a winner? Let that classification shape the rest of the note: enablers trade winner-picking risk for capex cyclicality and customer concentration.

**The market**
The end market(s) this company sells into and how they are expected to expand: rough size today and the commonly projected growth, with what drives it and what could stall it. When live web snippets are provided, build on them and cite figures with their source domain (present ranges where sources disagree); otherwise figures are labelled estimates with vintage ("on the order of $X bn as of [year] — verify"). If the company's growth depends on a market that does not exist yet, say so plainly.

**The dream**
What the most ambitious credible bulls believe: optionality not yet in the numbers, new markets, platform effects. Label which parts are general knowledge and which are speculation.

**The nightmare**
The bear case at its worst: disruption, multiple compression, thesis breaks.

**Asymmetry**
Qualitatively, how the risk/reward skews from today's valuation (use the derived multiples provided), and what you would need to believe for each side. Reconcile the positioning facts where provided — retail attention, insider activity, tracked 13F positions, and FINRA short-volume — and name the tension explicitly when they point in different directions (e.g. retail piling in while insiders sell).

**Signposts**
Concrete, watchable indicators that the dream or the nightmare is starting to play out — anchor timing to the next earnings date when provided, and to any Polymarket odds or surge in recent discussion in the "Last 30 days" signal.

A final line starting with "Bottom line:" — your speculative stance with a conviction score out of 5 and a time horizon. This is speculative analysis, not investment advice.

Keep the whole note under 750 words.`;

export function buildThemePrompt(topic, pulse, webLines = []) {
  const lines = [
    `Theme: ${topic}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)} (your general knowledge may end earlier — caveat where it matters).`,
  ];
  if (webLines.length) lines.push('', ...webLines);
  const social = socialPulseToLines(pulse);
  if (social.length) lines.push('', ...social);
  lines.push('', 'Write the speculative theme outlook now.');
  return lines.join('\n');
}

export function buildStockOutlookPrompt({ symbol, quote, profile, valuation, history, spyStats, nextEarnings, pulse, buzz, threadBody, insiders, smartMoney, shortVol, webLines = [] }) {
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
  if (shortVol?.ratio != null) {
    lines.push(`FINRA daily short volume (${shortVol.date}): ${shortVol.ratio}% of consolidated volume sold short. (This is daily short-sale FLOW, not short interest outstanding; typical large-cap baseline is roughly 40-50% — read levels well above that as elevated shorting/hedging activity.)`);
  }
  if (buzz) {
    lines.push(`Reddit retail attention: #${buzz.rank} most-mentioned ticker across the tracked finance subreddits this week (${buzz.mentions} mention${buzz.mentions > 1 ? 's' : ''}, ${buzz.engagement.toLocaleString('en-US')} combined upvotes+comments).${buzz.topPost ? ` Top thread: "${buzz.topPost.title}" (${buzz.topPost.subreddit})` : ''} Treat as positioning/crowding signal — heavy retail attention cuts both ways.`);
    if (threadBody) {
      lines.push(`The crowd's actual argument — body of that top thread (excerpt, verbatim from Reddit): "${threadBody.slice(0, 1200)}"`);
      lines.push('Engage with this argument directly in the note: what it gets right, what it ignores.');
    }
  }
  if (insiders?.length) {
    lines.push(`Recent insider Form 4 filings for ${symbol} (open-market only): ${insiders.slice(0, 4).map((t) => `${t.insider || 'Insider'}${t.title ? ` (${t.title})` : ''} ${t.side}${t.value ? ` ~$${Math.round(t.value).toLocaleString('en-US')}` : ''}`).join('; ')}.`);
  }
  if (smartMoney?.length) {
    lines.push(`Tracked 13F managers holding ${symbol} (latest reported quarter): ${smartMoney.slice(0, 4).map((p) => `${p.manager} ($${(p.value / 1e9).toFixed(1)}B, ${p.change?.type === 'new' ? 'NEW' : p.change?.type === 'add' ? 'added QoQ' : p.change?.type === 'trim' ? 'trimmed QoQ' : 'flat QoQ'})`).join('; ')}.`);
  } else if (smartMoney) {
    lines.push(`Tracked 13F managers: none of the followed institutions held ${symbol} among top positions last quarter.`);
  }
  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}.`);
  if (webLines.length) lines.push('', ...webLines);
  const social = socialPulseToLines(pulse);
  if (social.length) lines.push('', ...social);
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
  let pulse = null;
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
      // Positioning facts: 30-day social pulse, buzz-board rank, insider Form 4s,
      // tracked 13F holders, FINRA short-volume, live market-size snippets —
      // all cached/keyless.
      const [pulseRes, buzzBoard, insiderData, smartMoney, shortVol, webLines] = await Promise.all([
        getSocialPulse(profile?.name || sym).catch(() => null),
        getRedditBuzz().catch(() => null),
        getInsiderTransactions().catch(() => null),
        findSymbolAcrossManagers(sym).catch(() => null),
        shortVolFor(sym).catch(() => null),
        marketSnippetLines(`${profile?.finnhubIndustry || profile?.name || sym}`).catch(() => []),
      ]);
      pulse = pulseRes;
      const idx = buzzBoard?.items?.findIndex((i) => i.symbol === sym) ?? -1;
      const buzz = idx >= 0 ? { rank: idx + 1, ...buzzBoard.items[idx] } : null;
      // The crowd's actual thesis: body text of the most-engaged thread.
      const top = buzz?.topPost;
      const threadBody = top?.id ? await getPostBody(top.subreddit, top.id).catch(() => '') : '';
      const allTxns = Array.isArray(insiderData) ? insiderData : insiderData?.transactions || [];
      const insiders = allTxns.filter((t) => String(t.symbol || '').toUpperCase() === sym);
      prompt = buildStockOutlookPrompt({ symbol: sym, quote, profile, valuation, history, spyStats, nextEarnings, pulse, buzz, threadBody, insiders, smartMoney, shortVol, webLines });
      system = STOCK_OUTLOOK_PROMPT;
      data = {
        name: profile?.name || sym,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        currency: profile?.currency || 'USD',
        logo: profile?.logo || '',
        buzz: buzz ? { rank: buzz.rank, mentions: buzz.mentions } : undefined,
        shortVol: shortVol ? { ratio: shortVol.ratio, date: shortVol.date } : undefined,
        insiderCount: insiders.length,
        managers13F: smartMoney?.length ?? 0,
      };
    }
  }
  if (mode === 'theme') {
    const [pulseRes, webLines] = await Promise.all([
      getSocialPulse(topic).catch(() => null),
      marketSnippetLines(topic).catch(() => []),
    ]);
    pulse = pulseRes;
    prompt = buildThemePrompt(topic, pulse, webLines);
    system = THEME_PROMPT;
  }

  const { provider, text, fellBack } = await callAIWithFallback(prompt, system, { maxTokens: 2300 });

  const note = {
    topic,
    mode,
    speculative: true,
    provider,
    fellBack,
    text,
    generatedAt: new Date().toISOString(),
    data: { ...data, social: pulse ? pulse.sources.map((s) => s.source) : [] },
  };
  boundedSet(cache, key, { t: Date.now(), note }, 100);
  return { ...note, cached: false };
}
