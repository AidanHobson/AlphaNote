// Valuation Explorer — headline US equity-market valuation metrics vs their own
// history. Real data only:
//   • Shiller CAPE, Trailing P/E, Dividend Yield, Earnings Yield ← multpl.com
//     (which publishes Robert Shiller's monthly S&P 500 dataset).
//   • Buffett Indicator ← FRED (corporate equities / GDP).
//   • Fed Model Spread ← Earnings Yield − 10Y Treasury (FRED GS10).
// Each metric carries a percentile vs its own full history + a colour for richness.

const FRED_BASE = 'https://api.stlouisfed.org/fred';

// ── fetch helpers ─────────────────────────────────────────────────────────────

// Scrub secret-looking material (query-string keys, long hex / sk- tokens) from
// any string before it's logged or returned to the client. Defense-in-depth so an
// upstream error can never carry a credential out to the browser.
export function redactSecrets(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/([?&](?:api_key|apikey|token|access_token|key)=)[^&\s]+/gi, '$1REDACTED')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'REDACTED')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, 'REDACTED');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AlphaNote research dashboard)' } });
  if (!res.ok) {
    // Never surface the query string — for FRED it carries the api_key.
    let where = url;
    try { const u = new URL(url); where = `${u.host}${u.pathname}`; } catch { /* keep as-is */ }
    throw new Error(`${where} → ${res.status}`);
  }
  return res.text();
}

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

// Per-series cache so the Market + Yields tabs (which share Shiller yields and
// FRED series) don't re-fetch the same source.
const seriesCache = new Map();
async function cached(key, fn) {
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.t < 6 * 3600_000) return hit.v;
  const v = await fn();
  seriesCache.set(key, { t: Date.now(), v });
  return v;
}

// Parse a multpl.com "/table/{period}" page → newest-first [{date:'YYYY-MM-01', value}].
export async function multplSeries(slug, period = 'by-month') {
  return cached(`multpl:${slug}:${period}`, async () => {
    const html = await fetchText(`https://www.multpl.com/${slug}/table/${period}`);
    // Strip HTML entities first — multpl pads values with `&#x2002;` (en-space),
    // whose literal "2002" would otherwise be mis-read as the number.
    const tbl = html.slice(html.indexOf('id="datatable"')).replace(/&#?\w+;/g, ' ');
    const rows = [...tbl.matchAll(/<td[^>]*>\s*([A-Z][a-z]{2})\s+\d{1,2},\s+(\d{4})\s*<\/td>\s*<td[^>]*>[^0-9.-]*(-?[0-9.]+)/g)];
    const seen = new Set();
    const out = [];
    for (const m of rows) {
      const mm = MONTHS[m[1]];
      const date = `${m[2]}-${mm}-01`;
      if (!mm || seen.has(date)) continue; // collapse the daily "current" row into its month
      seen.add(date);
      out.push({ date, value: Number(m[3]) });
    }
    if (!out.length) throw new Error(`multpl parse failed for ${slug}`);
    return out; // newest-first
  });
}

export async function fredSeries(id, units = 'lin') {
  return cached(`fred:${id}:${units}`, async () => {
    const key = process.env.FRED_API_KEY || '';
    const u = units && units !== 'lin' ? `&units=${units}` : ''; // e.g. pc1 = % change from year ago
    const html = await fetchText(`${FRED_BASE}/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc${u}`);
    const data = JSON.parse(html);
    return (data.observations || []).filter((o) => o.value !== '.').map((o) => ({ date: o.date, value: Number(o.value) }));
  });
}

// Two-series helpers (date-aligned), for ratios/spreads built from FRED.
async function fredRatio(idNum, idDen, { scale = 1, pct = false } = {}) {
  const [num, den] = await Promise.all([fredSeries(idNum), fredSeries(idDen)]);
  const denBy = new Map(den.map((o) => [o.date, o.value]));
  return num
    .map((o) => {
      const d = denBy.get(o.date);
      if (!d) return null;
      return { date: o.date, value: Number(((o.value / (d * scale)) * (pct ? 100 : 1)).toFixed(2)) };
    })
    .filter(Boolean); // newest-first
}
async function fredDiff(idA, idB) {
  const [a, b] = await Promise.all([fredSeries(idA), fredSeries(idB)]);
  const bBy = new Map(b.map((o) => [o.date, o.value]));
  return a.map((o) => (bBy.has(o.date) ? { date: o.date, value: Number((o.value - bBy.get(o.date)).toFixed(2)) } : null)).filter(Boolean);
}

// Buffett Indicator: nonfinancial corporate equities ($M) / GDP ($B) → %.
async function buffettSeries() {
  const [eq, gdp] = await Promise.all([fredSeries('NCBEILQ027S'), fredSeries('GDP')]);
  const gdpBy = new Map(gdp.map((o) => [o.date, o.value]));
  return eq
    .map((o) => (gdpBy.has(o.date) ? { date: o.date, value: Number((o.value / (gdpBy.get(o.date) * 1000) * 100).toFixed(2)) } : null))
    .filter(Boolean); // newest-first
}

// ── stats helpers ─────────────────────────────────────────────────────────────
export function percentileOf(valuesAsc, x) {
  let lo = 0; for (const v of valuesAsc) if (v <= x) lo++; else break;
  return Math.round((lo / valuesAsc.length) * 100);
}
export function downsample(arr, n) {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}
const fmtAsOf = (date) => new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

export function summarize(series, { richWhen, changeBack = 1 }) {
  // series newest-first; changeBack = how many observations back to measure the
  // "recent change" (1 = prior obs for monthly; ~21 for a 1-month move on daily).
  const chrono = [...series].reverse();
  const latest = chrono[chrono.length - 1];
  const prev = chrono[Math.max(0, chrono.length - 1 - changeBack)];
  const valuesAsc = chrono.map((p) => p.value).sort((a, b) => a - b);
  const valuePercentile = percentileOf(valuesAsc, latest.value);
  const richPercentile = richWhen === 'high' ? valuePercentile : 100 - valuePercentile;
  return {
    asOf: fmtAsOf(latest.date),
    asOfDate: latest.date,
    value: latest.value,
    mom: prev && prev !== latest ? Number((latest.value - prev.value).toFixed(2)) : 0,
    valuePercentile,
    richPercentile,
    richWhen,
    spark: downsample(chrono.map((p) => p.value), 64),
    history: downsample(chrono, 360),
  };
}

const METRICS = [
  { key: 'cape', label: 'Shiller CAPE', unit: 'x', richWhen: 'high', source: () => multplSeries('shiller-pe'),
    description: 'Cyclically-adjusted P/E (P/E10). Real S&P 500 price divided by 10-year average of real earnings. Shiller methodology.' },
  { key: 'buffett', label: 'Buffett Indicator', unit: '%', richWhen: 'high', source: buffettSeries,
    description: 'US nonfinancial corporate equities at market value divided by nominal GDP (Fed Z.1 / FRED basis).' },
  { key: 'pe', label: 'Trailing P/E', unit: 'x', richWhen: 'high', source: () => multplSeries('s-p-500-pe-ratio'),
    description: 'S&P 500 price / trailing 12M earnings. Monthly Shiller dataset.' },
  { key: 'pb', label: 'Price / Book', unit: 'x', richWhen: 'high', source: () => multplSeries('s-p-500-price-to-book', 'by-year'),
    description: 'S&P 500 price-to-book ratio (annual, multpl). Higher = richer relative to net asset value.' },
  { key: 'ps', label: 'Price / Sales', unit: 'x', richWhen: 'high', source: () => multplSeries('s-p-500-price-to-sales', 'by-year'),
    description: 'S&P 500 price-to-sales ratio (annual, multpl). Higher = richer relative to revenue.' },
  { key: 'divyield', label: 'Dividend Yield', unit: '%', richWhen: 'low', source: () => multplSeries('s-p-500-dividend-yield'),
    description: 'S&P 500 dividend yield (%). Lower yields are richer valuations.' },
  { key: 'earnyield', label: 'Earnings Yield', unit: '%', richWhen: 'low', source: () => multplSeries('s-p-500-earnings-yield'),
    description: 'S&P 500 earnings yield (%, inverse of trailing P/E). Lower = richer.' },
  { key: 'fedmodel', label: 'Fed Model Spread', unit: 'pp', richWhen: 'low', source: 'fedmodel',
    description: 'Earnings yield minus 10-year Treasury yield, in percentage points. Lower (or negative) values suggest equities are richly priced vs bonds.' },
];

let cache = { t: 0, data: null };
export async function getMarketValuation() {
  if (cache.data && Date.now() - cache.t < 6 * 3600_000) return cache.data;

  // Earnings yield is needed both as its own tile and for the Fed model spread.
  let earnYield = null;
  try { earnYield = await multplSeries('s-p-500-earnings-yield'); } catch { /* handled per-tile */ }
  const gs10 = await fredSeries('GS10').catch(() => []);
  const gs10By = new Map(gs10.map((o) => [o.date, o.value]));

  const metrics = await Promise.all(
    METRICS.map(async (m) => {
      try {
        let series;
        if (m.source === 'fedmodel') {
          if (!earnYield || !gs10.length) throw new Error('fed model inputs unavailable');
          series = earnYield.map((o) => (gs10By.has(o.date) ? { date: o.date, value: Number((o.value - gs10By.get(o.date)).toFixed(2)) } : null)).filter(Boolean);
        } else if (m.key === 'earnyield' && earnYield) {
          series = earnYield;
        } else {
          series = await m.source();
        }
        return { key: m.key, label: m.label, unit: m.unit, description: m.description, available: true, ...summarize(series, { richWhen: m.richWhen }) };
      } catch (e) {
        return { key: m.key, label: m.label, unit: m.unit, description: m.description, available: false, reason: redactSecrets(e.message) };
      }
    })
  );

  const data = { tab: 'Market', generatedAt: new Date().toISOString(), metrics };
  if (metrics.some((x) => x.available)) cache = { t: Date.now(), data };
  return data;
}

// ── Yields tab: Treasury maturities (FRED) + equity yields (Shiller) ──────────
const YIELD_METRICS = [
  { key: 'fedfunds', label: 'Fed Funds Rate', fred: 'FEDFUNDS', description: 'Effective federal funds rate (FRED, monthly).' },
  { key: 'y3m', label: '3-Month Treasury', fred: 'GS3M', description: '3-month Treasury constant maturity (FRED, monthly).' },
  { key: 'y2', label: '2-Year Treasury', fred: 'GS2', description: '2-year Treasury constant maturity (FRED, monthly).' },
  { key: 'y5', label: '5-Year Treasury', fred: 'GS5', description: '5-year Treasury constant maturity (FRED, monthly).' },
  { key: 'y10', label: '10-Year Treasury', fred: 'GS10', description: '10-year Treasury constant maturity (FRED, monthly).' },
  { key: 'y30', label: '30-Year Treasury', fred: 'GS30', description: '30-year Treasury constant maturity (FRED, monthly).' },
  { key: 'divyield', label: 'S&P 500 Dividend Yield', multpl: 's-p-500-dividend-yield', description: 'S&P 500 dividend yield (Shiller via multpl, monthly).' },
  { key: 'earnyield', label: 'S&P 500 Earnings Yield', multpl: 's-p-500-earnings-yield', description: 'S&P 500 earnings yield (Shiller via multpl, monthly).' },
];

let yieldsCache = { t: 0, data: null };
export async function getYields() {
  if (yieldsCache.data && Date.now() - yieldsCache.t < 6 * 3600_000) return yieldsCache.data;

  const metrics = await Promise.all(
    YIELD_METRICS.map(async (m) => {
      try {
        const series = m.fred ? await fredSeries(m.fred) : await multplSeries(m.multpl);
        // richWhen 'high' just makes the percentile bar fill by level; the Yields
        // tab renders neutrally (yields aren't "rich/cheap" like valuations).
        return { key: m.key, label: m.label, unit: '%', description: m.description, available: true, ...summarize(series, { richWhen: 'high' }) };
      } catch (e) {
        return { key: m.key, label: m.label, unit: '%', description: m.description, available: false, reason: redactSecrets(e.message) };
      }
    })
  );

  const data = { tab: 'Yields', colorMode: 'neutral', generatedAt: new Date().toISOString(), metrics };
  if (metrics.some((x) => x.available)) yieldsCache = { t: Date.now(), data };
  return data;
}

// ── Macro lenses: Growth / Quality / Leverage (market-level, free FRED data) ──
// These aren't per-company cross-sections (that needs premium fundamentals) — they
// are the macro-financial backdrop for each theme, each shown vs its own history
// and rendered neutrally (level-based percentile, no rich/cheap colouring).
const THEME_METRICS = {
  Growth: [
    { key: 'gdp', label: 'Real GDP Growth', unit: '%', source: () => fredSeries('A191RL1Q225SBEA'),
      description: 'Real GDP, quarterly annualised % change (BEA via FRED).' },
    { key: 'indpro', label: 'Industrial Production (YoY)', unit: '%', source: () => fredSeries('INDPRO', 'pc1'),
      description: 'Industrial production index, % change from a year ago (FRED).' },
    { key: 'pce', label: 'Consumer Spending (YoY)', unit: '%', source: () => fredSeries('PCEC96', 'pc1'),
      description: 'Real personal consumption expenditures, % change from a year ago (FRED).' },
    { key: 'retail', label: 'Retail Sales (YoY)', unit: '%', source: () => fredSeries('RSAFS', 'pc1'),
      description: 'Advance retail & food-services sales, % change from a year ago (FRED).' },
    { key: 'payrolls', label: 'Nonfarm Payrolls (YoY)', unit: '%', source: () => fredSeries('PAYEMS', 'pc1'),
      description: 'Total nonfarm payroll employment, % change from a year ago (FRED).' },
  ],
  Quality: [
    { key: 'profitshare', label: 'Corporate Profit Share', unit: '%', source: () => fredRatio('CP', 'GDP', { pct: true }),
      description: 'After-tax corporate profits as a share of GDP (BEA via FRED). Higher = fatter aggregate margins.' },
    { key: 'qspread', label: 'Baa–Aaa Quality Spread', unit: 'pp', source: () => fredDiff('BAA', 'AAA'),
      description: "Moody's Baa minus Aaa corporate yields (FRED). Wider = a bigger penalty on lower-quality credit." },
    { key: 'lending', label: 'Bank Lending Standards', unit: '%', source: () => fredSeries('DRTSCILM'),
      description: 'Net % of banks tightening C&I lending standards, Fed SLOOS (FRED). Higher = tighter credit.' },
    { key: 'recession', label: 'Recession Probability', unit: '%', source: () => fredSeries('RECPROUSM156N'),
      description: 'Smoothed US recession probability, Chauvet–Piger model (FRED).' },
  ],
  Leverage: [
    { key: 'hyoas', label: 'High-Yield Spread', unit: '%', source: () => fredSeries('BAMLH0A0HYM2'),
      description: 'ICE BofA US High-Yield option-adjusted spread (FRED). Wider = more credit stress.' },
    { key: 'baa', label: 'Baa Corporate Spread', unit: 'pp', source: () => fredSeries('BAA10Y'),
      description: "Moody's Baa corporate yield minus the 10-year Treasury (FRED)." },
    { key: 'dsr', label: 'Household Debt Service', unit: '%', source: () => fredSeries('TDSP'),
      description: 'Household debt-service payments as a share of disposable personal income (FRED).' },
    { key: 'corpdebt', label: 'Nonfin Corp Debt / GDP', unit: '%', source: () => fredRatio('NCBDBIQ027S', 'GDP', { scale: 1000, pct: true }),
      description: 'Nonfinancial corporate debt securities & loans as a share of GDP (Fed Z.1 / FRED).' },
    { key: 'delinq', label: 'Business Loan Delinquency', unit: '%', source: () => fredSeries('DRBLACBS'),
      description: 'Delinquency rate on business loans, all commercial banks (FRED).' },
  ],
};

export const VALUATION_THEMES = Object.keys(THEME_METRICS);

const themeCache = new Map();
export async function getValuationTheme(tabRaw) {
  const tab = String(tabRaw || '');
  const specs = THEME_METRICS[tab];
  if (!specs) return { tab, available: false, colorMode: 'neutral', generatedAt: new Date().toISOString(), metrics: [] };

  const hit = themeCache.get(tab);
  if (hit && Date.now() - hit.t < 6 * 3600_000) return hit.data;

  const metrics = await Promise.all(
    specs.map(async (m) => {
      try {
        const series = await m.source();
        if (!series || series.length < 8) throw new Error('insufficient history');
        return { key: m.key, label: m.label, unit: m.unit, description: m.description, available: true, ...summarize(series, { richWhen: 'high' }) };
      } catch (e) {
        return { key: m.key, label: m.label, unit: m.unit, description: m.description, available: false, reason: redactSecrets(e.message) };
      }
    })
  );

  const data = { tab, colorMode: 'neutral', generatedAt: new Date().toISOString(), metrics };
  if (metrics.some((x) => x.available)) themeCache.set(tab, { t: Date.now(), data });
  return data;
}
