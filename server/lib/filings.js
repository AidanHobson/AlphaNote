// SEC EDGAR filing-narrative research — the qualitative counterpart to the XBRL
// numbers. Reads the actual filings: recent 8-K material events, plus the MD&A
// and Risk Factors narrative from the latest 10-K/10-Q. Free, keyless; SEC asks
// for a descriptive User-Agent and ~10 req/s, so each company's result is
// kv-cached ~6h. US filers only (a CIK is required — non-US ADRs/ETFs have none).

import kv from './kvcache.js';
import { recordOutcome } from './source-health.js';

const UA = process.env.SEC_USER_AGENT || 'AlphaNote markets-research dashboard';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };
const FILINGS_TTL = 6 * 3600_000;

// Material 8-K items worth surfacing, with plain-language labels. Items not in
// this map are still listed by number (the SEC's own meaning is stable).
const ITEM_LABELS = {
  '1.01': 'entry into a material agreement',
  '1.02': 'termination of a material agreement',
  '1.03': 'bankruptcy or receivership',
  '2.01': 'completion of an acquisition or disposition',
  '2.02': 'results of operations (earnings release)',
  '2.03': 'creation of a material financial obligation',
  '2.04': 'triggering of a financial obligation',
  '2.05': 'costs associated with exit or disposal',
  '2.06': 'material impairment',
  '3.01': 'delisting or listing-standard notice',
  '3.02': 'unregistered sale of equity',
  '4.01': "change in the registrant's accountant",
  '4.02': 'non-reliance on previously issued financials',
  '5.01': 'change in control',
  '5.02': 'departure or appointment of directors/officers',
  '5.03': 'amendment to bylaws or fiscal year',
  '5.07': 'submission of matters to a shareholder vote',
  '7.01': 'Regulation FD disclosure',
  '8.01': 'other material events',
};

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC ${res.status}`); // status only — nothing to leak
  return res.text();
}

export async function fetchSubmissions(cik) {
  const c = String(cik).padStart(10, '0');
  return JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${c}.json`));
}

const docUrl = (cik, accession, doc) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accession).replace(/-/g, '')}/${doc}`;

// Zip the parallel-array "recent filings" table into objects (newest first, as
// the SEC returns it).
export function zipRecent(recent) {
  if (!recent?.form) return [];
  const out = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (!recent.primaryDocument[i]) continue; // no readable document
    out.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      reportDate: recent.reportDate?.[i] || null,
      accession: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      items: String(recent.items?.[i] || '').split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

// The filings worth reading: the single most-recent periodic report (10-K/10-Q)
// for narrative, and up to `maxEvents` recent 8-K material events.
export function pickFilings(filings, { maxEvents = 3 } = {}) {
  const isPeriodic = (f) => /^10-[KQ](\/A)?$/.test(f.form);
  const isEvent = (f) => /^8-K(\/A)?$/.test(f.form);
  return {
    periodic: filings.find(isPeriodic) || null,
    events: filings.filter(isEvent).slice(0, maxEvents),
  };
}

// HTML → plain text, CodeQL-safe: drop script/style, strip tags to a fixed point,
// decode entities in a single pass, THEN remove any stray angle brackets — so no
// "<script" can survive a decode step.
export function htmlToText(html) {
  let t = String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  let prev;
  do { prev = t; t = t.replace(/<[^<>]*>/g, ' '); } while (t !== prev);
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  t = t.replace(/&(#?[a-z0-9]+);/gi, (_m, e) => {
    const k = e.toLowerCase();
    if (k in named) return named[k];
    if (/^#\d+$/.test(e)) return String.fromCharCode(Number(e.slice(1)));
    if (/^#x[0-9a-f]+$/i.test(e)) return String.fromCharCode(parseInt(e.slice(2), 16));
    return ' ';
  });
  t = t.replace(/[<>]/g, ' ');
  return t.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Bounded excerpt of a named section. The table-of-contents mention of a section
// header comes BEFORE the section itself, so we take the LAST header match and
// read forward. Returns null if not found or the slice is implausibly short.
export function extractSection(text, headerRegexes, { chars = 2600 } = {}) {
  if (!text) return null;
  let bestIdx = -1;
  for (const re of headerRegexes) {
    for (const m of text.matchAll(re)) if (m.index > bestIdx) bestIdx = m.index;
  }
  if (bestIdx < 0) return null;
  const slice = text.slice(bestIdx, bestIdx + chars).replace(/\s+/g, ' ').trim();
  return slice.length > 240 ? slice : null;
}

const MDNA_HEADERS = [
  /item\s*[27]\b[.:)\s-]*management[\s\S]{0,8}discussion and analysis/gi,
  /management[\s\S]{0,8}discussion and analysis of financial condition/gi,
];
const RISK_HEADERS = [
  /item\s*1a\b[.:)\s-]*risk factors/gi,
  /\brisk factors\b/gi,
];

async function readPeriodic(cik, f) {
  const text = htmlToText(await fetchText(docUrl(cik, f.accession, f.primaryDocument)));
  const mdna = extractSection(text, MDNA_HEADERS, { chars: 2600 });
  const riskFactors = extractSection(text, RISK_HEADERS, { chars: 2200 });
  if (!mdna && !riskFactors) return null;
  return { form: f.form, filingDate: f.filingDate, url: docUrl(cik, f.accession, f.primaryDocument), mdna, riskFactors };
}

async function readEvent(cik, f) {
  let excerpt = null;
  try { excerpt = htmlToText(await fetchText(docUrl(cik, f.accession, f.primaryDocument))).slice(0, 900).trim(); }
  catch { /* the item labels alone are still useful */ }
  return {
    form: f.form, filingDate: f.filingDate, url: docUrl(cik, f.accession, f.primaryDocument),
    items: f.items.map((c) => `Item ${c}${ITEM_LABELS[c] ? ` — ${ITEM_LABELS[c]}` : ''}`),
    excerpt: excerpt && excerpt.length > 120 ? excerpt : null,
  };
}

// Orchestrates the read for one company. Returns null (not an error) whenever
// there's no CIK or nothing usable, so the research note degrades gracefully.
export async function getFilingResearch(cik, { force = false } = {}) {
  if (!cik) return null;
  const key = `filings:${cik}`;
  if (!force) { const cached = kv.get(key); if (cached) return cached; }

  let subs;
  try { subs = await fetchSubmissions(cik); }
  catch (e) { recordOutcome('sec-filings', false, e.message); return null; }

  const { periodic, events } = pickFilings(zipRecent(subs.filings?.recent));
  const [periodicOut, ...eventOut] = await Promise.all([
    periodic ? readPeriodic(cik, periodic).catch(() => null) : Promise.resolve(null),
    ...events.map((e) => readEvent(cik, e).catch(() => null)),
  ]);

  const out = {
    available: Boolean(periodicOut) || eventOut.some(Boolean),
    periodic: periodicOut,
    events: eventOut.filter(Boolean),
  };
  recordOutcome('sec-filings', out.available);
  if (out.available) kv.set(key, out, FILINGS_TTL);
  return out.available ? out : null;
}
