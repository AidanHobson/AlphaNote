// FRED (Federal Reserve Economic Data) integration — timely US macro series.
// Requires a free API key (https://fredaccount.stlouisfed.org/apikeys) in FRED_API_KEY.
// When the key is absent/invalid, callers fall back to the World Bank (see economy.js).

const BASE = 'https://api.stlouisfed.org/fred';

// FRED keys are 32-char lowercase alphanumeric — this also rejects placeholders.
// Trimmed here too (besides env.js) so a pasted trailing newline can never
// disable the integration.
export function isFredConfigured() {
  return /^[a-z0-9]{32}$/.test((process.env.FRED_API_KEY || '').trim());
}

async function fredObs(seriesId, limit) {
  const key = (process.env.FRED_API_KEY || '').trim();
  const url = `${BASE}/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${res.status} for ${seriesId}`);
  const data = await res.json();
  // FRED uses '.' for missing values; keep newest-first.
  return (data.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: Number(o.value) }));
}

function fmtPeriod(date, freq) {
  const d = new Date(date + 'T00:00:00');
  const yy = `'${String(d.getFullYear()).slice(2)}`;
  if (freq === 'Quarterly') return `Q${Math.floor(d.getMonth() / 3) + 1} ${yy}`;
  if (freq === 'Daily') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${yy}`; // Monthly
}

// newest-first index series → newest-first YoY % series
function toYoY(obs) {
  const out = [];
  for (let i = 0; i + 12 < obs.length; i++) {
    out.push({ date: obs[i].date, value: Number(((obs[i].value / obs[i + 12].value - 1) * 100).toFixed(2)) });
  }
  return out;
}

const SERIES = [
  { id: 'CPIAUCSL', label: 'Inflation (CPI YoY)', unit: '%', good: 'low', transform: 'yoy', freq: 'Monthly', fetch: 26 },
  { id: 'CPILFESL', label: 'Core CPI (YoY)', unit: '%', good: 'low', transform: 'yoy', freq: 'Monthly', fetch: 26 },
  { id: 'UNRATE', label: 'Unemployment', unit: '%', good: 'low', transform: 'level', freq: 'Monthly', fetch: 14 },
  { id: 'A191RL1Q225SBEA', label: 'Real GDP growth', unit: '%', good: 'high', transform: 'level', freq: 'Quarterly', fetch: 8 },
  { id: 'FEDFUNDS', label: 'Fed Funds Rate', unit: '%', good: 'neutral', transform: 'level', freq: 'Monthly', fetch: 14 },
  { id: 'DGS10', label: '10Y Treasury', unit: '%', good: 'neutral', transform: 'level', freq: 'Daily', fetch: 30 },
];

let indCache = { t: 0, data: null };
export async function getFredIndicators() {
  if (indCache.data && Date.now() - indCache.t < 3600_000) return indCache.data;

  const indicators = await Promise.all(
    SERIES.map(async (s) => {
      const raw = await fredObs(s.id, s.fetch);
      const series = s.transform === 'yoy' ? toYoY(raw) : raw.map((o) => ({ date: o.date, value: Number(o.value.toFixed(2)) }));
      const chrono = series.slice(0, 8).reverse().map((o) => ({ year: fmtPeriod(o.date, s.freq), value: o.value }));
      const latest = chrono[chrono.length - 1] || null;
      const prev = chrono[chrono.length - 2] || null;
      return { code: s.id, label: s.label, unit: s.unit, good: s.good, country: 'US', freq: s.freq, latest, prev, history: chrono };
    })
  );
  const data = { country: 'US', source: 'FRED', indicators };
  indCache = { t: Date.now(), data };
  return data;
}

// ── Yield curve ──────────────────────────────────────────────────────────────
const CURVE = [
  { id: 'DGS1MO', label: '1M', years: 1 / 12 }, { id: 'DGS3MO', label: '3M', years: 0.25 },
  { id: 'DGS6MO', label: '6M', years: 0.5 }, { id: 'DGS1', label: '1Y', years: 1 },
  { id: 'DGS2', label: '2Y', years: 2 }, { id: 'DGS5', label: '5Y', years: 5 },
  { id: 'DGS7', label: '7Y', years: 7 }, { id: 'DGS10', label: '10Y', years: 10 },
  { id: 'DGS20', label: '20Y', years: 20 }, { id: 'DGS30', label: '30Y', years: 30 },
];

let curveCache = { t: 0, data: null };
export async function getYieldCurve() {
  if (curveCache.data && Date.now() - curveCache.t < 3600_000) return curveCache.data;

  const points = await Promise.all(
    CURVE.map(async (m) => {
      try {
        const obs = await fredObs(m.id, 25); // ~1 trading month
        const now = obs[0];
        const monthAgo = obs.find((_, i) => i >= 21) || obs[obs.length - 1];
        return now ? { label: m.label, years: m.years, value: now.value, prior: monthAgo ? monthAgo.value : null } : null;
      } catch {
        return null;
      }
    })
  );
  const curve = points.filter(Boolean);
  const get = (lbl) => curve.find((p) => p.label === lbl)?.value;
  const spread2s10s = get('10Y') != null && get('2Y') != null ? Number((get('10Y') - get('2Y')).toFixed(2)) : null;
  const asOf = curve.length ? new Date().toISOString().slice(0, 10) : null;
  const data = { asOf, curve, spread2s10s, inverted: spread2s10s != null ? spread2s10s < 0 : null };
  curveCache = { t: Date.now(), data };
  return data;
}
