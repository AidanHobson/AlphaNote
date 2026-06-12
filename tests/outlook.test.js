import { describe, it, expect } from 'vitest';
import { THEME_PROMPT, STOCK_OUTLOOK_PROMPT, buildThemePrompt, buildStockOutlookPrompt, isTickerLike } from '../server/lib/outlook.js';

describe('outlook system prompts', () => {
  it('theme prompt has the speculative structure', () => {
    for (const s of ['**The theme**', '**Why now**', '**Value chain**', '**Public-market exposure**', '**Bull case**', '**Bear case**', '**Wildcards**', '**What to watch**']) {
      expect(THEME_PROMPT).toContain(s);
    }
  });
  it('stock prompt has the dream/nightmare structure', () => {
    for (const s of ['**Setup**', '**The dream**', '**The nightmare**', '**Asymmetry**', '**Signposts**']) {
      expect(STOCK_OUTLOOK_PROMPT).toContain(s);
    }
  });
  it('both keep the speculation rails: layered claims, cutoff caveat, no advice', () => {
    for (const p of [THEME_PROMPT, STOCK_OUTLOOK_PROMPT]) {
      expect(p).toContain('informed speculation');
      expect(p).toContain('training cutoff');
      expect(p).toContain('No personalised investment advice');
      expect(p).toContain('not investment advice');
    }
  });
});

describe('buildThemePrompt', () => {
  it('carries the topic and today\'s date for cutoff caveats', () => {
    const p = buildThemePrompt('Photonics');
    expect(p).toContain('Theme: Photonics');
    expect(p).toMatch(/Today's date: \d{4}-\d{2}-\d{2}/);
  });
  it('embeds the last-30-days social pulse when provided', () => {
    const pulse = { window: 'last 30 days', sources: [
      { source: 'Hacker News', count: 12, items: [{ title: 'Silicon photonics breakthrough', points: 200, comments: 60 }] },
    ] };
    const p = buildThemePrompt('Photonics', pulse);
    expect(p).toContain('Last 30 days — what people are actually discussing');
    expect(p).toContain('Silicon photonics breakthrough" (200 pts, 60 comments)');
  });
});

describe('buildStockOutlookPrompt', () => {
  it('anchors on quote, derived multiples, SPY-relative move, and earnings date', () => {
    const p = buildStockOutlookPrompt({
      symbol: 'ACME',
      quote: { c: 100, dp: 1.5 },
      profile: { name: 'Acme Corp', finnhubIndustry: 'Software', currency: 'USD', marketCapitalization: 50_000 },
      valuation: { pe: 25, ps: 4.2, evEbitda: 17.3, fcfYield: 3, fcf: 1.5e9 },
      history: { available: true, stats: { changePercent: 24.3, low: 71, high: 105 } },
      spyStats: { changePercent: 10.1 },
      nextEarnings: { date: '2026-07-30' },
    });
    expect(p).toContain('Current price: 100 USD (1.50% today)');
    expect(p).toContain('Market cap: $50.00B');
    expect(p).toContain('1-year price change: 24.3%; vs SPY +14.2pp; 52-week range 71 – 105');
    expect(p).toContain('Derived valuation (TTM): P/E 25x, P/S 4.2x, EV/EBITDA 17.3x, FCF yield 3%; FCF $1.50B');
    expect(p).toContain('Next scheduled earnings: 2026-07-30.');
  });
  it('omits blocks gracefully when context is missing', () => {
    const p = buildStockOutlookPrompt({ symbol: 'ACME', quote: { c: 100, dp: 0 } });
    expect(p).toContain('Stock symbol: ACME');
    expect(p).not.toContain('Derived valuation');
    expect(p).not.toContain('Next scheduled earnings');
    expect(p).not.toContain('Reddit retail attention');
  });
  it('includes the Reddit buzz rank as a crowding signal when the ticker is trending', () => {
    const buzz = { rank: 2, mentions: 5, engagement: 7150, topPost: { title: 'GME to the moon', subreddit: 'r/wallstreetbets' } };
    const p = buildStockOutlookPrompt({ symbol: 'GME', quote: { c: 25, dp: 3.1 }, buzz });
    expect(p).toContain('Reddit retail attention: #2 most-mentioned ticker');
    expect(p).toContain('5 mentions, 7,150 combined upvotes+comments');
    expect(p).toContain('Top thread: "GME to the moon" (r/wallstreetbets)');
    expect(p).toContain('heavy retail attention cuts both ways');
  });
});

describe('isTickerLike (stock vs theme detection)', () => {
  it('accepts ticker shapes', () => {
    for (const t of ['AAPL', 'BRK.B', 'nvda', 'X']) expect(isTickerLike(t)).toBe(true);
  });
  it('rejects themes and multi-word topics', () => {
    for (const t of ['AI Infrastructure', 'Quantum Computing', 'GLP-1 drugs', 'a-very-long-topic']) expect(isTickerLike(t)).toBe(false);
  });
  it('single words like "Energy" are ticker-like but fall back to theme mode via the quote check', () => {
    // shape says maybe-ticker; generateOutlook only commits to stock mode when a live quote exists
    expect(isTickerLike('Energy')).toBe(true);
  });
});
