// "Last 30 days" social/forum signal — a server-side port of the keyless,
// no-API-key sources from the last30days skill (github.com/mvanhorn/last30days-skill):
// Hacker News via the Algolia API and Polymarket via the Gamma API, plus a
// best-effort Reddit .json attempt (datacenter IPs usually get 403, as the skill
// itself notes, so it's optional). This grounds the SPECULATIVE outlook in what
// people are actually discussing right now — addressing the model's training-cutoff
// blind spot, which is exactly what that mode needs.

import { boundedSet } from './utils.js';

const UA = process.env.SEC_USER_AGENT || 'AlphaNote/1.0 (research dashboard)';
const DAY = 86400;

async function fetchJSON(url, { timeout = 9000, headers = {} } = {}) {
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

// ── Polymarket (Gamma) — prediction-market odds are forward-looking signal ────
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
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
function topMarketOdds(event) {
  const markets = (event.markets || [])
    .map((m) => {
      let outcomes = m.outcomes; let prices = m.outcomePrices;
      try { if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes); } catch { outcomes = null; }
      try { if (typeof prices === 'string') prices = JSON.parse(prices); } catch { prices = null; }
      if (!Array.isArray(outcomes) || !Array.isArray(prices)) return null;
      const yes = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
      const pct = yes >= 0 ? Math.round(toNum(prices[yes]) * 100) : Math.round(toNum(prices[0]) * 100);
      return { question: m.question || event.title, pct, volume: toNum(m.volume) };
    })
    .filter(Boolean)
    .sort((a, b) => b.volume - a.volume);
  return markets[0] || null;
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

// ── Reddit (best-effort; usually 403 from datacenter IPs) ─────────────────────
async function reddit(topic) {
  try {
    const qs = new URLSearchParams({ q: topic, sort: 'top', t: 'month', limit: '8' });
    const data = await fetchJSON(`https://www.reddit.com/search.json?${qs}`, { headers: { Accept: 'application/json' } });
    const posts = (data?.data?.children || [])
      .map((c) => c.data)
      .filter((p) => p && p.title)
      .map((p) => ({ title: p.title, subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`, score: p.score || 0, comments: p.num_comments || 0 }))
      .sort((a, b) => (b.score + b.comments) - (a.score + a.comments));
    if (!posts.length) return null;
    return { source: 'Reddit', count: posts.length, items: posts.slice(0, 6) };
  } catch {
    return null; // 403 / rate-limited — silently skip, the skill expects this
  }
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

  const [hn, pm, rd] = await Promise.all([
    hackerNews(topic).catch(() => null),
    polymarket(topic).catch(() => null),
    reddit(topic).catch(() => null),
  ]);

  const sources = [hn, pm, rd].filter((s) => s && (s.items?.length || s.count));
  const data = sources.length
    ? { topic, generatedAt: new Date().toISOString(), window: 'last 30 days', sources }
    : null;
  boundedSet(cache, key, { t: Date.now(), data }, 200);
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
      for (const p of s.items.slice(0, 5)) lines.push(`  · "${p.title}" (${p.subreddit}, ${p.score} upvotes)`);
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
