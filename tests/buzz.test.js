import { describe, it, expect } from 'vitest';
import { extractTickers, aggregateBuzz, mergeTodaySignal, buildBriefPrompt, BRIEF_PROMPT, BUZZ_SUBS } from '../server/lib/buzz.js';

// Simulated SEC ticker universe — includes the slang-colliding real tickers.
const UNIVERSE = new Set(['TSLA', 'NVDA', 'GME', 'AMD', 'OPEN', 'DD', 'AI', 'YOLO', 'NOW', 'IT', 'BRK.B', 'F']);

describe('extractTickers', () => {
  it('extracts bare uppercase tokens that are real tickers', () => {
    expect([...extractTickers('TSLA calls printing while NVDA consolidates', UNIVERSE)]).toEqual(['TSLA', 'NVDA']);
  });
  it('ignores uppercase words that are not in the ticker universe', () => {
    expect(extractTickers('HUGE WIN TODAY BOYS', UNIVERSE).size).toBe(0);
  });
  it('suppresses slang-colliding tickers unless cashtagged', () => {
    // DD, YOLO, AI, NOW, IT, OPEN are real tickers but almost always slang/words in titles
    expect(extractTickers('My DD on why I YOLO into AI right NOW — IT is OPEN season', UNIVERSE).size).toBe(0);
    expect([...extractTickers('My $DD position after the $AI earnings', UNIVERSE)]).toEqual(['DD', 'AI']);
  });
  it('cashtags are case-insensitive and still validated against the universe', () => {
    expect([...extractTickers('loading up on $tsla and $FAKE', UNIVERSE)]).toEqual(['TSLA']);
    expect(extractTickers('paying with $100 bills', UNIVERSE).size).toBe(0);
  });
});

describe('aggregateBuzz', () => {
  const posts = [
    { title: 'GME to the moon', subreddit: 'r/wallstreetbets', score: 5000, comments: 1200 },
    { title: 'GME short interest update', subreddit: 'r/stocks', score: 800, comments: 150 },
    { title: 'TSLA Q2 delivery thread', subreddit: 'r/stocks', score: 2000, comments: 600 },
    { title: 'Why I sold everything (no tickers here)', subreddit: 'r/investing', score: 9999, comments: 999 },
  ];
  const board = aggregateBuzz(posts, UNIVERSE);

  it('ranks by mentions first, then engagement', () => {
    expect(board.map((b) => b.symbol)).toEqual(['GME', 'TSLA']);
    expect(board[0]).toMatchObject({ mentions: 2, engagement: 7150 });
  });
  it('keeps the most-engaged thread as topPost and collects subreddits', () => {
    expect(board[0].topPost.title).toBe('GME to the moon');
    expect(board[0].subreddits.sort()).toEqual(['r/stocks', 'r/wallstreetbets']);
  });
  it('scans the expected subreddit set, including the speculative subs', () => {
    expect(BUZZ_SUBS).toContain('wallstreetbets');
    expect(BUZZ_SUBS).toContain('pennystocks');
    expect(BUZZ_SUBS).toContain('Shortsqueeze');
  });
  it('keeps the 3 most-engaged threads per ticker', () => {
    const many = [1000, 50, 400, 5].map((score, i) => ({ title: `GME thread ${score}`, subreddit: 'r/wallstreetbets', score, comments: 0 }));
    const [gme] = aggregateBuzz(many, UNIVERSE);
    expect(gme.posts.map((p) => p.score)).toEqual([1000, 400, 50]);
    expect(gme.topPost.score).toBe(1000);
    expect(gme.mentions).toBe(4); // all four still counted
  });
});

describe('mergeTodaySignal', () => {
  const week = [
    { symbol: 'GME', mentions: 5, engagement: 9000 },
    { symbol: 'TSLA', mentions: 3, engagement: 2000 },
    { symbol: 'MU', mentions: 2, engagement: 300 },
  ];
  const day = [
    { symbol: 'GME', mentions: 2, engagement: 1500 },
    { symbol: 'MU', mentions: 1, engagement: 80 },
  ];
  const merged = mergeTodaySignal(week, day);

  it('flags rising names: 2+ mentions today, or 1 with heavy engagement', () => {
    expect(merged.find((m) => m.symbol === 'GME')).toMatchObject({ today: { mentions: 2 }, rising: true });
    expect(merged.find((m) => m.symbol === 'MU')).toMatchObject({ today: { mentions: 1 }, rising: false });
  });
  it('gives zero today-counts to names absent from the day scan', () => {
    expect(merged.find((m) => m.symbol === 'TSLA')).toMatchObject({ today: { mentions: 0, engagement: 0 }, rising: false });
  });
});

describe('Retail Pulse brief', () => {
  it('system prompt has the structure and the attention-not-fundamentals rail', () => {
    for (const s of ['**Where the crowd is**', '**Rising today**', '**Contrarian read**', 'Bottom line:']) {
      expect(BRIEF_PROMPT).toContain(s);
    }
    expect(BRIEF_PROMPT).toContain('not fundamentals');
    expect(BRIEF_PROMPT).toContain('No personalised investment advice');
    expect(BRIEF_PROMPT).toContain('picks-and-shovels');
  });
  it('buildBriefPrompt renders ranks, today counts, RISING flags, prices, and threads', () => {
    const board = {
      window: 'top posts, past week',
      subreddits: ['r/wallstreetbets'],
      postsScanned: 120,
      generatedAt: '2026-06-12T01:00:00.000Z',
      items: [{
        symbol: 'GME', name: 'GameStop Corp', mentions: 5, engagement: 9000,
        today: { mentions: 2, engagement: 1500 }, rising: true,
        quote: { price: 25.5, changePercent: 3.14 },
        posts: [{ title: 'GME to the moon', subreddit: 'r/wallstreetbets', score: 5000, comments: 1200 }],
      }],
    };
    const p = buildBriefPrompt(board);
    expect(p).toContain('#1 GME (GameStop Corp) — 5 mentions, 9,000 engagement this week; today: 2 mentions (RISING) | price 25.5 (+3.14% today)');
    expect(p).toContain('"GME to the moon" (r/wallstreetbets, 5000 upvotes, 1200 comments)');
    expect(p).toContain('ONLY the board above');
  });
});
