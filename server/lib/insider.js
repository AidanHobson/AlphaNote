// Insider Explorer — market-wide Form 4 insider transactions from SEC EDGAR.
// EDGAR's "getcurrent" feed lists the most recent Form 4 filings across ALL
// issuers; we fetch each submission, parse the standardized ownershipDocument
// XML, and extract issuer/insider/role/side/shares/price + the 10b5-1 plan flag.
// Market cap & sector are best-effort enriched via Finnhub (bounded).

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

function parseForm4(txt) {
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

let cache = { t: 0, data: null };

export async function getInsiderTransactions() {
  if (cache.data && Date.now() - cache.t < 3 * 3600_000) return cache.data; // 3h cache (heavy scan)

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

  // Best-effort market-cap / sector enrichment for the most common tickers.
  const uniq = [...new Set(txns.map((t) => t.symbol))].slice(0, 60);
  const profiles = {};
  await mapLimit(uniq, 3, async (sym) => { const p = await getCompanyProfile(sym).catch(() => null); if (p) profiles[sym] = p; });
  for (const t of txns) {
    const p = profiles[t.symbol];
    if (p) { t.sector = p.finnhubIndustry || ''; t.marketCap = p.marketCapitalization || 0; if ((!t.company || t.company.length < 2) && p.name) t.company = p.name; }
  }

  txns.sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || '') || (b.transactionDate || '').localeCompare(a.transactionDate || ''));

  const data = {
    generatedAt: new Date().toISOString(),
    source: 'SEC EDGAR — recent Form 4 filings (market-wide)',
    count: txns.length,
    tickers: new Set(txns.map((t) => t.symbol)).size,
    transactions: txns.slice(0, 800),
  };
  if (txns.length) cache = { t: Date.now(), data };
  return data;
}
