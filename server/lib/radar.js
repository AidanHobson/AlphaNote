// Theme Radar — surfaces emerging speculative themes that DON'T have consensus
// names yet, mined from the live signal (broad HN top stories, the Reddit buzz
// board's threads, Polymarket events). Explicitly excludes the canonical named
// themes; every proposed theme must cite evidence from the supplied signal.

import { hnTopStories } from './social.js';
import { getRedditBuzz } from './buzz.js';
import { getMarketPredictions } from './predictions.js';
import { callAIWithFallback } from './ai-provider.js';

export const RADAR_PROMPT = `You are AlphaNote's emerging-themes scout. Your job is to find SPECULATIVE investment themes that do NOT yet have a consensus name — the ones bubbling up in live discussion before they appear on anyone's theme list — using ONLY the signal provided.

Hard exclusions — do NOT propose these or trivial restatements of them: AI/LLMs broadly, AI infrastructure or datacenters, robotics, humanoids, quantum computing, space, defense tech, drones, GLP-1/obesity drugs, EVs, crypto/Bitcoin, photonics, semiconductors broadly, nuclear/SMRs. A valid theme may INTERSECT these (e.g. a specific second-order consequence), but the theme itself must be narrower, stranger, or earlier than the named ones.

Rails (fact-driven):
- Every theme must cite at least TWO distinct pieces of evidence from the supplied signal — quote the thread/story titles or market questions verbatim. No evidence, no theme.
- Propose 3-5 themes. If the signal only supports fewer, return fewer — never pad with a theme the signal does not show.
- General-knowledge additions (e.g. which public companies touch the theme) must be labelled as such, with your training cutoff in mind. Smaller-cap names are welcome where credible; label tiers approximately and flag pre-revenue/liquidity hazards.
- No personalised investment advice. Plain text; bullets start with "- ".

Format — for EACH theme, exactly this shape:
A bold line with the theme name you coin for it (short, evocative, specific — not a sector label).
Then:
- What it is: one or two sentences.
- Evidence: 2-3 bullets quoting the signal verbatim with source (HN / r/... / Polymarket).
- Public-market angle: the earliest credible listed exposure, labelled general knowledge; say if there is none yet (that is itself useful).
- Confirmation: what in the next 6-12 months would tell you this is real.

A final line starting with "Bottom line:" — which one theme you would research first and why, conviction out of 5. Speculative analysis, not investment advice.

Keep the whole note under 650 words.`;

export function buildRadarPrompt({ hn, buzz, predictions }) {
  const lines = [`Live signal snapshot (${new Date().toISOString().slice(0, 10)}):`];

  if (hn?.length) {
    lines.push('');
    lines.push('Hacker News — highest-engagement stories, last 14 days:');
    for (const h of hn.slice(0, 25)) lines.push(`- "${h.title}" (${h.points} pts, ${h.comments} comments, ${h.date})`);
  }

  const threads = (buzz?.items || []).flatMap((i) => (i.posts || []).map((p) => ({ ...p, symbol: i.symbol })));
  if (threads.length) {
    lines.push('');
    lines.push('Reddit finance subreddits — the week\'s most-engaged ticker threads:');
    for (const t of threads.slice(0, 15)) lines.push(`- [${t.symbol}] "${t.title}" (${t.subreddit}, ${t.score} upvotes)`);
  }

  if (predictions?.events?.length) {
    lines.push('');
    lines.push('Polymarket — active market questions by volume:');
    for (const e of predictions.events) {
      lines.push(`- "${e.title}"${e.topMarket ? ` — consensus: "${e.topMarket.question}" at ${e.topMarket.pct}%` : ''}`);
    }
  }

  lines.push('');
  lines.push('Identify the emerging, not-yet-named speculative themes in this signal now.');
  return lines.join('\n');
}

let cache = { t: 0, note: null };
const TTL = 3 * 3600_000;

export async function generateThemeRadar({ force = false, onDelta } = {}) {
  if (!force && cache.note && Date.now() - cache.t < TTL) return { ...cache.note, cached: true };

  const [hn, buzz, predictions] = await Promise.all([
    hnTopStories().catch(() => []),
    getRedditBuzz().catch(() => null),
    getMarketPredictions().catch(() => null),
  ]);
  if (!hn.length && !buzz?.items?.length) {
    throw Object.assign(new Error('Not enough live signal to scan for themes right now.'), { statusCode: 503 });
  }

  const prompt = buildRadarPrompt({ hn, buzz, predictions });
  const { provider, text, fellBack } = await callAIWithFallback(prompt, RADAR_PROMPT, { maxTokens: 1700, onDelta });

  const note = {
    provider,
    fellBack,
    text,
    speculative: true,
    generatedAt: new Date().toISOString(),
    signal: {
      hnStories: hn.length,
      redditThreads: (buzz?.items || []).reduce((s, i) => s + (i.posts?.length || 0), 0),
      predictionEvents: predictions?.events?.length || 0,
    },
  };
  cache = { t: Date.now(), note };
  return { ...note, cached: false };
}
