import { describe, it, expect } from 'vitest';
import { formatMarketCapValue, validateArticle, getDateRange, formatArticle } from '../server/lib/utils.js';

describe('formatMarketCapValue', () => {
  it('formats trillions/billions/millions', () => {
    expect(formatMarketCapValue(3.1e12)).toBe('$3.10T');
    expect(formatMarketCapValue(9e11)).toBe('$900.00B');
    expect(formatMarketCapValue(25e6)).toBe('$25.00M');
  });
  it('handles invalid input', () => {
    expect(formatMarketCapValue(0)).toBe('N/A');
    expect(formatMarketCapValue(-5)).toBe('N/A');
    expect(formatMarketCapValue(NaN)).toBe('N/A');
  });
});

describe('validateArticle', () => {
  const ok = { headline: 'h', summary: 's', url: 'u', datetime: 1 };
  it('accepts complete articles', () => expect(validateArticle(ok)).toBe(true));
  it('rejects missing fields', () => {
    expect(validateArticle({ ...ok, url: '' })).toBeFalsy();
    expect(validateArticle({ ...ok, datetime: 0 })).toBeFalsy();
    expect(validateArticle(null)).toBeFalsy();
  });
});

describe('getDateRange', () => {
  it('returns YYYY-MM-DD from/to spanning N days', () => {
    const { from, to } = getDateRange(5);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(to) - new Date(from)).toBe(5 * 86400000);
  });
});

describe('formatArticle', () => {
  it('truncates summary and tags company news with the symbol', () => {
    const a = { id: 1, headline: '  Big news  ', summary: 'x'.repeat(300), url: 'u', datetime: 99, source: 'Reuters' };
    const out = formatArticle(a, true, 'AAPL', 0);
    expect(out.headline).toBe('Big news');
    expect(out.summary.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(out.related).toBe('AAPL');
    expect(out.category).toBe('company');
  });
});
