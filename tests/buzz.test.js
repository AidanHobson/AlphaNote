import { describe, it, expect } from 'vitest';
import { extractTickers, aggregateBuzz, BUZZ_SUBS } from '../server/lib/buzz.js';

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
  it('scans the expected subreddit set', () => {
    expect(BUZZ_SUBS).toContain('wallstreetbets');
    expect(BUZZ_SUBS.length).toBeGreaterThanOrEqual(4);
  });
});
