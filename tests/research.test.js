import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildResearchPrompt, computeValuation, marketMultiples, companyMetrics, rangePosition } from '../server/lib/research.js';

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

  it('includes the market multiples block (trailing P/E, forward P/E, PEG) when provided', () => {
    const marketMult = marketMultiples({ peTTM: 34.88, forwardPE: 33.39, pegTTM: 2.76, forwardPEG: 2.43, epsTTM: 8.27, epsGrowthTTMYoy: 29.01, epsGrowth5Y: 17.91 });
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], marketMult });
    expect(p).toContain('Market valuation multiples');
    expect(p).toContain('Trailing P/E (TTM): 34.88x on TTM EPS 8.27');
    expect(p).toContain('Forward P/E: 33.39x');
    expect(p).toContain('PEG (trailing): 2.76');
    expect(p).toContain('PEG (forward): 2.43');
    expect(p).toContain('EPS TTM YoY 29.01%');
  });

  it('omits the market multiples block when no valuation metrics are present', () => {
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], marketMult: null });
    expect(p).not.toContain('Market valuation multiples');
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

  it('includes the key-metrics block: returns, margin trend, balance sheet, capital return, market profile', () => {
    const keyMetrics = companyMetrics({
      roeTTM: 146.69, roe5Y: 163.92, roaTTM: 34.02, roiTTM: 69.07,
      grossMarginTTM: 47.86, grossMargin5Y: 44.47, operatingMarginTTM: 32.64, operatingMargin5Y: 30.67,
      netProfitMarginTTM: 27.15, netProfitMargin5Y: 25.48,
      currentRatioQuarterly: 1.07, 'totalDebt/totalEquityQuarterly': 0.8, netInterestCoverageTTM: 622.51,
      currentDividendYieldTTM: 0.35, payoutRatioTTM: 12.69, dividendGrowthRate5Y: 4.95,
      beta: 1.1, '52WeekHigh': 317.4, '52WeekLow': 195.07, '52WeekPriceReturnDaily': 50.89, 'priceRelativeToS&P50052Week': 24.45,
    });
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], keyMetrics });
    expect(p).toContain('Returns: ROE 146.69% (5Y avg 163.92%), ROA 34.02%, ROIC 69.07%');
    expect(p).toContain('gross 47.86% vs 5Y 44.47%');
    expect(p).toContain('Balance sheet: current ratio 1.07, debt/equity 0.8, interest coverage 622.51x');
    expect(p).toContain('dividend yield 0.35%, payout 12.69%, 5Y dividend growth 4.95%');
    expect(p).toContain('relative to S&P 500 over 52 weeks: +24.45pp');
    expect(p).toContain('now at 0% of range'); // quote.c=100 is below the 195.07 low → clamps to 0%
  });

  it('includes the earnings-surprise history with beat/miss tags', () => {
    const surprises = [
      { period: '2026-03-31', quarter: 2, year: 2026, actual: 2.01, estimate: 1.99, surprisePercent: 1.1 },
      { period: '2025-12-31', quarter: 1, year: 2026, actual: 2.84, estimate: 2.9, surprisePercent: -2.1 },
    ];
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], surprises });
    expect(p).toContain('Earnings surprise history');
    expect(p).toContain('Q2 2026 (2026-03-31): actual 2.01 vs est 1.99 → beat +1.1%');
    expect(p).toContain('Q1 2026 (2025-12-31): actual 2.84 vs est 2.9 → miss -2.1%');
  });

  it('notes when a company pays no dividend', () => {
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], keyMetrics: companyMetrics({ roeTTM: 20, currentDividendYieldTTM: 0 }) });
    expect(p).toContain('pays no dividend');
  });

  it('includes the SEC filings block with MD&A, risk factors, and dated 8-K items', () => {
    const filings = {
      available: true,
      periodic: { form: '10-Q', filingDate: '2026-05-01', mdna: 'Revenue grew on strong demand and margins expanded.', riskFactors: 'Supply concentration and regulatory change are key risks.' },
      events: [
        { form: '8-K', filingDate: '2026-04-30', items: ['Item 2.02 — results of operations (earnings release)'], excerpt: 'The company issued a press release reporting results.' },
        { form: '8-K', filingDate: '2026-04-20', items: ['Item 5.02 — departure or appointment of directors/officers'], excerpt: null },
      ],
    };
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], filings });
    expect(p).toContain('From the SEC filings');
    expect(p).toContain('Latest periodic report: 10-Q filed 2026-05-01');
    expect(p).toContain('MD&A excerpt: "Revenue grew on strong demand');
    expect(p).toContain('Risk Factors excerpt: "Supply concentration');
    expect(p).toContain('8-K filed 2026-04-30: Item 2.02 — results of operations (earnings release)');
    expect(p).toContain('8-K filed 2026-04-20: Item 5.02');
  });

  it('omits the SEC filings block when filings are unavailable', () => {
    const p = buildResearchPrompt({ symbol: 'ACME', quote, profile, news: [], ratings: null, fundamentals: null, history: null, insiders: [], filings: null });
    expect(p).not.toContain('From the SEC filings');
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

describe('companyMetrics & rangePosition', () => {
  it('extracts a curated subset incl. slash/ampersand keys, and rounds', () => {
    const k = companyMetrics({ roeTTM: 146.69, 'totalDebt/totalEquityQuarterly': 0.7955, 'priceRelativeToS&P50052Week': 24.4511, beta: 1.0955 });
    expect(k).toMatchObject({ roeTTM: 146.69, debtToEquity: 0.8, relToSpy52w: 24.45, beta: 1.1 });
  });
  it('returns null when the blob carries none of the wanted fields', () => {
    expect(companyMetrics(null)).toBeNull();
    expect(companyMetrics({ peTTM: 30 })).toBeNull();
  });
  it('rangePosition maps price within the 52-week band to 0-100%, clamped', () => {
    expect(rangePosition(250, 200, 300)).toBe(50);
    expect(rangePosition(190, 200, 300)).toBe(0); // below the low → clamped
    expect(rangePosition(100, 200, 200)).toBeNull(); // degenerate band
    expect(rangePosition(undefined, 200, 300)).toBeNull();
  });
});

describe('marketMultiples', () => {
  it('extracts and rounds trailing P/E, forward P/E and PEG from Finnhub basic financials', () => {
    const m = marketMultiples({ peTTM: 34.8842, forwardPE: 33.38937, pegTTM: 2.75635, forwardPEG: 2.42832, epsTTM: 8.2666, epsGrowthTTMYoy: 29.01 });
    expect(m).toMatchObject({ pe: 34.88, forwardPE: 33.39, peg: 2.76, forwardPeg: 2.43, epsTTM: 8.27, epsGrowthTTMYoy: 29.01 });
  });
  it('falls back to peBasicExclExtraTTM when peTTM is missing', () => {
    expect(marketMultiples({ peBasicExclExtraTTM: 20.5 }).pe).toBe(20.5);
  });
  it('returns null when no P/E or PEG fields are present (e.g. an ADR/ETF with sparse metrics)', () => {
    expect(marketMultiples(null)).toBeNull();
    expect(marketMultiples({})).toBeNull();
    expect(marketMultiples({ revenueGrowthTTMYoy: 5 })).toBeNull();
  });
});
