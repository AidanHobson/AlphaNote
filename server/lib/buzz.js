// "Trending on Reddit" — which tickers retail is actually talking about.
// Scrapes the week's top posts from the major finance subreddits via the same
// keyless shreddit listing partials used for the social pulse, extracts ticker
// mentions from post titles, and ranks by mentions + engagement. Bare tokens
// are validated against the SEC ticker universe and a finance-slang blacklist
// (DD, YOLO, AI… are all real tickers — they only count when cashtagged).

import { fetchText, parseShredditPosts } from './social.js';
import { tickerUniverse } from './fundamentals.js';

export const BUZZ_SUBS = ['wallstreetbets', 'stocks', 'StockMarket', 'options', 'investing'];

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
      const e = by.get(symbol) || { symbol, mentions: 0, engagement: 0, subreddits: new Set(), topPost: null };
      e.mentions += 1;
      e.engagement += engagement;
      if (p.subreddit) e.subreddits.add(p.subreddit);
      if (!e.topPost || engagement > e.topPost.score + e.topPost.comments) {
        e.topPost = { title: p.title, subreddit: p.subreddit, score: p.score || 0, comments: p.comments || 0 };
      }
      by.set(symbol, e);
    }
  }
  return [...by.values()]
    .map((e) => ({ ...e, subreddits: [...e.subreddits] }))
    .sort((a, b) => (b.mentions - a.mentions) || (b.engagement - a.engagement));
}

let cache = { t: 0, data: null };
const TTL = 45 * 60_000;

export async function getRedditBuzz({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.t < TTL) return cache.data;

  const universe = await tickerUniverse();
  const lists = await Promise.all(BUZZ_SUBS.map((sub) =>
    fetchText(`https://www.reddit.com/svc/shreddit/community-more-posts/top/?name=${encodeURIComponent(sub)}&t=week`)
      .then((html) => parseShredditPosts(html).map((p) => ({ ...p, subreddit: p.subreddit || `r/${sub}` })))
      .catch(() => [])));
  const posts = lists.flat();

  const data = {
    generatedAt: new Date().toISOString(),
    window: 'top posts, past week',
    subreddits: BUZZ_SUBS.map((s) => `r/${s}`),
    postsScanned: posts.length,
    available: posts.length > 0,
    reason: posts.length ? undefined : 'Reddit listings unreachable from this server right now.',
    items: aggregateBuzz(posts, universe).slice(0, 15),
  };
  if (posts.length) cache = { t: Date.now(), data };
  return data;
}
