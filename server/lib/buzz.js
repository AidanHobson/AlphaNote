// "Trending on Reddit" — which tickers retail is actually talking about.
// Scrapes the week's top posts from the major finance subreddits via the same
// keyless shreddit listing partials used for the social pulse, extracts ticker
// mentions from post titles, and ranks by mentions + engagement. Bare tokens
// are validated against the SEC ticker universe and a finance-slang blacklist
// (DD, YOLO, AI… are all real tickers — they only count when cashtagged).

import { fetchText, parseShredditPosts } from './social.js';
import { tickerUniverse } from './fundamentals.js';
import { getWatchlistData } from './finnhub.js';
import { callAIWithFallback } from './ai-provider.js';
import { snapshotBoard, attachDeltas } from './buzz-history.js';
import { getShortVolumeMap } from './shortvol.js';
import { recordOutcome } from './source-health.js';
import db from './db.js';
import kv from './kvcache.js';

export const BUZZ_SUBS = ['wallstreetbets', 'stocks', 'StockMarket', 'options', 'investing', 'pennystocks', 'Shortsqueeze'];

// Uppercase tokens that collide with real tickers but almost always mean the
// English word / finance slang in a Reddit title. A $cashtag bypasses this.
const BLACKLIST = new Set([
  'A', 'I', 'AGI', 'AI', 'ALL', 'AND', 'ANY', 'API', 'ARE', 'ASK', 'ATH', 'ATM', 'BE',
  'BIG', 'BTC', 'BUY', 'CAN', 'CEO', 'CFO', 'CPI', 'CTO', 'DD', 'DO', 'DOW', 'EDIT',
  'EOD', 'EPS', 'ETF', 'ETH', 'EV', 'FAQ', 'FED', 'FOMO', 'FOR', 'GDP', 'GO', 'HAS',
  'HE', 'IMO', 'IPO', 'IRA', 'IS', 'IT', 'ITM', 'IV', 'LFG', 'LOL', 'LOSS', 'MOON',
  'NEW', 'NOW', 'ON', 'ONE', 'OPEN', 'OR', 'OTM', 'OUT', 'PE', 'PSA', 'PT', 'PUT',
  'RED', 'SEC', 'SO', 'TA', 'THE', 'TLDR', 'TO', 'UP', 'US', 'USA', 'USD', 'WE',
  'WSB', 'YOLO', 'YOU',
]);

// Tickers mentioned in a title: $cashtags (high confidence — only need to be
// real tickers) plus bare 2-5 char uppercase tokens (must be real tickers AND
// not blacklisted slang/common words).
export function extractTickers(title, universe) {
  const out = new Set();
  const text = String(title || '');
  for (const [, t] of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) {
    const sym = t.toUpperCase();
    if (universe.has(sym)) out.add(sym);
  }
  for (const [tok] of text.matchAll(/\b[A-Z]{2,5}\b/g)) {
    if (!BLACKLIST.has(tok) && universe.has(tok)) out.add(tok);
  }
  return out;
}

export function aggregateBuzz(posts, universe) {
  const by = new Map();
  for (const p of posts) {
    const engagement = (p.score || 0) + (p.comments || 0);
    for (const symbol of extractTickers(p.title, universe)) {
      const e = by.get(symbol) || { symbol, mentions: 0, engagement: 0, subreddits: new Set(), posts: [] };
      e.mentions += 1;
      e.engagement += engagement;
      if (p.subreddit) e.subreddits.add(p.subreddit);
      e.posts.push({ id: p.id, title: p.title, subreddit: p.subreddit, score: p.score || 0, comments: p.comments || 0 });
      by.set(symbol, e);
    }
  }
  return [...by.values()]
    .map((e) => {
      // Keep the 3 most-engaged threads; topPost stays as the headline one.
      const posts = e.posts.sort((a, b) => (b.score + b.comments) - (a.score + a.comments)).slice(0, 3);
      return { ...e, subreddits: [...e.subreddits], posts, topPost: posts[0] || null };
    })
    .sort((a, b) => (b.mentions - a.mentions) || (b.engagement - a.engagement));
}

// Overlay today's scan onto the weekly board: per-symbol today counts plus a
// "rising" flag when a name is drawing real attention right now.
export function mergeTodaySignal(weekItems, dayItems) {
  const today = new Map(dayItems.map((d) => [d.symbol, d]));
  return weekItems.map((w) => {
    const d = today.get(w.symbol);
    const t = { mentions: d?.mentions || 0, engagement: d?.engagement || 0 };
    return { ...w, today: t, rising: t.mentions >= 2 || (t.mentions >= 1 && t.engagement >= 500) };
  });
}

let cache = { t: 0, data: null };
const TTL = 45 * 60_000;

const fetchSubPosts = (sub, range) =>
  fetchText(`https://www.reddit.com/svc/shreddit/community-more-posts/top/?name=${encodeURIComponent(sub)}&t=${range}`)
    .then((html) => parseShredditPosts(html).map((p) => ({ ...p, subreddit: p.subreddit || `r/${sub}` })))
    .catch(() => []);

export async function getRedditBuzz({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.t < TTL) return cache.data;
  if (!force) {
    // Persistent tier: serve the last board across restarts/deploys.
    const stored = kv.get('buzz:board');
    if (stored) { cache = { t: Date.now(), data: stored }; return stored; }
  }

  const universe = await tickerUniverse();
  // Week scan ranks the board; day scan provides the "rising right now" overlay.
  const [weekLists, dayLists] = await Promise.all([
    Promise.all(BUZZ_SUBS.map((sub) => fetchSubPosts(sub, 'week'))),
    Promise.all(BUZZ_SUBS.map((sub) => fetchSubPosts(sub, 'day'))),
  ]);
  const posts = weekLists.flat();
  // Reddit health: a market-wide scan returning zero posts means the listings
  // are blocked (datacenter IP) — the clearest signal we have.
  recordOutcome('reddit', posts.length > 0, posts.length ? null : 'no posts from any tracked subreddit (IP block?)');
  let items = mergeTodaySignal(
    aggregateBuzz(posts, universe).slice(0, 15),
    aggregateBuzz(dayLists.flat(), universe),
  );

  // Time dimension: rank deltas vs ~a day ago, then snapshot this scan.
  if (items.length) {
    try {
      items = attachDeltas(db, items);
      snapshotBoard(db, items);
    } catch { /* history is best-effort — the live board never depends on it */ }
  }

  // Best-effort price enrichment for the top names (Finnhub; zeros under 429
  // are dropped so the UI shows "—" rather than a fake $0.00).
  try {
    const top = items.slice(0, 8).map((i) => i.symbol);
    const quotes = await getWatchlistData(top);
    const bySym = new Map(quotes.filter((q) => q && q.price > 0).map((q) => [q.symbol, q]));
    for (const item of items) {
      const q = bySym.get(item.symbol);
      if (q) { item.name = q.name; item.quote = { price: q.price, changePercent: q.changePercent }; }
    }
  } catch { /* enrichment is optional */ }

  // FINRA daily short-volume share — squeeze/positioning context per ticker.
  try {
    const { map } = await getShortVolumeMap();
    if (map) {
      for (const item of items) {
        const sv = map.get(item.symbol);
        if (sv) item.shortVol = { ratio: sv.ratio, date: sv.date };
      }
    }
  } catch { /* optional */ }

  const data = {
    generatedAt: new Date().toISOString(),
    window: 'top posts, past week',
    subreddits: BUZZ_SUBS.map((s) => `r/${s}`),
    postsScanned: posts.length,
    available: posts.length > 0,
    reason: posts.length ? undefined : 'Reddit listings unreachable from this server right now.',
    items,
  };
  if (posts.length) {
    cache = { t: Date.now(), data };
    kv.set('buzz:board', data, TTL);
  }
  return data;
}

// ── Retail pulse brief: AI synthesis of the whole board ───────────────────────
export const BRIEF_PROMPT = `You are AlphaNote's retail-flow strategist. You write a short, SPECULATIVE "Retail Pulse" read of what retail traders on Reddit's finance subreddits are concentrated in right now, using ONLY the board data provided.

Rails:
- The data is thread TITLES and engagement counts — attention and positioning signal, not fundamentals. Do not infer business performance from it.
- You may add brief general-knowledge context on what a name does, labelled as such; your knowledge has a training cutoff.
- No personalised investment advice, no position sizing. Attention cuts both ways — crowded longs are fragile.
- Plain text; section titles as bold lines; bullets start with "- ". Keep it under 350 words.

Structure:
**Where the crowd is**
Two or three bullets on the dominant names/clusters and what the thread titles suggest the crowd's thesis is.

**Rising today**
Which names are accelerating in today's scan vs the weekly board (if none stand out, say so).

**Contrarian read**
One or two bullets: where the attention looks crowded or late, and what the bears among the threads are saying if visible. If the crowd is chasing application-layer winners, note the picks-and-shovels angle — the toolmakers/testers/suppliers that earn from the same trend without the winner-picking risk — when one plausibly exists (general knowledge, labelled).

A final line starting with "Bottom line:" — the one thing worth taking from this board, with the reminder that this is speculative attention data, not advice.`;

export function buildBriefPrompt(board) {
  const lines = [`Reddit retail attention board (${board.window}; subreddits: ${board.subreddits.join(', ')}; ${board.postsScanned} posts scanned; generated ${board.generatedAt.slice(0, 16)}Z):`];
  board.items.slice(0, 10).forEach((i, n) => {
    const px = i.quote ? ` | price ${i.quote.price} (${i.quote.changePercent >= 0 ? '+' : ''}${Number(i.quote.changePercent).toFixed(2)}% today)` : '';
    lines.push(`#${n + 1} ${i.symbol}${i.name ? ` (${i.name})` : ''} — ${i.mentions} mentions, ${i.engagement.toLocaleString('en-US')} engagement this week; today: ${i.today?.mentions || 0} mentions${i.rising ? ' (RISING)' : ''}${px}`);
    for (const p of i.posts || []) lines.push(`   · "${p.title}" (${p.subreddit}, ${p.score} upvotes, ${p.comments} comments)`);
  });
  lines.push('');
  lines.push('Write the Retail Pulse brief now using ONLY the board above.');
  return lines.join('\n');
}

let briefCache = { key: '', note: null };

export async function generateBuzzBrief({ force = false } = {}) {
  const board = await getRedditBuzz();
  if (!board.available || !board.items.length) {
    throw Object.assign(new Error('The Reddit board is unavailable right now.'), { statusCode: 503 });
  }
  // One brief per board snapshot — regenerating without new data is waste.
  if (!force && briefCache.note && briefCache.key === board.generatedAt) {
    return { ...briefCache.note, cached: true };
  }
  const { provider, text, fellBack } = await callAIWithFallback(buildBriefPrompt(board), BRIEF_PROMPT, { maxTokens: 1100 });
  const note = { provider, fellBack, text, generatedAt: new Date().toISOString(), boardGeneratedAt: board.generatedAt };
  briefCache = { key: board.generatedAt, note };
  return { ...note, cached: false };
}
