// Keyless web-search snippets (DuckDuckGo Lite) — used to ground the
// market-size/forecast sections of speculative notes in CURRENT sources
// instead of training-data memories. Snippets are claims by their source
// sites (often research-firm marketing); the prompts say to cite the domain
// and treat ranges across sources as the honest picture.

import { boundedSet } from './utils.js';
import kv from './kvcache.js';
import { recordOutcome } from './source-health.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TTL = 12 * 3600_000;
const cache = new Map();

const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export function parseLiteResults(html, count = 5) {
  const links = [...String(html).matchAll(/<a[^>]*href=['"]([^'"]*)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...String(html).matchAll(/<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g)];
  const out = [];
  for (let i = 0; i < Math.min(links.length, count); i++) {
    const [, href, title] = links[i];
    let domain = '';
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    if (uddg) {
      try { domain = new URL(decodeURIComponent(uddg)).hostname.replace(/^www\./, ''); } catch { /* keep '' */ }
    }
    const snippet = snippets[i] ? strip(snippets[i][1]) : '';
    if (!snippet) continue;
    out.push({ title: strip(title), snippet: snippet.slice(0, 320), domain });
  }
  return out;
}

export async function searchSnippets(query, { count = 4 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const stored = kv.get(`web:${key}`);
  if (stored) { boundedSet(cache, key, { t: Date.now(), data: stored }, 200); return stored; }

  let results = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA }, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) results = parseLiteResults(await res.text(), count);
    recordOutcome('websearch', res.ok);
  } catch (err) { recordOutcome('websearch', false, err?.message); /* notes fall back to labelled estimates */ }

  boundedSet(cache, key, { t: Date.now(), data: results }, 200);
  if (results.length) kv.set(`web:${key}`, results, TTL);
  return results;
}

// Prompt block: current forecast snippets for a market/topic, or [] when the
// search yields nothing (the prompts then fall back to vintage-labelled
// training-data estimates).
export async function marketSnippetLines(topic) {
  const results = await searchSnippets(`${topic} market size forecast CAGR`, { count: 6 });
  // One snippet per domain — a range across DIFFERENT sources is the honest
  // picture; three quotes from the same research firm are not.
  const seen = new Set();
  const distinct = results.filter((r) => {
    const key = r.domain || r.snippet.slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
  if (!distinct.length) return [];
  const lines = [`Live web search (DuckDuckGo, fetched today) — current market-size/forecast snippets for "${topic}" from ${distinct.length} distinct source${distinct.length > 1 ? 's' : ''}. Prefer and cite these (by source domain) over training-data figures; they are claims by their sources, so present the range where sources disagree:`];
  for (const r of distinct) lines.push(`- "${r.snippet}" (${r.domain || 'unknown source'})`);
  return lines;
}
