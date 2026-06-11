import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildResearchPrompt } from '../server/lib/research.js';

const quote = { c: 100, d: 2, dp: 2.04, l: 97, h: 101, o: 98, pc: 98 };
const profile = { name: 'Acme Corp', finnhubIndustry: 'Software', exchange: 'NASDAQ', country: 'US', currency: 'USD', marketCapitalization: 5000 };
const fundamentals = {
  available: true,
  source: 'SEC EDGAR (XBRL)',
  asOfFY: 2025,
  currentThrough: '2026-03-28',
  lineItems: [
    { key: 'revenue', label: 'Revenue', current: { value: 12_000_000_000, basis: 'ttm' }, history: [{ fy: 2023, val: 8e9 }, { fy: 2024, val: 10e9 }, { fy: 2025, val: 11.5e9 }] },
    { key: 'netIncome', label: 'Net Income', current: { value: 2_000_000_000, basis: 'ttm' }, history: [{ fy: 2024, val: 1.5e9 }, { fy: 2025, val: 1.9e9 }] },
    { key: 'operatingCashFlow', label: 'Operating Cash Flow', current: { value: 2_200_000_000, basis: 'ttm' }, history: [] },
    { key: 'eps', label: 'Diluted EPS', current: { value: 3.21, basis: 'ttm' }, history: [{ fy: 2024, val: 2.4 }, { fy: 2025, val: 3.05 }] },
  ],
  ratios: [{ label: 'Gross margin', value: 61.5, unit: '%' }],
};
const history = {
  available: true,
  source: 'EODHD (end-of-day, adjusted close)',
  stats: { first: '2025-06-11', last: '2026-06-10', lastClose: 99.5, changePercent: 24.3, high: 105, low: 71 },
};
const insiders = [
  { symbol: 'ACME', insider: 'Jane Roe', title: 'CFO', side: 'Buy', shares: 1000, price: 95, value: 95_000, transactionDate: '2026-06-01' },
];

describe('research SYSTEM_PROMPT', () => {
  it('demands the full note structure with scenarios and a conviction score', () => {
    for (const section of ['**Snapshot**', '**What matters**', '**Fundamentals & earnings quality**', '**Valuation context**', '**Sentiment & positioning**', '**Scenarios**', '**Risks & catalysts**']) {
      expect(SYSTEM_PROMPT).toContain(section);
    }
    expect(SYSTEM_PROMPT).toContain('conviction score');
  });
  it('keeps the rails: no invented data, derived labels, not advice', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent data/);
    expect(SYSTEM_PROMPT).toContain('label it "derived"');
    expect(SYSTEM_PROMPT).toMatch(/NOT advice/);
  });
});

describe('buildResearchPrompt', () => {
  const full = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals, history, insiders });

  it('includes the fiscal-year trajectory for trend reasoning', () => {
    expect(full).toContain('Revenue by fiscal year: FY2023 $8.00B, FY2024 $10.00B, FY2025 $11.50B');
    expect(full).toContain('Diluted EPS by fiscal year: FY2024 2.4, FY2025 3.05');
  });
  it('includes TTM figures, cash conversion, and price history', () => {
    expect(full).toContain('Revenue: $12.00B (ttm)');
    expect(full).toContain('OCF / net income: 1.10x');
    expect(full).toContain('1-year change: 24.3%');
    expect(full).toContain('52-week range: 71 – 105');
  });
  it('includes per-symbol insider filings', () => {
    expect(full).toContain('Jane Roe (CFO): Buy ~$95,000 on 2026-06-01');
  });
  it('states explicitly when context is missing', () => {
    const bare = buildResearchPrompt({ symbol: 'ETF1', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [] });
    expect(bare).toContain('Fundamentals: not available');
    expect(bare).toContain('Recent insider filings: none for this symbol');
    expect(bare).toContain('Recent headlines: none available.');
  });
});
