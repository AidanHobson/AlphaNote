import { describe, it, expect } from 'vitest';
import { toEodhdSymbol, summarizeHistory } from '../server/lib/eodhd.js';

describe('toEodhdSymbol', () => {
  it('appends .US to plain tickers and uppercases', () => {
    expect(toEodhdSymbol('aapl')).toBe('AAPL.US');
    expect(toEodhdSymbol('NVDA')).toBe('NVDA.US');
  });
  it('converts share-class dots to dashes (EODHD convention)', () => {
    expect(toEodhdSymbol('BRK.B')).toBe('BRK-B.US');
  });
  it('preserves an explicit .US suffix without doubling it', () => {
    expect(toEodhdSymbol('AAPL.US')).toBe('AAPL.US');
  });
  it('strips injection characters and rejects empty input', () => {
    expect(toEodhdSymbol('<script>')).toBe('SCRIPT.US');
    expect(toEodhdSymbol('')).toBeNull();
    expect(toEodhdSymbol('!!!')).toBeNull();
  });
});

describe('summarizeHistory', () => {
  const rows = [
    { date: '2025-01-02', close: 100, adjusted_close: 99, volume: 10 },
    { date: '2025-06-02', close: 120, adjusted_close: 118, volume: 12 },
    { date: '2025-12-02', close: 130, adjusted_close: 130, volume: 14, warning: 'free tier' },
  ];
  it('prefers adjusted close, computes period stats', () => {
    const s = summarizeHistory(rows);
    expect(s.points).toHaveLength(3);
    expect(s.points[0].close).toBe(99); // adjusted, not raw
    expect(s.stats.lastClose).toBe(130);
    expect(s.stats.changePercent).toBeCloseTo(((130 - 99) / 99) * 100, 1);
    expect(s.stats.high).toBe(130);
    expect(s.stats.low).toBe(99);
    expect(JSON.stringify(s)).not.toContain('warning'); // upstream noise stripped
  });
  it('drops malformed rows and returns null when nothing usable', () => {
    expect(summarizeHistory([{ date: '2025-01-02' }, null])).toBeNull();
    const s = summarizeHistory([...rows, { date: '2025-12-03' }]);
    expect(s.points).toHaveLength(3);
  });
});
