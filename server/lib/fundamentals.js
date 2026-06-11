// SEC EDGAR XBRL fundamentals — real per-company financials straight from filings.
// Free, no API key. SEC asks for a descriptive User-Agent and ~10 req/s max, so
// everything is cached aggressively: the ticker→CIK map (~24h) and each company's
// facts blob (~12h). US filers only.

import { boundedSet } from './utils.js';

const UA = process.env.SEC_USER_AGENT || 'AlphaNote markets-research dashboard';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };

let tickerMap = { t: 0, data: null };       // TICKER → { cik, title }
const factsCache = new Map();               // cik → { t, data }
const TICKER_TTL = 24 * 3600_000;
const FACTS_TTL = 12 * 3600_000;

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC ${res.status}`); // status only — no secrets to leak
  return res.json();
}

async function getCompany(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!tickerMap.data || Date.now() - tickerMap.t > TICKER_TTL) {
    const raw = await fetchJSON('https://www.sec.gov/files/company_tickers.json');
    const map = new Map();
    for (const v of Object.values(raw)) map.set(String(v.ticker).toUpperCase(), { cik: String(v.cik_str).padStart(10, '0'), title: v.title });
    tickerMap = { t: Date.now(), data: map };
  }
  return tickerMap.data.get(sym) || null;
}

// Best-effort issuer-name → ticker (for linking 13F holdings to the Explorer).
// Conservative: exact match on aggressively-normalized names only.
export function normalizeIssuerName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|PLC|LLC|LP|HOLDINGS?|GROUP|CL|CLASS|COM|NEW|DEL|ADR|SPONSORED|A|B|C)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
let nameIndex = { t: 0, map: null };
export async function tickerForCompanyName(name) {
  // reuse the same 24h-cached SEC ticker map
  await getCompany('AAPL'); // ensures tickerMap is loaded
  if (!nameIndex.map || nameIndex.t !== tickerMap.t) {
    const m = new Map();
    for (const [ticker, info] of tickerMap.data) {
      const key = normalizeIssuerName(info.title);
      if (key && !m.has(key)) m.set(key, ticker); // first (most liquid listing) wins
    }
    nameIndex = { t: tickerMap.t, map: m };
  }
  return nameIndex.map.get(normalizeIssuerName(name)) || null;
}

async function getFacts(cik) {
  const hit = factsCache.get(cik);
  if (hit && Date.now() - hit.t < FACTS_TTL) return hit.data;
  const data = await fetchJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  boundedSet(factsCache, cik, { t: Date.now(), data }, 64); // cap: facts blobs are multi-MB
  return data;
}

// Annual (10-K, fiscal-year) series, oldest-first, deduped by FY. Tries every
// candidate tag and keeps the one with the MOST RECENT data (companies migrate
// concepts over time, e.g. NVDA moved revenue from
// RevenueFromContractWithCustomerExcludingAssessedTax → Revenues), breaking ties
// by longer history. Flow items are restricted to ~full-year periods.
function annual(facts, tags, unit = 'USD') {
  let best = [];
  for (const tag of tags) {
    const u = facts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!u) continue;
    const byFy = new Map();
    for (const p of u) {
      if (!p.form || !p.form.startsWith('10-K') || p.fp !== 'FY') continue;
      if (p.start && p.end) { const days = (new Date(p.end) - new Date(p.start)) / 86400000; if (days < 300 || days > 400) continue; }
      byFy.set(p.fy, { fy: p.fy, val: p.val, end: p.end || null });
    }
    const arr = [...byFy.values()].sort((a, b) => a.fy - b.fy);
    if (!arr.length) continue;
    if (!best.length || arr.at(-1).fy > best.at(-1).fy || (arr.at(-1).fy === best.at(-1).fy && arr.length > best.length)) best = arr;
  }
  return best;
}

// Quarterly flow series for a tag set: ~3-month-duration points from ANY form,
// deduped by period end, oldest-first.
export function quarterlyPoints(facts, tags, unit = 'USD') {
  let best = [];
  for (const tag of tags) {
    const u = facts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!u) continue;
    const byEnd = new Map();
    for (const p of u) {
      if (!p.start || !p.end) continue;
      const days = (new Date(p.end) - new Date(p.start)) / 86400000;
      if (days < 70 || days > 100) continue;
      byEnd.set(p.end, { start: p.start, end: p.end, val: p.val });
    }
    const arr = [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
    if (!arr.length) continue;
    if (!best.length || arr.at(-1).end > best.at(-1).end || (arr.at(-1).end === best.at(-1).end && arr.length > best.length)) best = arr;
  }
  return best;
}

// Trailing-twelve-months for a flow item: latest FY + post-FY quarters − their
// year-ago counterparts. The naive "sum the last 4 quarterly points" is WRONG
// for companies that file no fiscal-Q4 10-Q (e.g. Apple) — the last 4 points
// then span 5 quarters with a hole. Returns null when counterparts are missing
// (better no TTM than a silently wrong one).
export function computeTTM(annualSeries, quarters) {
  const fy = annualSeries.at(-1);
  if (!fy || fy.val == null) return null;
  if (!fy.end) return null;
  const post = quarters.filter((q) => q.end > fy.end);
  if (!post.length) return { value: fy.val, through: fy.end, quartersBeyondFY: 0 };
  const counterparts = [];
  for (const q of post) {
    const target = new Date(q.end).getTime() - 365.25 * 86400000;
    const match = quarters.find((c) => Math.abs(new Date(c.end).getTime() - target) < 25 * 86400000);
    if (!match) return null;
    counterparts.push(match);
  }
  const value = fy.val + post.reduce((s, q) => s + q.val, 0) - counterparts.reduce((s, q) => s + q.val, 0);
  return { value, through: post.at(-1).end, quartersBeyondFY: post.length };
}

// Latest balance-sheet (instant) value across ALL forms — 10-Qs make it fresh.
export function latestInstant(facts, tags, unit = 'USD') {
  let best = null;
  for (const tag of tags) {
    const u = facts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!u) continue;
    for (const p of u) {
      if (p.start || !p.end) continue; // instants only
      if (!best || p.end > best.end) best = { end: p.end, val: p.val };
    }
  }
  return best;
}

const LINE_ITEMS = [
  { key: 'revenue', label: 'Revenue', kind: 'flow', tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'] },
  { key: 'grossProfit', label: 'Gross Profit', kind: 'flow', tags: ['GrossProfit'] },
  { key: 'operatingIncome', label: 'Operating Income', kind: 'flow', tags: ['OperatingIncomeLoss'] },
  { key: 'netIncome', label: 'Net Income', kind: 'flow', tags: ['NetIncomeLoss'] },
  { key: 'operatingCashFlow', label: 'Operating Cash Flow', kind: 'flow', tags: ['NetCashProvidedByUsedInOperatingActivities'] },
  { key: 'assets', label: 'Total Assets', kind: 'balance', tags: ['Assets'] },
  { key: 'liabilities', label: 'Total Liabilities', kind: 'balance', tags: ['Liabilities'] },
  { key: 'equity', label: "Shareholders' Equity", kind: 'balance', tags: ['StockholdersEquity'] },
  { key: 'cash', label: 'Cash & Equivalents', kind: 'balance', tags: ['CashAndCashEquivalentsAtCarryingValue'] },
  { key: 'longTermDebt', label: 'Long-Term Debt', kind: 'balance', tags: ['LongTermDebtNoncurrent', 'LongTermDebt'] },
];

export async function getFundamentals(symbol) {
  // Sanitize to the ticker charset before doing anything — never echo raw input back.
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  const notFound = () => ({ symbol: sym, available: false, reason: 'No SEC filer found for this ticker (US-listed companies only).' });
  if (!sym) return notFound();
  const co = await getCompany(sym);
  if (!co) return notFound();

  const facts = await getFacts(co.cik);
  const series = {};
  for (const li of LINE_ITEMS) series[li.key] = annual(facts, li.tags);
  series.eps = annual(facts, ['EarningsPerShareDiluted'], 'USD/shares');

  const latestFy = (s) => (s.length ? s.at(-1).fy : null);
  const valueAt = (s, fy) => { let r = null; for (const p of s) if (fy != null && p.fy <= fy) r = p.val; return r; };

  // Align the entire snapshot to ONE fiscal year — the latest FY covered by both
  // revenue and net income — so every line and ratio is from the same period.
  const pair = [latestFy(series.revenue), latestFy(series.netIncome)].filter((v) => v != null);
  const asOfFY = pair.length ? Math.min(...pair) : (latestFy(series.assets) ?? null);

  const lineDefs = [...LINE_ITEMS, { key: 'eps', label: 'Diluted EPS', kind: 'flow', perShare: true, tags: ['EarningsPerShareDiluted'], unit: 'USD/shares' }];

  // Current layer: TTM for flows (FY + post-FY quarters − year-ago counterparts),
  // latest 10-Q instant for balance items — so the card is quarters-fresh, not
  // up to a year stale.
  let currentThrough = null;
  const lineItems = lineDefs.map((li) => {
    const ann = series[li.key];
    let current = null;
    if (li.kind === 'flow') {
      const qs = quarterlyPoints(facts, li.tags, li.unit || 'USD');
      const t = computeTTM(ann, qs);
      if (t) {
        current = { value: li.perShare ? Number(t.value.toFixed(2)) : t.value, asOf: t.through, basis: t.quartersBeyondFY ? 'ttm' : 'fy' };
        if (t.through && (!currentThrough || t.through > currentThrough)) currentThrough = t.through;
      }
    } else {
      const inst = latestInstant(facts, li.tags);
      if (inst) current = { value: inst.val, asOf: inst.end, basis: 'latest' };
    }
    return {
      key: li.key, label: li.label, unit: li.perShare ? 'perShare' : 'usd', kind: li.kind,
      latest: valueAt(ann, asOfFY),
      current,
      history: ann.filter((p) => asOfFY == null || p.fy <= asOfFY).slice(-6).map(({ fy, val }) => ({ fy, val })),
    };
  });

  // Ratios on the freshest coherent numbers: TTM flows over latest instants,
  // falling back to the aligned FY values when a current figure is missing.
  const cur = Object.fromEntries(lineItems.map((li) => [li.key, li.current?.value ?? valueAt(series[li.key] || [], asOfFY)]));
  const pct = (n, d) => (n != null && d) ? Number(((n / d) * 100).toFixed(1)) : null;
  const mult = (n, d) => (n != null && d) ? Number((n / d).toFixed(2)) : null;
  const ratios = [
    { label: 'Gross margin', value: pct(cur.grossProfit, cur.revenue), unit: '%' },
    { label: 'Operating margin', value: pct(cur.operatingIncome, cur.revenue), unit: '%' },
    { label: 'Net margin', value: pct(cur.netIncome, cur.revenue), unit: '%' },
    { label: 'Return on equity', value: pct(cur.netIncome, cur.equity), unit: '%' },
    { label: 'Debt / equity', value: mult(cur.longTermDebt, cur.equity), unit: 'x' },
  ].filter((r) => r.value != null);

  return {
    symbol: sym, available: true, source: 'SEC EDGAR (XBRL)',
    cik: co.cik, name: facts.entityName || co.title, asOfFY, currentThrough, lineItems, ratios,
  };
}
