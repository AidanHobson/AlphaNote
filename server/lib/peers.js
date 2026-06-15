// Peer comparables — relative-valuation context the deep-research note lacked.
// Fetches a symbol's Finnhub peers, then derives each peer's multiples from its
// (cached) market cap + EDGAR TTM fundamentals, so the note can place the
// subject's valuation against its set. Best-effort and quota-friendly: cached
// histories/fundamentals are free, peers are a small recurring universe.

import { getPeers, getCompanyProfile } from './finnhub.js';
import { getFundamentals } from './fundamentals.js';
import { computeValuation } from './research.js';
import kv from './kvcache.js';

const TTL = 12 * 3600_000;
const MAX_PEERS = 4;

async function multiplesFor(symbol, profile) {
  const prof = profile || await getCompanyProfile(symbol).catch(() => null);
  if (!prof?.marketCapitalization) return null;
  const fundamentals = await getFundamentals(symbol).catch(() => null);
  const v = computeValuation(prof, fundamentals);
  if (!v) return null;
  return {
    symbol,
    name: prof.name || symbol,
    marketCap: v.marketCap,
    pe: v.pe, ps: v.ps, evEbitda: v.evEbitda, fcfYield: v.fcfYield,
  };
}

// Subject (first, tagged) + up to MAX_PEERS peers with derived multiples.
export async function getPeerComps(symbol, subjectProfile) {
  const sym = String(symbol).toUpperCase();
  const cached = kv.get(`peers-comps:${sym}`);
  if (cached) return cached;

  const subject = await multiplesFor(sym, subjectProfile);
  if (!subject) return [];
  const peers = await getPeers(sym, { limit: MAX_PEERS });
  const peerRows = (await Promise.all(peers.map((p) => multiplesFor(p).catch(() => null)))).filter(Boolean);

  const rows = [{ ...subject, subject: true }, ...peerRows];
  if (rows.length >= 2) kv.set(`peers-comps:${sym}`, rows, TTL);
  return rows;
}
