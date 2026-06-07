import { describe, it, expect } from 'vitest';
import { percentileOf, downsample } from '../server/lib/valuation.js';

describe('percentileOf', () => {
  const asc = [1, 2, 3, 4, 5];
  it('ranks a value within its sorted history', () => {
    expect(percentileOf(asc, 3)).toBe(60);
    expect(percentileOf(asc, 5)).toBe(100); // at/above max → richest
    expect(percentileOf(asc, 1)).toBe(20);
  });
  it('returns 0 when the value is below the whole series', () => {
    expect(percentileOf([10, 20, 30], 5)).toBe(0);
  });
});

describe('downsample', () => {
  it('returns the array unchanged when small enough', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  it('samples down to n points keeping the endpoints', () => {
    const out = downsample(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
  });
});
