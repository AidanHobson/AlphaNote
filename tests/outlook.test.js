import { describe, it, expect } from 'vitest';
import { deltaFromEvent } from '../server/lib/ai-provider.js';

describe('deltaFromEvent (streaming delta extraction)', () => {
  it('extracts Anthropic content_block_delta text and ignores other events', () => {
    expect(deltaFromEvent('claude', { type: 'content_block_delta', delta: { text: 'Mono' } })).toBe('Mono');
    expect(deltaFromEvent('claude', { type: 'message_start' })).toBe('');
    expect(deltaFromEvent('claude', { type: 'content_block_delta', delta: {} })).toBe('');
  });
  it('extracts Gemini candidate part text', () => {
    expect(deltaFromEvent('gemini', { candidates: [{ content: { parts: [{ text: 'poly' }] } }] })).toBe('poly');
    expect(deltaFromEvent('gemini', { candidates: [] })).toBe('');
    expect(deltaFromEvent('gemini', {})).toBe('');
  });
});

import { THEME_PROMPT, STOCK_OUTLOOK_PROMPT, buildThemePrompt, buildStockOutlookPrompt, isTickerLike } from '../server/lib/outlook.js';

describe('outlook system prompts', () => {
  it('theme prompt has the speculative structure', () => {
    for (const s of ['**The theme**', '**Why now**', '**Market size & trajectory**', '**Value chain**', '**Picks & shovels**', '**Bottlenecks**', '**Public-market exposure**', '**Bull case**', '**Bear case**', '**Wildcards**', '**What to watch**']) {
      expect(THEME_PROMPT).toContain(s);
    }
  });
  it('demands real business descriptions and vintage-labelled market growth', () => {
    expect(THEME_PROMPT).toContain('TWO OR THREE SENTENCES on what the company actually does');
    expect(STOCK_OUTLOOK_PROMPT).toContain('what the company actually DOES');
    expect(STOCK_OUTLOOK_PROMPT).toContain('**The market**');
    expect(STOCK_OUTLOOK_PROMPT).toContain('a market that does not exist yet');
  });
  it('prefers live web snippets (cited by domain) over training-data figures', () => {
    for (const p of [THEME_PROMPT, STOCK_OUTLOOK_PROMPT]) {
      expect(p).toContain('live web snippets are provided');
      expect(p).toContain('source domain');
    }
  });
  it('theme prompt embeds web snippet lines when provided', () => {
    const p = buildThemePrompt('Robotics', null, ['Live web search — snippets:', '- "USD 88bn in 2026" (mordorintelligence.com)']);
    expect(p).toContain('(mordorintelligence.com)');
  });
  it('bottlenecks section is fact-driven: evidence with vintage or leave it out', () => {
    expect(THEME_PROMPT).toContain('FACT-DRIVEN');
    expect(THEME_PROMPT).toContain('a concrete number or datapoint you are confident in');
    expect(THEME_PROMPT).toContain('If you cannot support a claimed bottleneck with a fact, leave it out');
    expect(THEME_PROMPT).toContain('HBM memory');
    expect(THEME_PROMPT).toContain('a bottleneck with a visible relief date is a trade, not a thesis');
  });
  it('theme prompt frames the picks-and-shovels thesis with its caveats', () => {
    expect(THEME_PROMPT).toContain('get paid regardless of which application-layer player wins');
    expect(THEME_PROMPT).toContain('Technoprobe');
    expect(THEME_PROMPT).toContain('Aehr');
    expect(THEME_PROMPT).toContain('capex cyclicality, customer concentration');
  });
  it('stock prompt asks for the enabler vs end-market classification', () => {
    expect(STOCK_OUTLOOK_PROMPT).toContain('picks-and-shovels enabler');
    expect(STOCK_OUTLOOK_PROMPT).toContain('winner-picking risk for capex cyclicality');
  });
  it('exposure list demands small/mid-cap names with tiers and small-cap hazards', () => {
    expect(THEME_PROMPT).toContain('8-12 bullets spanning the market-cap spectrum');
    expect(THEME_PROMPT).toContain('At LEAST 4 of the names must be small- or mid-cap');
    expect(THEME_PROMPT).toContain('[small: <$2B]');
    expect(THEME_PROMPT).toContain('REAL today or still prospective');
    expect(THEME_PROMPT).toContain('thin liquidity, dilution risk');
    expect(THEME_PROMPT).toContain('rather than padding with weak fits');
  });
  it('stock prompt has the dream/nightmare structure', () => {
    for (const s of ['**Setup**', '**The market**', '**The dream**', '**The nightmare**', '**Asymmetry**', '**Signposts**']) {
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
  it('carries the positioning facts: short volume, thread body, insiders, 13F', () => {
    const p = buildStockOutlookPrompt({
      symbol: 'GME',
      quote: { c: 25, dp: 3.1 },
      buzz: { rank: 1, mentions: 3, engagement: 900, topPost: { title: 'The squeeze thesis', subreddit: 'r/Shortsqueeze', id: 'abc123' } },
      threadBody: 'Float is tiny and borrow fees just doubled. I think MM are trapped.',
      shortVol: { ratio: 64.2, date: '2026-06-11' },
      insiders: [{ insider: 'Jane Roe', title: 'CFO', side: 'Sell', value: 950_000 }],
      smartMoney: [{ manager: 'Renaissance Technologies', value: 0.8e9, change: { type: 'new' } }],
    });
    expect(p).toContain('FINRA daily short volume (2026-06-11): 64.2% of consolidated volume sold short');
    expect(p).toContain('daily short-sale FLOW, not short interest');
    expect(p).toContain('The crowd\'s actual argument — body of that top thread (excerpt, verbatim from Reddit): "Float is tiny');
    expect(p).toContain('what it gets right, what it ignores');
    expect(p).toContain('Jane Roe (CFO) Sell ~$950,000');
    expect(p).toContain('Renaissance Technologies ($0.8B, NEW)');
  });
  it('says when no tracked manager holds it, and omits absent facts entirely', () => {
    const none = buildStockOutlookPrompt({ symbol: 'ACME', quote: { c: 100, dp: 0 }, smartMoney: [] });
    expect(none).toContain('none of the followed institutions held ACME');
    const bare = buildStockOutlookPrompt({ symbol: 'ACME', quote: { c: 100, dp: 0 } });
    expect(bare).not.toContain('FINRA');
    expect(bare).not.toContain('insider');
    expect(bare).not.toContain('13F');
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
