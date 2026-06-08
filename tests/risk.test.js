import { describe, it, expect } from 'vitest';
import { stressLabel, realizedVolSeries, drawdownSeries, smaDistanceSeries, asOfValue, compositeMonthly, monthGrid } from '../server/lib/risk.js';
import { summarize } from '../server/lib/valuation.js';

// build a newest-first series (as fredSeries returns) with valid padded dates
const nf = (values) => values.map((value, i) => ({ date: `2020-03-${String(i + 1).padStart(2, '0')}`, value })).reverse();

describe('stressLabel', () => {
  it('buckets a 0–100 composite stress score', () => {
    expect(stressLabel(5)).toBe('Calm');
    expect(stressLabel(25)).toBe('Low');
    expect(stressLabel(50)).toBe('Normal');
    expect(stressLabel(70)).toBe('Elevated');
    expect(stressLabel(90)).toBe('Stressed');
  });
  it('is monotonic at the boundaries', () => {
    expect(stressLabel(20)).toBe('Low');
    expect(stressLabel(40)).toBe('Normal');
    expect(stressLabel(60)).toBe('Elevated');
    expect(stressLabel(80)).toBe('Stressed');
  });
});

describe('realizedVolSeries', () => {
  // helper: build a newest-first series (as fredSeries returns) with valid,
  // zero-padded, string-sortable dates.
  const newestFirst = (values) =>
    values.map((value, i) => ({ date: `2020-03-${String(i + 1).padStart(2, '0')}`, value })).reverse();

  it('is ~0 for a flat price series', () => {
    const vol = realizedVolSeries(newestFirst(Array(28).fill(100)), { window: 21 });
    expect(vol.length).toBeGreaterThan(0);
    expect(vol[0].value).toBe(0);
  });
  it('is positive for a series that moves, and returns newest-first', () => {
    const vol = realizedVolSeries(newestFirst(Array.from({ length: 28 }, (_, i) => 100 + (i % 2 ? 2 : 0))), { window: 21 });
    expect(vol[0].value).toBeGreaterThan(0);
    expect(vol[0].date > vol[vol.length - 1].date).toBe(true); // newest-first
  });
});

describe('drawdownSeries', () => {
  it('is 0 at new highs and negative below the trailing peak (newest-first)', () => {
    const dd = drawdownSeries(nf([100, 110, 120, 90]), 252);
    expect(dd[0].value).toBeCloseTo(-25, 5); // latest 90 vs peak 120 → -25%
    expect(dd[dd.length - 1].value).toBe(0);  // first point is its own peak
  });
});

describe('smaDistanceSeries', () => {
  it('measures percent above/below the moving average (newest-first)', () => {
    const d = smaDistanceSeries(nf([100, 100, 100, 130]), 3);
    expect(d[0].value).toBeCloseTo(18.18, 1); // 130 vs sma(100,100,130)=110
  });
});

describe('asOfValue', () => {
  const chrono = [{ date: '2020-01-31', value: 10 }, { date: '2020-02-29', value: 20 }, { date: '2020-03-31', value: 30 }];
  it('returns the latest observation on or before the cutoff', () => {
    expect(asOfValue(chrono, '2020-02-15')).toBe(10);
    expect(asOfValue(chrono, '2020-02-29')).toBe(20);
    expect(asOfValue(chrono, '2020-12-31')).toBe(30);
  });
  it('returns null before the series starts', () => {
    expect(asOfValue(chrono, '2019-12-31')).toBeNull();
  });
});

describe('monthGrid', () => {
  it('returns N month-end dates, oldest first', () => {
    const g = monthGrid(12, new Date(Date.UTC(2024, 5, 15)));
    expect(g).toHaveLength(12);
    expect(g[11]).toBe('2024-06-30'); // current month-end
    expect(g[0] < g[11]).toBe(true);
  });
});

describe('compositeMonthly', () => {
  it('averages gauge risk-percentiles into 0–100, null before data', () => {
    const series = nf(Array.from({ length: 14 }, (_, i) => i + 1)); // values 1..14, dates 2020-03-01..14
    const grid = ['2020-03-07', '2020-03-14', '2020-04-30', '2019-01-01'];
    const out = compositeMonthly([{ series, riskWhen: 'high' }], grid);
    expect(out[3]).toBeNull();                    // before the series
    expect(out[1]).toBeGreaterThan(out[0]);       // later/higher value → more risk (riskWhen high)
    out.filter((v) => v != null).forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
  });
});

describe('summarize riskWhen direction', () => {
  // newest-first series; current value sits at the LOW end of its history.
  const series = [{ date: '2020-05-01', value: 1 }, { date: '2020-04-01', value: 5 }, { date: '2020-03-01', value: 9 }];
  it("flags low current values as high-risk when riskWhen='low'", () => {
    const s = summarize(series, { richWhen: 'low' });
    expect(s.value).toBe(1);
    expect(s.valuePercentile).toBeLessThan(40); // value is low in its history
    expect(s.richPercentile).toBeGreaterThan(60); // ...which is HIGH risk
  });
  it("uses changeBack to measure the recent move", () => {
    const s = summarize(series, { richWhen: 'low', changeBack: 2 });
    expect(s.mom).toBe(-8); // latest(1) - 2-back(9)
  });
});
