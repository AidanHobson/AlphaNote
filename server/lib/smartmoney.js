// Smart Money — institutional holdings from SEC EDGAR 13F-HR filings (free, no
// key). A curated set of well-known managers; for each we fetch the latest TWO
// filings, aggregate the information table by CUSIP (large filers report many
// rows per issuer across sub-managers), and diff quarter-over-quarter
// (new / added / trimmed / exited). Long share positions only (puts/calls and
// principal-amount rows are excluded). Cached 12h per manager — filings are
// quarterly, and SEC asks for gentle request rates.

import { boundedSet } from './utils.js';
import { tickerForCompanyName } from './fundamentals.js';
import kv from './kvcache.js';

const UA = process.env.SEC_USER_AGENT || 'AlphaNote markets-research dashboard';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };

// Verified against EDGAR: every CIK files 13F-HR (latest report dates checked).
export const MANAGERS = [
  { cik: 1067983, name: 'Berkshire Hathaway', short: 'Berkshire' },
  { cik: 1336528, name: 'Pershing Square Capital', short: 'Pershing Square' },
  { cik: 1649339, name: 'Scion Asset Management', short: 'Scion (Burry)' },
  { cik: 1536411, name: 'Duquesne Family Office', short: 'Druckenmiller' },
  { cik: 1029160, name: 'Soros Fund Management', short: 'Soros' },
  { cik: 1656456, name: 'Appaloosa LP', short: 'Appaloosa' },
  { cik: 1040273, name: 'Third Point', short: 'Third Point' },
  { cik: 1061768, name: 'Baupost Group', short: 'Baupost' },
  { cik: 1167483, name: 'Tiger Global Management', short: 'Tiger Global' },
  { cik: 1697748, name: 'ARK Investment Management', short: 'ARK' },
  { cik: 1350694, name: 'Bridgewater Associates', short: 'Bridgewater' },
  { cik: 1037389, name: 'Renaissance Technologies', short: 'RenTech' },
  { cik: 1423053, name: 'Citadel Advisors', short: 'Citadel' },
];
const ALLOWED_CIKS = new Set(MANAGERS.map((m) => m.cik));

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  return res.json();
}
async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  return res.text();
}

// Parse a 13F information-table XML into raw rows. Regex-based (namespace-
// tolerant), same approach as the Form 4 parser.
export function parse13F(xml) {
  const rows = [];
  const tables = xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) || [];
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`));
    return m ? m[1].trim() : '';
  };
  for (const t of tables) {
    rows.push({
      name: tag(t, 'nameOfIssuer'),
      klass: tag(t, 'titleOfClass'),
      cusip: tag(t, 'cusip'),
      value: Number(tag(t, 'value')) || 0, // whole USD since 2023
      shares: Number(tag(t, 'sshPrnamt')) || 0,
      sharesType: tag(t, 'sshPrnamtType') || 'SH',
      putCall: tag(t, 'putCall') || null,
    });
  }
  return rows;
}

// Aggregate raw rows by CUSIP — long share positions only.
export function aggregateHoldings(rows) {
  const byCusip = new Map();
  for (const r of rows) {
    if (r.putCall || r.sharesType !== 'SH' || !r.cusip) continue;
    const h = byCusip.get(r.cusip) || { cusip: r.cusip, name: r.name, klass: r.klass, value: 0, shares: 0 };
    h.value += r.value;
    h.shares += r.shares;
    byCusip.set(r.cusip, h);
  }
  return [...byCusip.values()].sort((a, b) => b.value - a.value);
}

// Quarter-over-quarter change per holding + the exits list.
export function diffHoldings(current, prior) {
  const priorBy = new Map(prior.map((h) => [h.cusip, h]));
  const out = current.map((h) => {
    const p = priorBy.get(h.cusip);
    if (!p || !p.shares) return { ...h, change: { type: 'new' } };
    const dp = ((h.shares - p.shares) / p.shares) * 100;
    const type = dp > 1 ? 'add' : dp < -1 ? 'trim' : 'flat';
    return { ...h, change: { type, sharesPct: Number(dp.toFixed(1)) } };
  });
  const currentBy = new Set(current.map((h) => h.cusip));
  const exits = prior.filter((h) => !currentBy.has(h.cusip)).sort((a, b) => b.value - a.value).slice(0, 8)
    .map((h) => ({ name: h.name, cusip: h.cusip, priorValue: h.value }));
  return { holdings: out, exits };
}

async function infotableXml(cik, accession) {
  const acc = accession.replace(/-/g, '');
  const idx = await fetchJSON(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/index.json`);
  const xmls = (idx.directory?.item || []).filter((f) => f.name.endsWith('.xml') && !/primary_doc/i.test(f.name));
  if (!xmls.length) throw new Error('no information table in filing');
  xmls.sort((a, b) => Number(b.size) - Number(a.size)); // the holdings table is the big one
  return fetchText(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${xmls[0].name}`);
}

const cache = new Map(); // cik → { t, promise }
const TTL_MS = 12 * 3600_000;

async function buildBoard(manager) {
  const cik10 = String(manager.cik).padStart(10, '0');
  const subs = await fetchJSON(`https://data.sec.gov/submissions/CIK${cik10}.json`);
  const r = subs.filings.recent;
  const filings = [];
  for (let i = 0; i < r.form.length && filings.length < 2; i++) {
    if (r.form[i] === '13F-HR') filings.push({ accession: r.accessionNumber[i], period: r.reportDate[i] });
  }
  if (!filings.length) return { available: false, reason: 'No 13F-HR filings found for this manager.' };

  const current = aggregateHoldings(parse13F(await infotableXml(manager.cik, filings[0].accession)));
  let prior = [];
  if (filings[1]) {
    try { prior = aggregateHoldings(parse13F(await infotableXml(manager.cik, filings[1].accession))); }
    catch { /* QoQ becomes unavailable; holdings still shown */ }
  }
  const { holdings, exits } = diffHoldings(current, prior);

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const top = holdings.slice(0, 30);
  // best-effort ticker links (conservative exact-normalized matches)
  await Promise.all(top.map(async (h) => { h.ticker = await tickerForCompanyName(h.name); }));

  return {
    available: true,
    manager: { cik: manager.cik, name: manager.name },
    period: filings[0].period,
    priorPeriod: filings[1]?.period || null,
    totalValue,
    positions: holdings.length,
    holdings: top.map((h) => ({
      name: h.name, klass: h.klass, ticker: h.ticker || null,
      value: h.value, shares: h.shares,
      pct: totalValue ? Number(((h.value / totalValue) * 100).toFixed(1)) : 0,
      change: h.change,
    })),
    exits,
    source: 'SEC EDGAR 13F-HR (long share positions)',
  };
}

export function listManagers() {
  return MANAGERS.map(({ cik, name, short }) => ({ cik, name, short }));
}

export async function getManagerBoard(cikRaw) {
  const cik = Number(cikRaw);
  const manager = MANAGERS.find((m) => m.cik === cik);
  if (!ALLOWED_CIKS.has(cik) || !manager) return { available: false, reason: 'Unknown manager.' };

  const hit = cache.get(cik);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.promise;
  // Second tier: persistent kv cache keeps boards warm across restarts — a
  // cold 13F warm-up is ~50 EDGAR fetches, the slowest path in the app.
  const stored = kv.get(`13f:${cik}`);
  if (stored) {
    const promise = Promise.resolve(stored);
    boundedSet(cache, cik, { t: Date.now(), promise }, 16);
    return promise;
  }
  const promise = buildBoard(manager).then((board) => {
    if (board?.available) kv.set(`13f:${cik}`, board, TTL_MS);
    return board;
  }).catch((e) => {
    cache.delete(cik);
    console.warn('smartmoney failed:', e.message);
    return { available: false, reason: 'Could not load 13F filings right now.' };
  });
  boundedSet(cache, cik, { t: Date.now(), promise }, 16);
  return promise;
}

// Cross-reference one ticker against every tracked manager's latest 13F top
// holdings. Boards are 12h-cached, so after the first warm-up this is free;
// the time budget keeps a cold first call from stalling a research note.
export async function findSymbolAcrossManagers(symbol, { budgetMs = 25_000 } = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];
  const results = [];
  const queue = [...MANAGERS];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const m = queue.shift();
      try {
        const board = await getManagerBoard(m.cik);
        if (!board?.available) continue;
        const h = board.holdings.find((x) => x.ticker === sym);
        if (h) results.push({ manager: board.manager.name, period: board.period, value: h.value, pct: h.pct, change: h.change });
      } catch { /* skip this manager */ }
    }
  });
  // Partial results are fine — `results` is shared, so a timeout returns what's in.
  await Promise.race([Promise.all(workers), new Promise((r) => setTimeout(r, budgetMs))]);
  return results.sort((a, b) => b.value - a.value);
}
