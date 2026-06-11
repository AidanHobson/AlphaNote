import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildPrompt } from '../server/lib/insight.js';

const quote = { c: 100, d: 2, dp: 2.04, l: 97, h: 101, o: 98, pc: 98 };
const profile = { name: 'Acme Corp', finnhubIndustry: 'Software', exchange: 'NASDAQ', country: 'US', currency: 'USD', marketCapitalization: 5000 };
const fundamentals = {
  available: true,
  source: 'SEC EDGAR (XBRL)',
  asOfFY: 2025,
  currentThrough: '2026-03-28',
  lineItems: [
    { key: 'revenue', current: { value: 12_000_000_000, basis: 'ttm' } },
    { key: 'netIncome', current: { value: 2_000_000_000, basis: 'ttm' } },
    { key: 'operatingCashFlow', current: { value: 1_000_000_000, basis: 'ttm' } },
    { key: 'eps', current: { value: 3.21, basis: 'ttm' } },
  ],
  ratios: [
    { label: 'Gross margin', value: 61.5, unit: '%' },
    { label: 'Debt / equity', value: 0.42, unit: 'x' },
  ],
};

describe('insight SYSTEM_PROMPT (analyst persona)', () => {
  it('speaks as the AlphaNote equity research analyst, not a beginner explainer', () => {
    expect(SYSTEM_PROMPT).toContain('senior equity research analyst');
    expect(SYSTEM_PROMPT).toContain('AlphaNote');
    expect(SYSTEM_PROMPT).not.toContain('OpenStock');
  });
  it('keeps the safety rails: no invented data, no recommendations', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent data/);
    expect(SYSTEM_PROMPT).toMatch(/Do NOT give buy\/sell\/hold recommendations/);
  });
});

describe('buildPrompt', () => {
  it('includes TTM fundamentals with basis labels and cash-conversion ratio', () => {
    const p = buildPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals });
    expect(p).toContain('Revenue: $12.00B (ttm)');
    expect(p).toContain('Operating cash flow: $1.00B (ttm)');
    expect(p).toContain('OCF / net income: 0.50x');
    expect(p).toContain('Diluted EPS: 3.21 (ttm)');
    expect(p).toContain('Gross margin: 61.5%');
    expect(p).toContain('Debt / equity: 0.42x');
    expect(p).toContain('through 2026-03-28');
  });
  it('formats negative flows with a sign instead of N/A (loss-making companies)', () => {
    const lossCo = {
      ...fundamentals,
      lineItems: [
        { key: 'revenue', current: { value: 500_000_000, basis: 'ttm' } },
        { key: 'netIncome', current: { value: -120_000_000, basis: 'ttm' } },
      ],
      ratios: [],
    };
    const p = buildPrompt({ symbol: 'BURN', quote, profile, news: [], ratings: null, fundamentals: lossCo });
    expect(p).toContain('Net income: -$120.00M (ttm)');
    expect(p).not.toContain('N/A');
  });
  it('says fundamentals are unavailable rather than omitting them silently', () => {
    const p = buildPrompt({ symbol: 'ETF1', quote, profile, news: [], ratings: null, fundamentals: null });
    expect(p).toContain('Fundamentals: not available');
  });
  it('still carries quote, news, and ratings context', () => {
    const news = [{ headline: 'Acme wins contract', source: 'Newswire' }];
    const ratings = { hasCoverage: true, consensus: { total: 10, label: 'Buy' }, latest: { strongBuy: 4, buy: 4, hold: 2, sell: 0, strongSell: 0 } };
    const p = buildPrompt({ symbol: 'ACME', quote, profile, news, ratings, fundamentals });
    expect(p).toContain('Current price: 100 USD');
    expect(p).toContain('Acme wins contract (Newswire)');
    expect(p).toContain('Analyst ratings consensus (10 analysts): Buy');
  });
});
