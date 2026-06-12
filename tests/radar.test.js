import { describe, it, expect } from 'vitest';
import { RADAR_PROMPT, buildRadarPrompt } from '../server/lib/radar.js';

describe('RADAR_PROMPT', () => {
  it('excludes the canonical named themes and demands narrower/earlier ones', () => {
    for (const named of ['robotics', 'quantum computing', 'GLP-1', 'EVs', 'crypto/Bitcoin', 'photonics']) {
      expect(RADAR_PROMPT).toContain(named);
    }
    expect(RADAR_PROMPT).toContain('do NOT propose these');
    expect(RADAR_PROMPT).toContain('narrower, stranger, or earlier');
  });
  it('is fact-driven: two evidence quotes per theme, never pad', () => {
    expect(RADAR_PROMPT).toContain('at least TWO distinct pieces of evidence');
    expect(RADAR_PROMPT).toContain('quote the thread/story titles or market questions verbatim');
    expect(RADAR_PROMPT).toContain('No evidence, no theme');
    expect(RADAR_PROMPT).toContain('never pad with a theme the signal does not show');
  });
  it('keeps the structure: coined bold names, evidence, market angle, confirmation', () => {
    for (const s of ['What it is', 'Evidence', 'Public-market angle', 'Confirmation', 'Bottom line:']) {
      expect(RADAR_PROMPT).toContain(s);
    }
  });
});

describe('buildRadarPrompt', () => {
  const signal = {
    hn: [{ title: 'Grid-scale iron-air batteries hit cost parity', points: 900, comments: 400, date: '2026-06-10' }],
    buzz: { items: [{ symbol: 'KTOS', posts: [{ title: 'Drone basket DD', subreddit: 'r/stocks', score: 500, comments: 48 }] }] },
    predictions: { events: [{ title: 'US recession in 2026?', topMarket: { question: 'US recession in 2026?', pct: 12 } }] },
  };
  const p = buildRadarPrompt(signal);

  it('renders all three signal blocks with verbatim titles', () => {
    expect(p).toContain('"Grid-scale iron-air batteries hit cost parity" (900 pts, 400 comments, 2026-06-10)');
    expect(p).toContain('[KTOS] "Drone basket DD" (r/stocks, 500 upvotes)');
    expect(p).toContain('"US recession in 2026?" — consensus: "US recession in 2026?" at 12%');
  });
  it('omits empty blocks gracefully', () => {
    const bare = buildRadarPrompt({ hn: [], buzz: null, predictions: null });
    expect(bare).not.toContain('Hacker News');
    expect(bare).not.toContain('Reddit');
    expect(bare).toContain('Identify the emerging');
  });
});
