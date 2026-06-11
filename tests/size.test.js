import { describe, it, expect } from 'vitest';
import { periodReturn, ratioSeries } from '../server/lib/size.js';

const pts = (closes) => closes.map((close, i) => ({ date: `2025-06-${String(i + 1).padStart(2, '0')}`, close }));

describe('periodReturn', () => {
  it('computes % return over the trailing window', () => {
    const p = pts([100, 105, 110, 120]);
    expect(periodReturn(p, Infinity)).toBe(20);   // 100 → 120
    expect(periodReturn(p, 2)).toBeCloseTo(9.09, 1); // 110 → 120
  });
  it('returns null on insufficient data', () => {
    expect(periodReturn(pts([100]), 5)).toBeNull();
    expect(periodReturn(null, 5)).toBeNull();
  });
});

describe('ratioSeries', () => {
  it('aligns by date, indexes to 100, and tracks relative performance', () => {
    const small = pts([10, 11, 12]);
    const large = pts([100, 100, 100]);
    const r = ratioSeries(small, large);
    expect(r[0].value).toBe(100);
    expect(r[2].value).toBeCloseTo(120, 5); // small +20% vs flat large
  });
  it('skips dates missing from either side', () => {
    const small = [{ date: '2025-06-01', close: 10 }, { date: '2025-06-02', close: 11 }];
    const large = [{ date: '2025-06-01', close: 100 }]; // no 06-02
    expect(ratioSeries(small, large)).toHaveLength(1);
  });
  it('handles empty input', () => {
    expect(ratioSeries([], [])).toEqual([]);
  });
});
