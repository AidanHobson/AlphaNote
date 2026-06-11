import { describe, it, expect } from 'vitest';
import { socialPulseToLines } from '../server/lib/social.js';

const pulse = {
  topic: 'Robotics',
  window: 'last 30 days',
  sources: [
    { source: 'Hacker News', count: 71, totalEngagement: 900, items: [
      { title: 'Neura Robotics announces record Series C', points: 120, comments: 45, date: '2026-06-01' },
      { title: 'An overview of modern AI robotics', points: 80, comments: 30, date: '2026-06-03' },
    ] },
    { source: 'Polymarket', count: 3, items: [
      { title: 'Will a humanoid robot ship in 2026?', volume: 594448, endDate: '2026-12-31', topMarket: { question: 'Humanoid robot mass-market by 2026?', pct: 22, volume: 594448 } },
    ] },
    { source: 'Reddit', count: 4, items: [
      { title: 'Tesla Optimus demo thread', subreddit: 'r/robotics', score: 1200, comments: 300 },
    ] },
  ],
};

describe('socialPulseToLines', () => {
  const lines = socialPulseToLines(pulse).join('\n');

  it('labels the window and the data as attention/sentiment, not fundamentals', () => {
    expect(lines).toContain('Last 30 days — what people are actually discussing');
    expect(lines).toContain('not fundamentals');
  });
  it('renders HN engagement, Polymarket implied odds, and Reddit threads', () => {
    expect(lines).toContain('Neura Robotics announces record Series C" (120 pts, 45 comments)');
    expect(lines).toContain('"Humanoid robot mass-market by 2026?" at 22% implied');
    expect(lines).toContain('$594,448 volume');
    expect(lines).toContain('Tesla Optimus demo thread" (r/robotics, 1200 upvotes)');
  });
  it('returns no lines for an empty/absent pulse', () => {
    expect(socialPulseToLines(null)).toEqual([]);
    expect(socialPulseToLines({ sources: [] })).toEqual([]);
  });
});
