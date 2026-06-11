// Insider Explorer — market-wide Form 4 insider transactions (open-market P/S).
// Primary source: sec-api.io's structured insider-trading API (when SEC_API_KEY
// is set) — fast, parsed, paginated across the whole market. Fallback: parse SEC
// EDGAR's daily index directly (no key). Both produce the same record shape, then
// a shared finalize() best-effort enriches market cap/sector via Finnhub.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompanyProfile } from './finnhub.js';

const SEC = 'https://www.sec.gov';
const UA = 'AlphaNote research dashboard (aidan.robert.hobson@gmail.com)';

// Global rate gate — serialize request *starts* ≥130ms apart (~7.5/s) so we stay
// safely under SEC EDGAR's 10 req/s fair-access limit regardless of concurrency.
let nextSlot = 0;
async function rateGate() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + 115; // ~8.7 req/s — under SEC's 10/s limit
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

async function secFetch(url, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    await rateGate();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml,text/plain,*/*' } });
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`SEC ${res.status}`);
    return res.text();
  }
}

async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx]); }
  }));
  return out;
}

const qtrOf = (m) => Math.floor((m - 1) / 3) + 1;

// Breadth source: EDGAR's daily index lists EVERY Form 4 filed that day (~2k filings
// across ~1.4k companies). We dedupe to one filing per company and evenly sample
// across the (alphabetical) list so the result spans the whole market, then return
// the submission .txt URLs directly.
async function dailyIndexFilings(target = 170, lookbackDays = 6) {
  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const y = d.getFullYear();
    const ymd = `${y}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    let idx;
    try {
      idx = await secFetch(`${SEC}/Archives/edgar/daily-index/${y}/QTR${qtrOf(d.getMonth() + 1)}/form.${ymd}.idx`);
    } catch { continue; }
    const byCompany = new Map();
    for (const line of idx.split('\n')) {
      if (!line.startsWith('4 ')) continue;
      const m = line.match(/^4\s+(.+?)\s+\d{4,10}\s+\d{8}\s+(edgar\/\S+\.txt)/);
      if (m && !byCompany.has(m[1].trim())) byCompany.set(m[1].trim(), `${SEC}/Archives/${m[2]}`);
    }
    if (byCompany.size < 20) continue; // weekend / holiday — try the previous day
    const all = [...byCompany.values()];
    if (all.length <= target) return all;
    const step = all.length / target; // even A–Z sample for variety
    return Array.from({ length: target }, (_, k) => all[Math.floor(k * step)]);
  }
  return [];
}

const between = (s, tag) => { const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? m[1].trim() : ''; };
const amount = (block) => { const m = block.match(/<value>\s*([\d.]+)\s*<\/value>/); return m ? parseFloat(m[1]) : 0; };

export function parseForm4(txt) {
  const docM = txt.match(/<ownershipDocument>[\s\S]*?<\/ownershipDocument>/);
  if (!docM) return null;
  const doc = docM[0];

  const symbol = between(doc, 'issuerTradingSymbol').toUpperCase();
  const company = between(doc, 'issuerName');
  if (!symbol) return null;

  const filed = txt.match(/FILED AS OF DATE:\s*(\d{8})/);
  const filingDate = filed ? `${filed[1].slice(0, 4)}-${filed[1].slice(4, 6)}-${filed[1].slice(6, 8)}` : '';
  const plan = /rule\s*10b5-1|10b5-1/i.test(doc) ? '10b5-1' : 'Discretionary';

  const rel = between(doc, 'reportingOwnerRelationship');
  const isDirector = between(rel, 'isDirector') === '1' || /<isDirector>\s*true/i.test(rel);
  const isOfficer = between(rel, 'isOfficer') === '1' || /<isOfficer>\s*true/i.test(rel);
  const isTenPercent = between(rel, 'isTenPercentOwner') === '1' || /<isTenPercentOwner>\s*true/i.test(rel);
  const officerTitle = between(rel, 'officerTitle');
  const insider = between(doc, 'rptOwnerName');

  const roles = [];
  if (isDirector) roles.push('Director');
  if (isOfficer) roles.push(officerTitle || 'Officer');
  if (isTenPercent) roles.push('10% Owner');
  const title = roles.join(', ') || 'Other';

  const txns = [];
  for (const tm of doc.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
    const t = tm[1];
    const code = between(t, 'transactionCode');
    if (code !== 'P' && code !== 'S') continue; // open-market buys & sells
    const sharesM = t.match(/<transactionShares>([\s\S]*?)<\/transactionShares>/);
    const priceM = t.match(/<transactionPricePerShare>([\s\S]*?)<\/transactionPricePerShare>/);
    const dateM = t.match(/<transactionDate>([\s\S]*?)<\/transactionDate>/);
    const shares = sharesM ? amount(sharesM[1]) : 0;
    const price = priceM ? amount(priceM[1]) : 0;
    if (!shares) continue;
    txns.push({ code, side: code === 'P' ? 'Buy' : 'Sell', shares, price, value: Math.round(shares * price), transactionDate: dateM ? between(dateM[1], 'value') : '' });
  }
  if (!txns.length) return null;
  return { symbol, company, insider, title, isOfficer, isDirector, isTenPercent, plan, filingDate, txns };
}

// ── Fallback path: parse SEC EDGAR's daily index directly (no key needed) ─────
async function edgarInsider() {
  const urls = await dailyIndexFilings(320);
  const txts = await mapLimit(urls, 6, async (u) => {
    try { return await secFetch(u); } catch { return null; }
  });
  const txns = [];
  for (const txt of txts) {
    if (!txt) continue;
    const f = parseForm4(txt);
    if (!f) continue;
    for (const tx of f.txns) {
      txns.push({
        id: `${f.symbol}-${f.insider}-${tx.transactionDate}-${tx.shares}-${tx.code}-${tx.value}`,
        symbol: f.symbol, company: f.company, sector: '', marketCap: 0,
        insider: f.insider, title: f.title, isOfficer: f.isOfficer, isDirector: f.isDirector, isTenPercent: f.isTenPercent,
        plan: f.plan, side: tx.side, code: tx.code, shares: tx.shares, price: tx.price, value: tx.value,
        transactionDate: tx.transactionDate, filingDate: f.filingDate,
      });
    }
  }
  return txns;
}

// ── Primary path: sec-api.io structured Form 4 data (when SEC_API_KEY is set) ─
export function roleOf(rel = {}) {
  const roles = [];
  if (rel.isDirector) roles.push('Director');
  if (rel.isOfficer) roles.push(rel.officerTitle || 'Officer');
  if (rel.isTenPercentOwner) roles.push('10% Owner');
  if (!roles.length && rel.isOther) roles.push(rel.otherText || 'Other');
  return roles.join(', ') || 'Other';
}

async function secApiPage(from, size) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.sec-api.io/insider-trading?token=${process.env.SEC_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'nonDerivativeTable.transactions.coding.code:(P OR S)', // filings with open-market buys/sells
        from: String(from), size: String(size),
        sort: [{ filedAt: { order: 'desc' } }],
      }),
    });
    if (res.status === 429 && attempt < 1) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    if (!res.ok) { const e = new Error(`sec-api.io ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  }
}

// sec-api.io caps size at 50, so breadth comes from page count. Pages are
// independent (different `from` offsets), so we fetch them with light concurrency.
// `from + size` must stay <= 10000 (Elasticsearch window), i.e. pages <= ~199.
async function secApiInsider(pages = 40, size = 50) {
  const maxPages = Math.min(pages, Math.floor(10000 / size));
  const offsets = Array.from({ length: maxPages }, (_, p) => p * size);
  const pagesData = await mapLimit(offsets, 2, async (from) => { // gentle concurrency (free-plan quota)
    try { return await secApiPage(from, size); }
    catch (e) { if (from === 0) throw e; return null; } // first page must work, else fall back to EDGAR
  });

  const txns = [];
  for (const data of pagesData) {
    for (const f of data?.transactions || []) {
      const symbol = (f.issuer?.tradingSymbol || '').toUpperCase();
      if (!symbol) continue;
      const rel = f.reportingOwner?.relationship || {};
      const company = f.issuer?.name || symbol;
      const insider = f.reportingOwner?.name || '—';
      const title = roleOf(rel);
      const plan = f.aff10b5One === true || /10b5-1/i.test(JSON.stringify(f.footnotes || '')) ? '10b5-1' : 'Discretionary';
      const filingDate = (f.filedAt || '').slice(0, 10);
      for (const tr of f.nonDerivativeTable?.transactions || []) {
        const code = tr.coding?.code;
        if (code !== 'P' && code !== 'S') continue;
        const shares = tr.amounts?.shares || 0;
        const price = tr.amounts?.pricePerShare || 0;
        if (!shares) continue;
        const value = Math.round(shares * price);
        txns.push({
          id: `${f.accessionNo}-${symbol}-${tr.transactionDate}-${shares}-${code}-${value}`,
          symbol, company, sector: '', marketCap: 0, insider, title,
          isOfficer: !!rel.isOfficer, isDirector: !!rel.isDirector, isTenPercent: !!rel.isTenPercentOwner,
          plan, side: code === 'P' ? 'Buy' : 'Sell', code, shares, price, value,
          transactionDate: tr.transactionDate || '', filingDate,
        });
      }
    }
  }
  return txns;
}

// ── Backup path: API Ninjas insider-transactions (per-ticker → curated universe)
// Used when sec-api.io is unavailable. No 10b5-1 flag, so plan defaults to
// "Discretionary"; role is inferred from the insider's position string.
const INSIDER_UNIVERSE = [
  // Tech / comms
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'NFLX', 'CRM',
  'ORCL', 'ADBE', 'INTC', 'CSCO', 'AVGO', 'QCOM', 'TXN', 'MU', 'PLTR', 'SNOW',
  'CRWD', 'NET', 'DDOG', 'PANW', 'ZS', 'UBER', 'ABNB', 'COIN', 'SHOP', 'PYPL',
  'T', 'VZ', 'CMCSA', 'TMUS',
  // Financials
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'AXP', 'BLK', 'SCHW', 'SPGI',
  // Healthcare
  'UNH', 'JNJ', 'LLY', 'PFE', 'MRK', 'ABBV', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD',
  // Consumer
  'WMT', 'COST', 'HD', 'LOW', 'NKE', 'MCD', 'SBUX', 'DIS', 'KO', 'PEP', 'PG', 'TGT',
  // Industrials / energy
  'XOM', 'CVX', 'COP', 'CAT', 'BA', 'GE', 'HON', 'DE', 'LMT', 'RTX', 'UNP', 'UPS',
];

export function ninjasRole(pos = '') {
  const p = pos.toLowerCase();
  return {
    isDirector: /director/.test(p),
    // Word-boundary the short abbreviations so e.g. "cto" doesn't match inside "director".
    isOfficer: /officer|president|chief|chairman|treasurer|secretary|principal|\b(?:ceo|cfo|coo|cto|cio|evp|svp|vp)\b/.test(p),
    isTenPercent: /10%|ten percent|10 percent/.test(p),
  };
}

async function apiNinjasInsider() {
  const results = await mapLimit(INSIDER_UNIVERSE, 5, async (ticker) => {
    try {
      const res = await fetch(`https://api.api-ninjas.com/v1/insidertransactions?ticker=${ticker}&limit=100`, { headers: { 'X-Api-Key': process.env.NINJAS_API_KEY } });
      if (res.status === 401 || res.status === 403) throw new Error(`api-ninjas ${res.status}`); // bad key → abort
      if (!res.ok) return [];
      return res.json();
    } catch (e) { if (/\b40[13]\b/.test(e.message)) throw e; return []; }
  });

  const txns = [];
  for (const rows of results) {
    for (const r of rows || []) {
      const code = r.transaction_code;
      if (code !== 'P' && code !== 'S') continue; // open-market buys/sells only
      const shares = r.shares || 0;
      const price = r.transaction_price || 0;
      if (!shares) continue;
      const value = Math.round(r.transaction_value || shares * price);
      const role = ninjasRole(r.insider_position);
      txns.push({
        id: `${r.accession_number}-${r.ticker}-${r.filing_date}-${shares}-${code}-${value}`,
        symbol: (r.ticker || '').toUpperCase(), company: r.company_name || r.ticker, sector: '', marketCap: 0,
        insider: r.insider_name || '—', title: r.insider_position || 'Other',
        isOfficer: role.isOfficer, isDirector: role.isDirector, isTenPercent: role.isTenPercent,
        plan: 'Discretionary',
        side: code === 'P' ? 'Buy' : 'Sell', code, shares, price, value,
        transactionDate: r.filing_date || '', filingDate: r.filing_date || '',
      });
    }
  }
  return txns;
}

// ── Shared: enrich (market cap/sector), sort, shape ──────────────────────────
async function finalize(txns, source) {
  const uniq = [...new Set(txns.map((t) => t.symbol))].slice(0, 90);
  const profiles = {};
  await mapLimit(uniq, 3, async (sym) => { const p = await getCompanyProfile(sym).catch(() => null); if (p) profiles[sym] = p; });
  for (const t of txns) {
    const p = profiles[t.symbol];
    if (p) { t.sector = p.finnhubIndustry || ''; t.marketCap = p.marketCapitalization || 0; if ((!t.company || t.company.length < 2) && p.name) t.company = p.name; }
  }
  txns.sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || '') || (b.transactionDate || '').localeCompare(a.transactionDate || ''));
  return {
    generatedAt: new Date().toISOString(),
    source,
    count: txns.length,
    tickers: new Set(txns.map((t) => t.symbol)).size,
    transactions: txns.slice(0, 12000),
  };
}

// In-memory + disk cache. The disk copy lets a freshly-started server process
// (e.g. after a restart) serve the last result instantly instead of doing the
// multi-second cold scan again.
let cache = { t: 0, ttl: 0, data: null };
// Cache location, best persistence first:
//   1. next to DB_PATH when set (Render: the persistent disk → survives deploys)
//   2. serverless (read-only project dir) → the platform's writable temp dir
//   3. dev default: project-relative, shared by every locally-launched process
const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT,
);
const DISK_CACHE = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), '.insider-cache.json')
  : IS_SERVERLESS
    ? path.join(os.tmpdir(), 'alphanote-insider-cache.json')
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.insider-cache.json');

function readDiskCache() {
  try {
    const e = JSON.parse(fs.readFileSync(DISK_CACHE, 'utf8'));
    if (e && e.t && e.data && Date.now() - e.t < (e.ttl || 0)) return e;
  } catch { /* missing/stale */ }
  return null;
}

export async function getInsiderTransactions() {
  if (cache.data && Date.now() - cache.t < cache.ttl) return cache.data;
  const disk = readDiskCache();
  if (disk) { cache = disk; return disk.data; }

  let txns = [];
  let source = '';
  if (/\S/.test(process.env.SEC_API_KEY || '')) {
    // ~50 filings/page. Default kept modest because the free sec-api plan has a
    // query quota; raise INSIDER_PAGES (max ~199) on a paid plan for far more.
    const pages = Math.max(1, parseInt(process.env.INSIDER_PAGES, 10) || 24);
    try { txns = await secApiInsider(pages, 50); source = 'sec-api.io — market-wide Form 4'; }
    catch (e) { console.warn('sec-api.io unavailable:', e.message); }
  }
  // Backup 1: API Ninjas (curated universe) when sec-api returned nothing.
  if (!txns.length && /\S/.test(process.env.NINJAS_API_KEY || '')) {
    try { txns = await apiNinjasInsider(); source = 'API Ninjas — insider transactions (curated universe)'; }
    catch (e) { console.warn('API Ninjas unavailable, falling back to EDGAR:', e.message); }
  }
  // Backup 2 (no key needed): parse SEC EDGAR's daily index directly.
  if (!txns.length) { txns = await edgarInsider(); source = 'SEC EDGAR — daily index (market-wide)'; }

  const data = await finalize(txns, source);
  // Cache a good sec-api pull for 12h (conserve quota); cache backups more briefly
  // so we retry the richer primary sooner once its quota resets.
  const ttl = source.startsWith('sec-api') ? 12 * 3600_000 : source.startsWith('API Ninjas') ? 2 * 3600_000 : 30 * 60_000;
  if (txns.length) {
    cache = { t: Date.now(), ttl, data };
    try { fs.writeFileSync(DISK_CACHE, JSON.stringify(cache)); } catch { /* non-fatal */ }
  }
  return data;
}
