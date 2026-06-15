// "Last 30 days" social/forum signal — a server-side port of the keyless,
// no-API-key sources from the last30days skill (github.com/mvanhorn/last30days-skill):
// Hacker News via the Algolia API and Polymarket via the Gamma API, plus a
// best-effort Reddit .json attempt (datacenter IPs usually get 403, as the skill
// itself notes, so it's optional). This grounds the SPECULATIVE outlook in what
// people are actually discussing right now — addressing the model's training-cutoff
// blind spot, which is exactly what that mode needs.

import { boundedSet } from './utils.js';
import kv from './kvcache.js';
import { track } from './source-health.js';

const UA = process.env.SEC_USER_AGENT || 'AlphaNote/1.0 (research dashboard)';
const DAY = 86400;

export async function fetchJSON(url, { timeout = 9000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── Hacker News (Algolia) ────────────────────────────────────────────────────
async function hackerNews(topic) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 30 * DAY;
  const qs = new URLSearchParams({
    query: topic, tags: 'story',
    numericFilters: `created_at_i>${from},created_at_i<${now},points>2`,
    hitsPerPage: '30',
  });
  const data = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?${qs}`);
  const hits = (data?.hits || [])
    .filter((h) => h.title)
    .map((h) => ({ title: h.title, points: h.points || 0, comments: h.num_comments || 0, date: (h.created_at || '').slice(0, 10) }))
    .sort((a, b) => (b.points + b.comments) - (a.points + a.comments));
  const totalEngagement = hits.reduce((s, h) => s + h.points + h.comments, 0);
  return { source: 'Hacker News', count: data?.nbHits ?? hits.length, totalEngagement, items: hits.slice(0, 8) };
}

// Broad HN signal — the highest-engagement stories of the window, no query.
// Used by the theme radar to spot what technologists are excited about before
// the themes have consensus names.
export async function hnTopStories({ days = 14, minPoints = 150, count = 30 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({
    tags: 'story',
    numericFilters: `created_at_i>${now - days * DAY},points>${minPoints}`,
    hitsPerPage: String(count),
  });
  const data = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?${qs}`);
  return (data?.hits || [])
    .filter((h) => h.title)
    .map((h) => ({ title: h.title, points: h.points || 0, comments: h.num_comments || 0, date: (h.created_at || '').slice(0, 10) }))
    .sort((a, b) => (b.points + b.comments) - (a.points + a.comments));
}

// ── Polymarket (Gamma) — prediction-market odds are forward-looking signal ────
export const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const STOP = new Set(['the', 'and', 'for', 'will', 'with', 'tech', 'inc', 'corp', 'what', 'which', 'next']);
// Informative tokens of the topic (≥4 chars, non-stopword), stemmed to a 5-char
// prefix so "robotics" matches "robot"/"robotic". Gamma's search matches inside
// sub-questions, so we re-gate on the EVENT TITLE to drop keyword false positives.
function topicTokens(topic) {
  return [...new Set(String(topic).toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, 5));
}
function titleMatchesTopic(title, tokens) {
  if (!tokens.length) return true;
  const t = String(title).toLowerCase();
  return tokens.some((tok) => t.includes(tok));
}
export function parseEventMarkets(event) {
  return (event.markets || [])
    .map((m) => {
      let outcomes = m.outcomes; let prices = m.outcomePrices;
      try { if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes); } catch { outcomes = null; }
      try { if (typeof prices === 'string') prices = JSON.parse(prices); } catch { prices = null; }
      if (!Array.isArray(outcomes) || !Array.isArray(prices)) return null;
      const yes = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
      const pct = yes >= 0 ? Math.round(toNum(prices[yes]) * 100) : Math.round(toNum(prices[0]) * 100);
      return { question: m.question || event.title, pct, volume: toNum(m.volume) };
    })
    .filter(Boolean);
}

export function topMarketOdds(event) {
  return parseEventMarkets(event).sort((a, b) => b.volume - a.volume)[0] || null;
}
async function polymarket(topic) {
  const qs = new URLSearchParams({ q: topic, limit_per_type: '12' });
  const data = await fetchJSON(`https://gamma-api.polymarket.com/public-search?${qs}`);
  const tokens = topicTokens(topic);
  const events = (Array.isArray(data?.events) ? data.events : [])
    // Gate on the event title (not Gamma's sub-question match) to drop the
    // "what will <politician> say" markets that merely contain the keyword.
    .filter((e) => e.active !== false && e.title && titleMatchesTopic(e.title, tokens))
    .map((e) => {
      const m = topMarketOdds(e);
      return { title: e.title, volume: toNum(e.volume), endDate: (e.endDate || '').slice(0, 10), topMarket: m };
    })
    .filter((e) => e.volume > 1000)
    .sort((a, b) => b.volume - a.volume);
  return { source: 'Polymarket', count: events.length, items: events.slice(0, 6) };
}

// ── Reddit — tiered like the last30days skill ────────────────────────────────
// Tier 0: the legacy .json search (403s from most datacenter IPs, but free to try).
// Tier 1: RSS search for discovery + shreddit /svc listing partials for real
// upvote scores — the keyless path Reddit still serves where .json is blocked.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url, { timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Single-pass entity decoding via callback — never decodes `&amp;` before the
// other entities (the classic double-unescaping hazard, CodeQL js/double-escaping).
const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#039': "'" };
const decodeEntities = (s) => String(s).replace(/&(amp|lt|gt|quot|apos|#0?39);/g, (match, name) => ENTITY_MAP[name] ?? match);
const postIdFrom = (url) => /\/comments\/([a-z0-9]+)/i.exec(String(url))?.[1] || null;

// Atom entries from /search.rss — only real posts (links containing /comments/).
export function parseRedditRss(xml) {
  const posts = [];
  for (const [, entry] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const link = /<link href="([^"]*)"/.exec(entry)?.[1] || '';
    if (!link.includes('/comments/')) continue; // subreddit/user suggestions, not posts
    const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] || '';
    const updated = /<updated>([^<]*)<\/updated>/.exec(entry)?.[1] || '';
    const sub = /reddit\.com\/(r\/[^/]+)\//.exec(link)?.[1] || '';
    posts.push({
      title: decodeEntities(title.trim()),
      url: link,
      postId: postIdFrom(link),
      subreddit: sub,
      date: updated.slice(0, 10),
    });
  }
  return posts;
}

// shreddit listing partial → full posts (title, subreddit, score, comments).
export function parseShredditPosts(html) {
  const posts = [];
  const seen = new Set();
  for (const [, attrs] of String(html).matchAll(/<shreddit-post\b([^>]*)>/g)) {
    const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
    const permalink = attr('permalink') || '';
    const id = postIdFrom(permalink);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    posts.push({
      id,
      title: decodeEntities(attr('post-title') || ''),
      subreddit: /^\/(r\/[^/]+)\//.exec(permalink)?.[1] || '',
      score: Number(attr('score')) || 0,
      comments: Number(attr('comment-count')) || 0,
      date: (attr('created-timestamp') || '').slice(0, 10),
    });
  }
  return posts;
}

// shreddit listing partial → real scores, keyed by post id.
export function parseShredditListing(html) {
  return new Map(parseShredditPosts(html).map((p) => [p.id, { score: p.score, comments: p.comments }]));
}

// Body text of a single post, from its per-post RSS feed (the same keyless
// channel as search.rss). The <content> element carries the post HTML.
export function parsePostRssBody(xml) {
  const m = /<content type="html">([\s\S]*?)<\/content>/.exec(String(xml));
  if (!m) return '';
  // Reddit double-encodes the content HTML. Unwrap ONLY the outer encoding
  // layer explicitly (&amp;lt; → &lt;), then decode once — never blanket-
  // unescape the same string twice (CodeQL js/double-escaping).
  const unwrapped = m[1].replace(/&amp;(#?\w+;)/g, '&$1');
  let text = decodeEntities(unwrapped);
  text = text.replace(/<[^>]+>/g, ' ').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.replace(/submitted by\s+\/u\/\S+.*$/i, '').trim();
}

const postBodyCache = new Map();
export async function getPostBody(subreddit, id) {
  const sub = String(subreddit || '').replace(/^\/+|\/+$/g, '');
  if (!sub || !id) return '';
  const key = `${sub}/${id}`;
  const hit = postBodyCache.get(key);
  if (hit && Date.now() - hit.t < 12 * 3600_000) return hit.text;
  let text = '';
  try {
    text = parsePostRssBody(await fetchText(`https://www.reddit.com/${sub}/comments/${id}/.rss`));
  } catch { /* keyless best-effort */ }
  boundedSet(postBodyCache, key, { t: Date.now(), text }, 200);
  return text;
}

async function redditJson(topic) {
  const qs = new URLSearchParams({ q: topic, sort: 'top', t: 'month', limit: '8' });
  const data = await fetchJSON(`https://www.reddit.com/search.json?${qs}`, { headers: { Accept: 'application/json' } });
  return (data?.data?.children || [])
    .map((c) => c.data)
    .filter((p) => p && p.title)
    .map((p) => ({ title: p.title, subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`, score: p.score || 0, comments: p.num_comments || 0 }));
}

async function redditRssWithScores(topic) {
  const qs = new URLSearchParams({ q: topic, sort: 'relevance', t: 'month' });
  const xml = await fetchText(`https://www.reddit.com/search.rss?${qs}`);
  const cutoff = new Date(Date.now() - 30 * DAY * 1000).toISOString().slice(0, 10);
  const posts = parseRedditRss(xml).filter((p) => p.date >= cutoff);
  if (!posts.length) return [];

  // Backfill real scores from the top 2 subreddits' listing partials (skill's
  // score-only backfill — listings are never merged in as discovery).
  const counts = new Map();
  for (const p of posts) counts.set(p.subreddit, (counts.get(p.subreddit) || 0) + 1);
  const topSubs = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([sub]) => sub.replace(/^r\//, '')).filter(Boolean);
  const scoreMaps = await Promise.all(topSubs.map((sub) =>
    fetchText(`https://www.reddit.com/svc/shreddit/community-more-posts/top/?name=${encodeURIComponent(sub)}&t=month`)
      .then(parseShredditListing)
      .catch(() => new Map())));
  for (const p of posts) {
    for (const m of scoreMaps) {
      const s = p.postId && m.get(p.postId);
      if (s) { p.score = s.score; p.comments = s.comments; break; }
    }
  }
  return posts.map(({ title, subreddit, score, comments, date }) => ({ title, subreddit, score: score ?? null, comments: comments ?? null, date }));
}

async function reddit(topic) {
  let posts = [];
  try { posts = await redditJson(topic); } catch { /* 403 wall — fall through to RSS */ }
  if (!posts.length) {
    try { posts = await redditRssWithScores(topic); } catch { return null; }
  }
  if (!posts.length) return null;
  posts.sort((a, b) => ((b.score || 0) + (b.comments || 0)) - ((a.score || 0) + (a.comments || 0)));
  return { source: 'Reddit', count: posts.length, items: posts.slice(0, 6) };
}

const cache = new Map();
const TTL = 6 * 3600_000; // 6h — discussion volume moves slowly day-to-day

// Returns a compact 30-day digest for a topic, or null if nothing usable.
export async function getSocialPulse(rawTopic) {
  const topic = String(rawTopic || '').trim();
  if (!topic) return null;
  const key = topic.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const stored = kv.get(`pulse:${key}`);
  if (stored) { boundedSet(cache, key, { t: Date.now(), data: stored }, 200); return stored; }

  const [hn, pm, rd] = await Promise.all([
    track('hackernews', () => hackerNews(topic), { emptyIsFailure: false }).catch(() => null),
    track('polymarket', () => polymarket(topic)).catch(() => null),
    reddit(topic).catch(() => null), // Reddit health tracked in the buzz scan (clearer signal)
  ]);

  const sources = [hn, pm, rd].filter((s) => s && (s.items?.length || s.count));
  const data = sources.length
    ? { topic, generatedAt: new Date().toISOString(), window: 'last 30 days', sources }
    : null;
  boundedSet(cache, key, { t: Date.now(), data }, 200);
  if (data) kv.set(`pulse:${key}`, data, TTL);
  return data;
}

// Render the digest into compact prompt lines (source-attributed, engagement-weighted).
export function socialPulseToLines(pulse) {
  if (!pulse?.sources?.length) return [];
  const lines = [`Last 30 days — what people are actually discussing (live social/forum signal, ${pulse.window}):`];
  for (const s of pulse.sources) {
    if (s.source === 'Hacker News') {
      lines.push(`- Hacker News: ~${s.count} stories in 30 days (top by engagement):`);
      for (const h of s.items.slice(0, 6)) lines.push(`  · "${h.title}" (${h.points} pts, ${h.comments} comments)`);
    } else if (s.source === 'Reddit') {
      lines.push('- Reddit (top threads this month):');
      for (const p of s.items.slice(0, 5)) {
        const engagement = p.score != null && p.score > 0
          ? `, ${p.score} upvotes${p.comments ? `, ${p.comments} comments` : ''}`
          : p.date ? `, ${p.date}` : '';
        lines.push(`  · "${p.title}" (${p.subreddit}${engagement})`);
      }
    } else if (s.source === 'Polymarket') {
      lines.push('- Polymarket prediction markets (forward-looking odds, by volume):');
      for (const e of s.items.slice(0, 5)) {
        const odds = e.topMarket ? ` — "${e.topMarket.question}" at ${e.topMarket.pct}% implied` : '';
        lines.push(`  · ${e.title}${odds} ($${Math.round(e.volume).toLocaleString('en-US')} volume${e.endDate ? `, resolves ${e.endDate}` : ''})`);
      }
    }
  }
  lines.push('Treat this as a sentiment/attention snapshot, not fundamentals — it shows what the crowd is focused on and where prediction markets are pricing outcomes.');
  return lines;
}
