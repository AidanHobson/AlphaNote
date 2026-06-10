// SEC EDGAR XBRL fundamentals — real per-company financials straight from filings.
// Free, no API key. SEC asks for a descriptive User-Agent and ~10 req/s max, so
// everything is cached aggressively: the ticker→CIK map (~24h) and each company's
// facts blob (~12h). US filers only.

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

async function getFacts(cik) {
  const hit = factsCache.get(cik);
  if (hit && Date.now() - hit.t < FACTS_TTL) return hit.data;
  const data = await fetchJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  factsCache.set(cik, { t: Date.now(), data });
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
      byFy.set(p.fy, { fy: p.fy, val: p.val });
    }
    const arr = [...byFy.values()].sort((a, b) => a.fy - b.fy);
    if (!arr.length) continue;
    if (!best.length || arr.at(-1).fy > best.at(-1).fy || (arr.at(-1).fy === best.at(-1).fy && arr.length > best.length)) best = arr;
  }
  return best;
}

const LINE_ITEMS = [
  { key: 'revenue', label: 'Revenue', tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'] },
  { key: 'grossProfit', label: 'Gross Profit', tags: ['GrossProfit'] },
  { key: 'operatingIncome', label: 'Operating Income', tags: ['OperatingIncomeLoss'] },
  { key: 'netIncome', label: 'Net Income', tags: ['NetIncomeLoss'] },
  { key: 'operatingCashFlow', label: 'Operating Cash Flow', tags: ['NetCashProvidedByUsedInOperatingActivities'] },
  { key: 'assets', label: 'Total Assets', tags: ['Assets'] },
  { key: 'liabilities', label: 'Total Liabilities', tags: ['Liabilities'] },
  { key: 'equity', label: "Shareholders' Equity", tags: ['StockholdersEquity'] },
  { key: 'cash', label: 'Cash & Equivalents', tags: ['CashAndCashEquivalentsAtCarryingValue'] },
  { key: 'longTermDebt', label: 'Long-Term Debt', tags: ['LongTermDebtNoncurrent', 'LongTermDebt'] },
];

export async function getFundamentals(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const co = await getCompany(sym);
  if (!co) return { symbol: sym, available: false, reason: 'No SEC filer found for this ticker (US-listed companies only).' };

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

  const lineDefs = [...LINE_ITEMS, { key: 'eps', label: 'Diluted EPS', perShare: true }];
  const lineItems = lineDefs.map((li) => ({
    key: li.key, label: li.label, unit: li.perShare ? 'perShare' : 'usd',
    latest: valueAt(series[li.key], asOfFY),
    history: series[li.key].filter((p) => asOfFY == null || p.fy <= asOfFY).slice(-6),
  }));

  const v = Object.fromEntries(Object.keys(series).map((k) => [k, valueAt(series[k], asOfFY)]));
  const pct = (n, d) => (n != null && d) ? Number(((n / d) * 100).toFixed(1)) : null;
  const mult = (n, d) => (n != null && d) ? Number((n / d).toFixed(2)) : null;
  const ratios = [
    { label: 'Gross margin', value: pct(v.grossProfit, v.revenue), unit: '%' },
    { label: 'Operating margin', value: pct(v.operatingIncome, v.revenue), unit: '%' },
    { label: 'Net margin', value: pct(v.netIncome, v.revenue), unit: '%' },
    { label: 'Return on equity', value: pct(v.netIncome, v.equity), unit: '%' },
    { label: 'Debt / equity', value: mult(v.longTermDebt, v.equity), unit: 'x' },
  ].filter((r) => r.value != null);

  return {
    symbol: sym, available: true, source: 'SEC EDGAR (XBRL)',
    cik: co.cik, name: facts.entityName || co.title, asOfFY, lineItems, ratios,
  };
}
