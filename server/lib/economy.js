// Economy section — macro indicators + an economic-release calendar.
//   • Indicator levels: World Bank API (free, no key) — CPI, GDP growth, unemployment.
//   • Release calendar: Finnhub /calendar/economic (free on this tier), filtered to
//     medium/high impact.
//   • AI "Economic Read": Claude → Gemini, grounded only in the data above.

import { callAIWithFallback } from './ai-provider.js';
import { isFredConfigured, getFredIndicators, getYieldCurve as fredYieldCurve } from './fred.js';

const FINNHUB_BASE = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';
const WB_BASE = 'https://api.worldbank.org/v2';

const WB_INDICATORS = [
  { code: 'FP.CPI.TOTL.ZG', label: 'Inflation (CPI)', unit: '%', good: 'low' },
  { code: 'NY.GDP.MKTP.KD.ZG', label: 'GDP growth', unit: '%', good: 'high' },
  { code: 'SL.UEM.TOTL.ZS', label: 'Unemployment', unit: '%', good: 'low' },
];

// Prefer FRED (timely monthly/daily series) when configured; else World Bank (annual).
export async function getIndicators() {
  if (isFredConfigured()) {
    try {
      return await getFredIndicators();
    } catch (e) {
      console.warn('FRED indicators failed, falling back to World Bank:', e.message);
    }
  }
  return getWorldBankIndicators();
}

// Live US Treasury yield curve (FRED only — no free World Bank equivalent).
export async function getYieldCurve() {
  if (!isFredConfigured()) {
    return { available: false, reason: 'Add a free FRED_API_KEY to .env to enable the live yield curve.', curve: [] };
  }
  try {
    const r = await fredYieldCurve();
    if (!r.curve || r.curve.length === 0) {
      return { available: false, reason: 'Yield curve data unavailable — check that FRED_API_KEY is valid.', curve: [] };
    }
    return { available: true, ...r };
  } catch (e) {
    return { available: false, reason: 'Could not load the yield curve right now.', curve: [] };
  }
}

let indCache = { t: 0, data: null };
async function getWorldBankIndicators(country = 'USA') {
  if (indCache.data && Date.now() - indCache.t < 6 * 3600_000) return indCache.data;

  const indicators = await Promise.all(
    WB_INDICATORS.map(async (ind) => {
      try {
        const res = await fetch(`${WB_BASE}/country/${country}/indicator/${ind.code}?format=json&mrv=8`);
        const json = await res.json();
        const rows = (Array.isArray(json) ? json[1] : []) || [];
        const series = rows.filter((r) => r.value != null).map((r) => ({ year: r.date, value: Number(r.value.toFixed(2)) })).reverse();
        const latest = series[series.length - 1] || null;
        const prev = series[series.length - 2] || null;
        return { ...ind, country, latest, prev, history: series };
      } catch {
        return { ...ind, country, latest: null, prev: null, history: [] };
      }
    })
  );
  const data = { country, source: 'World Bank', indicators };
  indCache = { t: Date.now(), data };
  return data;
}

function ymd(d) { return d.toISOString().slice(0, 10); }
let calCache = { t: 0, days: 0, data: null };

export async function getEconomicCalendar({ days = 14 } = {}) {
  const token = process.env.FINNHUB_API_KEY || '';
  if (!token) throw new Error('FINNHUB API key is not configured');

  const now = Date.now();
  let rows;
  if (calCache.data && calCache.days === days && now - calCache.t < 1800_000) {
    rows = calCache.data;
  } else {
    const from = ymd(new Date());
    const to = ymd(new Date(Date.now() + days * 86400000));
    const res = await fetch(`${FINNHUB_BASE}/calendar/economic?from=${from}&to=${to}&token=${token}`);
    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const data = await res.json();
    rows = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
    calCache = { t: now, days, data: rows };
  }

  const items = rows
    .filter((r) => r.impact === 'high' || r.impact === 'medium')
    .map((r) => ({
      date: (r.time || '').slice(0, 10),
      time: (r.time || '').slice(11, 16),
      country: r.country || '',
      event: r.event || '',
      impact: r.impact || 'low',
      actual: r.actual ?? null,
      estimate: r.estimate ?? null,
      prev: r.prev ?? null,
      unit: r.unit || '',
    }))
    .filter((r) => r.date && r.event)
    .sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date)))
    .slice(0, 90);

  return { days, count: items.length, highCount: items.filter((i) => i.impact === 'high').length, items };
}

const SYSTEM_PROMPT = `You are the macro economist for AlphaNote. Write a short "Economic Read" using ONLY the data provided: recent annual macro indicators (inflation, GDP growth, unemployment) for the US and a list of upcoming high-impact economic releases.

Rules:
- Lead with one sentence on the state of the economy from the indicator trends (respect the data frequency/vintage shown).
- Then 2-3 bullets: what the indicator trajectory implies, and which upcoming releases matter most and why.
- End with a line starting "Watch:" naming the single most important upcoming release.
- Plain English. No invented numbers, no advice, no markdown headings.`;

export async function generateEconomicBrief() {
  const [ind, cal] = await Promise.all([getIndicators(), getEconomicCalendar({ days: 10 }).catch(() => ({ items: [] }))]);
  const lines = [`US macro indicators (source: ${ind.source}${ind.source === 'World Bank' ? ', annual' : ', latest reading'}):`];
  ind.indicators.forEach((i) => {
    if (i.latest) lines.push(`- ${i.label}: ${i.latest.value}${i.unit} (${i.latest.year}); prior ${i.prev ? i.prev.value + i.unit + ' (' + i.prev.year + ')' : 'n/a'}`);
  });
  const highs = cal.items.filter((i) => i.impact === 'high').slice(0, 8);
  lines.push('', 'Upcoming high-impact releases:');
  if (highs.length) highs.forEach((h) => lines.push(`- ${h.date} ${h.country} ${h.event} (est ${h.estimate ?? 'n/a'}, prev ${h.prev ?? 'n/a'})`));
  else lines.push('- none in the near window');
  lines.push('', 'Write the Economic Read now.');

  const { provider, text, fellBack } = await callAIWithFallback(lines.join('\n'), SYSTEM_PROMPT);
  return { generatedAt: new Date().toISOString(), provider, fellBack, text };
}
