import { describe, it, expect } from 'vitest';
import { stressLabel, realizedVolSeries } from '../server/lib/risk.js';
import { summarize } from '../server/lib/valuation.js';

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
