import { describe, it, expect } from 'vitest';
import { nextDelayMs } from '../server/lib/warmer.js';

describe('nextDelayMs (warmer pacing)', () => {
  it('paces by quote cost at the target rate', () => {
    // 48 quotes at 0.8 q/s = 60s
    expect(nextDelayMs(48, { qps: 0.8, minGapMs: 1000 })).toBe(60_000);
    // 36 quotes at 0.8 q/s = 45s
    expect(nextDelayMs(36, { qps: 0.8, minGapMs: 1000 })).toBe(45_000);
  });
  it('never goes below the minimum gap (avoids tiny-board bursts)', () => {
    expect(nextDelayMs(8, { qps: 0.8, minGapMs: 15_000 })).toBe(15_000);
  });
  it('keeps the long-run rate under the 60/min Finnhub cap', () => {
    // one full rotation: movers(50) + commodities(14) + movers(50) + macro(36)
    const costs = [50, 14, 50, 36];
    const totalQuotes = costs.reduce((a, b) => a + b, 0);
    const totalMs = costs.reduce((a, c) => a + nextDelayMs(c, { qps: 0.8, minGapMs: 15_000 }), 0);
    const perMin = totalQuotes / (totalMs / 60_000);
    expect(perMin).toBeLessThan(60);
  });
});
