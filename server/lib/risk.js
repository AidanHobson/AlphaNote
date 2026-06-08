// Risk Monitor — interest-rate, liquidity/credit, and FX risk gauges built from
// free FRED series, each scored as a percentile vs its own history in the RISK
// direction (so a high score always means "more stress"). Reuses the valuation
// engine's fredSeries + summarize. A composite stress score per category and an
// overall read drive the dashboard; an AI "Risk Read" narrates the picture.

import { fredSeries, multplSeries, summarize } from './valuation.js';
import { callAIWithFallback } from './ai-provider.js';

// Annualised rolling realised volatility (%), newest-first, from a price level
// series (used to turn the broad dollar index into an "FX volatility" gauge).
export function realizedVolSeries(series, { window = 21, ppy = 252 } = {}) {
  const chrono = [...series].reverse(); // oldest-first
  const rets = [];
  for (let i = 1; i < chrono.length; i++) {
    const p0 = chrono[i - 1].value, p1 = chrono[i].value;
    if (p0 > 0 && p1 > 0) rets.push({ date: chrono[i].date, r: Math.log(p1 / p0) });
  }
  const out = [];
  for (let i = window; i <= rets.length; i++) {
    const win = rets.slice(i - window, i);
    const mean = win.reduce((s, x) => s + x.r, 0) / win.length;
    const variance = win.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (win.length - 1);
    out.push({ date: rets[i - 1].date, value: Number((Math.sqrt(variance * ppy) * 100).toFixed(2)) });
  }
  return out.reverse(); // newest-first
}

// Drawdown (%, negative) from the trailing-`window` high, newest-first.
export function drawdownSeries(series, window = 252) {
  const chrono = [...series].reverse();
  const out = [];
  for (let i = 0; i < chrono.length; i++) {
    let peak = -Infinity;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) if (chrono[j].value > peak) peak = chrono[j].value;
    const dd = peak > 0 ? ((chrono[i].value - peak) / peak) * 100 : 0;
    out.push({ date: chrono[i].date, value: Number(dd.toFixed(2)) });
  }
  return out.reverse();
}

// Percent above/below the `window`-period moving average, newest-first.
export function smaDistanceSeries(series, window = 200) {
  const chrono = [...series].reverse();
  const out = [];
  let sum = 0;
  for (let i = 0; i < chrono.length; i++) {
    sum += chrono[i].value;
    if (i >= window) sum -= chrono[i - window].value;
    if (i >= window - 1) {
      const sma = sum / window;
      if (sma > 0) out.push({ date: chrono[i].date, value: Number(((chrono[i].value / sma - 1) * 100).toFixed(2)) });
    }
  }
  return out.reverse();
}

// Equity risk premium: S&P 500 earnings yield (multpl) − 10Y Treasury (FRED),
// date-aligned by month, newest-first.
async function equityRiskPremiumSeries() {
  const [ey, gs10] = await Promise.all([multplSeries('s-p-500-earnings-yield'), fredSeries('GS10')]);
  const gsBy = new Map(gs10.map((o) => [o.date, o.value]));
  return ey.map((o) => (gsBy.has(o.date) ? { date: o.date, value: Number((o.value - gsBy.get(o.date)).toFixed(2)) } : null)).filter(Boolean);
}

// changeBack: observations back to measure the "recent change" (≈1 month):
// daily ≈ 21, weekly ≈ 4, monthly/quarterly = 1.
const RISK_GROUPS = [
  { key: 'rates', name: 'Interest-Rate Risk', blurb: 'Curve shape, rate levels, real yields and inflation expectations.', metrics: [
    { key: 't10y2y', label: '2s10s Curve Spread', unit: 'pp', riskWhen: 'low', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('T10Y2Y'),
      description: '10-year minus 2-year Treasury yield (FRED). Negative = an inverted curve, a classic recession signal — so low/negative reads = higher risk.' },
    { key: 't10y3m', label: '3M–10Y Spread', unit: 'pp', riskWhen: 'low', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('T10Y3M'),
      description: "10-year minus 3-month Treasury yield (FRED). The Fed's preferred recession-risk curve measure." },
    { key: 'dgs10', label: '10Y Treasury Yield', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DGS10'),
      description: '10-year Treasury constant maturity (FRED). Rising long rates pressure duration and risk assets.' },
    { key: 'dfii10', label: '10Y Real Yield', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DFII10'),
      description: '10-year TIPS real yield (FRED). Higher real rates tighten financial conditions.' },
    { key: 't10yie', label: '10Y Breakeven Inflation', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('T10YIE'),
      description: '10-year breakeven inflation rate (FRED). Elevated breakevens signal inflation risk.' },
  ] },
  { key: 'liquidity', name: 'Liquidity & Credit Risk', blurb: 'Credit spreads, financial conditions, system stress and equity vol.', metrics: [
    { key: 'hyoas', label: 'High-Yield Spread', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('BAMLH0A0HYM2'),
      description: 'ICE BofA US High-Yield option-adjusted spread (FRED). Wider = funding stress and risk-off.' },
    { key: 'igoas', label: 'Investment-Grade Spread', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('BAMLC0A0CM'),
      description: 'ICE BofA US Corporate (IG) option-adjusted spread (FRED). The high-grade credit risk premium.' },
    { key: 'nfci', label: 'Financial Conditions', unit: 'idx', riskWhen: 'high', changeBack: 4, changeLabel: '1mo', source: () => fredSeries('NFCI'),
      description: 'Chicago Fed National Financial Conditions Index (FRED). Positive = tighter than average; negative = loose.' },
    { key: 'stlfsi', label: 'Financial Stress Index', unit: 'idx', riskWhen: 'high', changeBack: 4, changeLabel: '1mo', source: () => fredSeries('STLFSI4'),
      description: 'St. Louis Fed Financial Stress Index (FRED). Positive = above-average stress in the financial system.' },
    { key: 'vix', label: 'VIX (Equity Vol)', unit: 'idx', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('VIXCLS'),
      description: "CBOE Volatility Index (FRED). The market's 30-day implied volatility / fear gauge." },
  ] },
  { key: 'equity', name: 'Equity / Market Risk', blurb: 'Drawdown, realised volatility, trend and the valuation cushion in US equities.', metrics: [
    { key: 'spdd', label: 'S&P 500 Drawdown', unit: '%', riskWhen: 'low', changeBack: 21, changeLabel: '1mo', source: async () => drawdownSeries(await fredSeries('SP500')),
      description: 'S&P 500 percent below its trailing 1-year high (computed from FRED SP500). A deeper drawdown = higher realised risk.' },
    { key: 'spvol', label: 'S&P 500 Realized Vol', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: async () => realizedVolSeries(await fredSeries('SP500')),
      description: 'Annualised 1-month realised volatility of the S&P 500 (computed from FRED SP500).' },
    { key: 'sptrend', label: 'S&P 500 vs 200-Day Avg', unit: '%', riskWhen: 'low', changeBack: 21, changeLabel: '1mo', source: async () => smaDistanceSeries(await fredSeries('SP500')),
      description: 'S&P 500 percent above/below its 200-day moving average (computed). Trading below trend = elevated risk.' },
    { key: 'erp', label: 'Equity Risk Premium', unit: 'pp', riskWhen: 'low', changeBack: 1, changeLabel: 'MoM', source: equityRiskPremiumSeries,
      description: 'S&P 500 earnings yield minus the 10-year Treasury (Shiller via multpl + FRED). A compressed premium = richer, riskier equities.' },
  ] },
  { key: 'fx', name: 'Foreign-Exchange Risk', blurb: 'Dollar strength, currency volatility, and carry / EM-currency stress.', metrics: [
    { key: 'broaddxy', label: 'Broad US Dollar Index', unit: 'idx', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DTWEXBGS'),
      description: 'Trade-weighted broad US dollar index (FRED). A strong dollar tightens global financial conditions.' },
    { key: 'usdvol', label: 'USD Realized Volatility', unit: '%', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: async () => realizedVolSeries(await fredSeries('DTWEXBGS')),
      description: 'Annualised 1-month realised volatility of the broad dollar index. Elevated FX vol = higher currency risk.' },
    { key: 'advdxy', label: 'Major-Currencies Dollar', unit: 'idx', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DTWEXAFEGS'),
      description: 'US dollar vs a basket of advanced-economy currencies (FRED).' },
    { key: 'usdjpy', label: 'USD / JPY', unit: '', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DEXJPUS'),
      description: 'Japanese yen per US dollar (FRED). A weaker yen reflects carry-trade extension; sharp reversals transmit globally.' },
    { key: 'usdcny', label: 'USD / CNY', unit: '', riskWhen: 'high', changeBack: 21, changeLabel: '1mo', source: () => fredSeries('DEXCHUS'),
      description: 'Chinese yuan per US dollar (FRED). Yuan weakness is a barometer of China / EM currency stress.' },
  ] },
];

export function stressLabel(score) {
  if (score >= 80) return 'Stressed';
  if (score >= 60) return 'Elevated';
  if (score >= 40) return 'Normal';
  if (score >= 20) return 'Low';
  return 'Calm';
}

let cache = { t: 0, data: null };
export async function getRiskBoard() {
  if (cache.data && Date.now() - cache.t < 30 * 60_000) return cache.data;

  const groups = await Promise.all(
    RISK_GROUPS.map(async (g) => {
      const metrics = await Promise.all(
        g.metrics.map(async (m) => {
          try {
            const series = await m.source();
            if (!series || series.length < 12) throw new Error('insufficient history');
            return {
              key: m.key, label: m.label, unit: m.unit, description: m.description,
              riskWhen: m.riskWhen, changeLabel: m.changeLabel, available: true,
              ...summarize(series, { richWhen: m.riskWhen, changeBack: m.changeBack }),
            };
          } catch (e) {
            return { key: m.key, label: m.label, unit: m.unit, description: m.description, available: false, reason: e.message };
          }
        })
      );
      const live = metrics.filter((x) => x.available);
      const stress = live.length ? Math.round(live.reduce((s, x) => s + x.richPercentile, 0) / live.length) : 0;
      return { key: g.key, name: g.name, blurb: g.blurb, stress, label: stressLabel(stress), metrics };
    })
  );

  const liveGroups = groups.filter((g) => g.metrics.some((m) => m.available));
  const overall = liveGroups.length ? Math.round(liveGroups.reduce((s, g) => s + g.stress, 0) / liveGroups.length) : 0;
  const data = { generatedAt: new Date().toISOString(), overall, label: stressLabel(overall), groups };
  if (liveGroups.length) cache = { t: Date.now(), data };
  return data;
}

const SYSTEM_PROMPT = `You are the risk officer for AlphaNote, a markets research dashboard. Write a short "Risk Read" using ONLY the data provided: three risk categories (interest-rate, liquidity/credit, foreign-exchange), each with a 0–100 stress score (higher = more stressed) and a set of gauges showing the current value and its percentile vs its own history.

Rules:
- Lead with one sentence naming the overall risk posture and which category is the main concern.
- Then 3 bullets (start each with "- "), one per category, citing the specific gauges that stand out (by name and percentile).
- End with a line starting "Watch:" naming the single indicator most worth monitoring next.
- Plain English, no jargon dumps, no markdown headings/code fences. Never invent numbers. This is not investment advice.`;

function buildPrompt(board) {
  const lines = [`Overall risk: ${board.label} (composite stress ${board.overall}/100).`, ''];
  for (const g of board.groups) {
    lines.push(`${g.name} — stress ${g.stress}/100 (${g.label}):`);
    g.metrics.filter((m) => m.available).forEach((m) =>
      lines.push(`- ${m.label}: ${m.value}${m.unit === '%' ? '%' : m.unit === 'pp' ? 'pp' : ''} (${m.richPercentile}th pct of risk vs history)`));
    lines.push('');
  }
  lines.push('Write the Risk Read now.');
  return lines.join('\n');
}

export async function generateRiskBrief() {
  const board = await getRiskBoard();
  const { provider, text, fellBack } = await callAIWithFallback(buildPrompt(board), SYSTEM_PROMPT);
  return { generatedAt: new Date().toISOString(), overall: board.overall, label: board.label, provider, fellBack, text };
}
