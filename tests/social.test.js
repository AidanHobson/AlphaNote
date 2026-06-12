import { describe, it, expect } from 'vitest';
import { socialPulseToLines, parseRedditRss, parseShredditListing } from '../server/lib/social.js';

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
    expect(lines).toContain('Tesla Optimus demo thread" (r/robotics, 1200 upvotes, 300 comments)');
  });
  it('returns no lines for an empty/absent pulse', () => {
    expect(socialPulseToLines(null)).toEqual([]);
    expect(socialPulseToLines({ sources: [] })).toEqual([]);
  });
  it('renders Reddit posts without scores using the date instead of upvotes', () => {
    const p = { window: 'last 30 days', sources: [
      { source: 'Reddit', count: 1, items: [{ title: 'RSS-only thread', subreddit: 'r/robotics', score: null, comments: null, date: '2026-06-01' }] },
    ] };
    const lines = socialPulseToLines(p).join('\n');
    expect(lines).toContain('"RSS-only thread" (r/robotics, 2026-06-01)');
    expect(lines).not.toContain('null');
  });
});

describe('parseRedditRss (Tier 1 discovery)', () => {
  const XML = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Robotics</title><link href="https://www.reddit.com/r/robotics/"/><updated>2008-01-24T22:19:02+00:00</updated></entry>
    <entry><title>Stairs are hard &amp; fun — part 2</title>
      <link href="https://www.reddit.com/r/robotics/comments/1tmvczp/stairs_are_hard_part_2/"/>
      <updated>2026-05-25T02:10:08+00:00</updated></entry>
    <entry><title>Kraken update</title>
      <link href="https://www.reddit.com/r/KrakenRobotics/comments/9zzxyz1/kraken_update/"/>
      <updated>2026-06-02T10:00:00+00:00</updated></entry>
  </feed>`;
  const posts = parseRedditRss(XML);
  it('keeps only real posts (links with /comments/), dropping subreddit suggestions', () => {
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ postId: '1tmvczp', subreddit: 'r/robotics', date: '2026-05-25' });
  });
  it('decodes HTML entities in titles', () => {
    expect(posts[0].title).toBe('Stairs are hard & fun — part 2');
  });
});

describe('parsePostRssBody (thread body extraction)', () => {
  it('decodes the doubly-encoded content HTML and strips tags/boilerplate', async () => {
    const { parsePostRssBody } = await import('../server/lib/social.js');
    const xml = `<entry><content type="html">&lt;div&gt;Float is &amp;amp;quot;tiny&amp;amp;quot; &amp;lt;b&amp;gt;and borrow fees doubled&amp;lt;/b&amp;gt;.&lt;/div&gt; submitted by /u/trader to r/Shortsqueeze</content></entry>`;
    const text = parsePostRssBody(xml);
    expect(text).toContain('Float is');
    expect(text).toContain('and borrow fees doubled');
    expect(text).not.toContain('<');
    expect(text).not.toContain('submitted by');
  });
  it('returns empty for feeds without content', async () => {
    const { parsePostRssBody } = await import('../server/lib/social.js');
    expect(parsePostRssBody('<entry><title>x</title></entry>')).toBe('');
  });
});

describe('parseShredditListing (score backfill)', () => {
  const HTML = `<div>
    <shreddit-post post-title="Stairs are hard — part 2" score="1293" comment-count="46"
      permalink="/r/robotics/comments/1tmvczp/stairs_are_hard_part_2/" created-timestamp="2026-05-25T02:10:08+0000"></shreddit-post>
    <shreddit-post post-title="Dup" score="999" comment-count="1" permalink="/r/robotics/comments/1tmvczp/dup/"></shreddit-post>
    <shreddit-post post-title="No permalink" score="5" comment-count="0"></shreddit-post>
  </div>`;
  it('maps post id → real score/comments, first occurrence wins', () => {
    const m = parseShredditListing(HTML);
    expect(m.get('1tmvczp')).toEqual({ score: 1293, comments: 46 });
    expect(m.size).toBe(1);
  });
});
