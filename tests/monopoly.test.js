import { describe, it, expect } from 'vitest';
import { MONOPOLY_PROMPT, MONOPOLY_RADAR_PROMPT, buildMonopolyPrompt, extractRadarTickers } from '../server/lib/monopoly.js';

describe('MONOPOLY_PROMPT (per-ticker profile)', () => {
  it('embeds the six-archetype taxonomy', () => {
    for (const a of ['TECHNICAL', 'SPECTRUM/REGULATORY', 'NETWORK/DATA', 'GEOGRAPHY/CHOKEPOINT', 'CERTIFICATION/COMPLIANCE', 'NICHE INDUSTRIAL']) {
      expect(MONOPOLY_PROMPT).toContain(a);
    }
    expect(MONOPOLY_PROMPT).toContain('ASML in EUV lithography');
    expect(MONOPOLY_PROMPT).toContain('900 MHz');
  });
  it('has the full profile structure including EPIC/FaVeS and scenarios', () => {
    for (const s of ['**Monopoly classification**', '**The structural advantage**', '**Financial fingerprint**', '**EPIC & FaVeS assessment**', '**Speculative thesis**', '**Disruption risk**', '**Scenarios**', '**Catalysts & watch list**', 'Bottom line:']) {
      expect(MONOPOLY_PROMPT).toContain(s);
    }
    expect(MONOPOLY_PROMPT).toContain('probability-weighted');
    expect(MONOPOLY_PROMPT).toContain('sum to 100%');
  });
  it('keeps the fact rails: layered claims, unproven-moat honesty, no advice', () => {
    expect(MONOPOLY_PROMPT).toContain('Never present one as another');
    expect(MONOPOLY_PROMPT).toContain('classify the moat as unproven');
    expect(MONOPOLY_PROMPT).toContain('no invented price targets');
    expect(MONOPOLY_PROMPT).toContain('No personalised investment advice');
  });
  it('covers all cap tiers including small/micro with liquidity flags', () => {
    expect(MONOPOLY_PROMPT).toContain('small $300M-2B / micro <$300M');
    expect(MONOPOLY_PROMPT).toContain('flag liquidity risk for small/micro');
  });
});

describe('MONOPOLY_RADAR_PROMPT (discovery)', () => {
  it('enforces the cap-tier mandate with the sub-$5B quota', () => {
    expect(MONOPOLY_RADAR_PROMPT).toContain('8-12 candidates');
    expect(MONOPOLY_RADAR_PROMPT).toContain('AT LEAST 4 must be sub-$5B');
    expect(MONOPOLY_RADAR_PROMPT).toContain('at most 2 mega/large-cap anchors');
  });
  it('hunts the under-followed habitats and refuses padding', () => {
    for (const h of ['sole-source defence', 'exclusive spectrum', 'rare-earth', 'cable landing rights', 'nuclear-qualified']) {
      expect(MONOPOLY_RADAR_PROMPT).toContain(h);
    }
    expect(MONOPOLY_RADAR_PROMPT).toContain('Fewer credible names beats padding');
    expect(MONOPOLY_RADAR_PROMPT).toContain('MUST be verified');
    expect(MONOPOLY_RADAR_PROMPT).toContain('never emit corrections, "pivot to"');
  });
});

describe('extractRadarTickers (rescan-diversity exclusions)', () => {
  it('handles both "TICKER —" and "NAME (TICKER)" bold-line formats, deduped', () => {
    const text = [
      '**MONOPOLY SCOUT REPORT — AlphaNote**',
      '**ATEX — Anterix (small-cap, Archetype 2)**',
      '**HEICO CORP. (HEI) — HEICO Corporation (large-cap)**',
      '**MOOG INC. (MOG.A) — Moog (large-cap)**',
      '**ATEX — Anterix again**',
      'Bottom line: profile ATEX first.',
    ].join('\n');
    expect(extractRadarTickers(text)).toEqual(['ATEX', 'HEI', 'MOG.A']);
  });
});

describe('buildMonopolyPrompt', () => {
  it('carries the live data blocks: cap, fundamentals, derived multiples, positioning', () => {
    const p = buildMonopolyPrompt({
      symbol: 'ATEX',
      quote: { c: 35, dp: -1.2 },
      profile: { name: 'Anterix Inc', finnhubIndustry: 'Telecom', currency: 'USD', marketCapitalization: 650 },
      fundamentals: {
        available: true, source: 'SEC EDGAR (XBRL)', asOfFY: 2025, currentThrough: '2026-03-31',
        lineItems: [
          { key: 'revenue', label: 'Revenue', current: { value: 4.5e7, basis: 'ttm' }, history: [{ fy: 2024, val: 3.8e7 }, { fy: 2025, val: 4.2e7 }] },
          { key: 'netIncome', label: 'Net Income', current: { value: -2.1e7, basis: 'ttm' }, history: [] },
        ],
        ratios: [{ label: 'Gross margin', value: 98.1, unit: '%' }],
        quarterly: { revenue: [{ end: '2026-03-31', val: 1.2e7 }] },
      },
      valuation: { pe: null, ps: 14.4, pb: 3.1, evEbitda: null, fcfYield: null, fcf: null, ev: 7.1e8 },
      shortVol: { ratio: 44.2, date: '2026-06-11' },
      insiders: [],
      smartMoney: [],
      nextEarnings: { date: '2026-08-12' },
    });
    expect(p).toContain('Market cap: $650.00M');
    expect(p).toContain('Revenue: $45.00M (ttm)');
    expect(p).toContain('Gross margin: 98.1%');
    expect(p).toContain('P/S 14.4x');
    expect(p).toContain('FINRA daily short volume (2026-06-11): 44.2%');
    expect(p).toContain('none of the followed institutions');
    expect(p).toContain('Next scheduled earnings: 2026-08-12.');
  });
  it('says plainly when fundamentals are missing', () => {
    const p = buildMonopolyPrompt({ symbol: 'XXXX', quote: { c: 10, dp: 0 }, fundamentals: null });
    expect(p).toContain('Fundamentals: not available');
    expect(p).toContain('labelled general knowledge');
  });
});
