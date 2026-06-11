import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildResearchPrompt, computeValuation } from '../server/lib/research.js';

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

  it('includes quarterly momentum when the fundamentals carry it', () => {
    const withQ = { ...fundamentals, quarterly: { revenue: [{ end: '2025-12-27', val: 3.5e9 }, { end: '2026-03-28', val: 3.9e9 }], netIncome: [] } };
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: withQ, history: null, insiders: [] });
    expect(p).toContain('Revenue by quarter (period end → value): 2025-12-27 $3.50B, 2026-03-28 $3.90B');
    expect(p).not.toContain('Net income by quarter'); // empty series → omitted
  });

  it('includes the derived valuation block with EV, multiples, and FCF yield', () => {
    const valuation = computeValuation({ marketCapitalization: 50_000 }, fundamentals); // $50B cap
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals, history: null, insiders: [], valuation });
    expect(p).toContain('Derived valuation');
    expect(p).toContain('Market cap: $50.00B');
    expect(p).toContain('P/E 25x');
    expect(p).toContain('P/S 4.2x');
  });

  it('includes SPY-relative performance, next earnings, and 13F positioning', () => {
    const smartMoney = [{ manager: 'Berkshire Hathaway', period: '2026-03-31', value: 2_000_000_000, pct: 2.1, change: { type: 'trim', sharesPct: -5 } }];
    const p = buildResearchPrompt({
      symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history, insiders: [],
      nextEarnings: { date: '2026-07-30', hour: 'amc', epsEstimate: 1.62 },
      smartMoney,
      spyStats: { changePercent: 10.1 },
    });
    expect(p).toContain('S&P 500 (SPY) over the same period: 10.1% → relative performance: +14.2pp');
    expect(p).toContain('Next scheduled earnings report: 2026-07-30 (after market close); street EPS estimate 1.62.');
    expect(p).toContain('Berkshire Hathaway: $2.00B position (2.1% of portfolio), trimmed -5% shares QoQ (as of 2026-03-31)');
  });

  it('says when no tracked manager holds the name (empty array ≠ unknown)', () => {
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], smartMoney: [] });
    expect(p).toContain('does not appear among the top holdings');
    const unknown = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], smartMoney: null });
    expect(unknown).not.toContain('does not appear among the top holdings');
  });
});

describe('computeValuation', () => {
  const f = {
    available: true,
    lineItems: [
      { key: 'revenue', current: { value: 12e9 } },
      { key: 'netIncome', current: { value: 2e9 } },
      { key: 'operatingCashFlow', current: { value: 2.2e9 } },
      { key: 'operatingIncome', current: { value: 2.5e9 } },
      { key: 'depreciationAmortization', current: { value: 0.5e9 } },
      { key: 'capex', current: { value: 0.7e9 } },
      { key: 'equity', current: { value: 10e9 } },
      { key: 'cash', current: { value: 3e9 } },
      { key: 'longTermDebt', current: { value: 5e9 } },
    ],
  };
  it('derives EV, multiples, EBITDA, FCF and FCF yield from cap + TTM figures', () => {
    const v = computeValuation({ marketCapitalization: 50_000 }, f); // Finnhub $M → $50B
    expect(v.marketCap).toBe(50e9);
    expect(v.ev).toBe(52e9);                 // 50 + 5 − 3
    expect(v.pe).toBe(25);                   // 50 / 2
    expect(v.ps).toBe(4.2);                  // 50 / 12
    expect(v.pb).toBe(5);                    // 50 / 10
    expect(v.ebitda).toBe(3e9);              // 2.5 + 0.5
    expect(v.evEbitda).toBe(17.3);           // 52 / 3
    expect(v.fcf).toBe(1.5e9);               // 2.2 − 0.7
    expect(v.fcfYield).toBe(3);              // 1.5 / 50
  });
  it('returns null without fundamentals or market cap, and skips negative-denominator multiples', () => {
    expect(computeValuation(null, f)).toBeNull();
    expect(computeValuation({ marketCapitalization: 50_000 }, null)).toBeNull();
    const lossCo = { available: true, lineItems: [{ key: 'netIncome', current: { value: -1e9 } }] };
    expect(computeValuation({ marketCapitalization: 50_000 }, lossCo).pe).toBeNull();
  });
});
