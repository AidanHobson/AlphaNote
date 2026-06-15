import { describe, it, expect, vi } from 'vitest';

// Mock the data sources so getDigest is tested as pure aggregation logic.
vi.mock('../server/lib/auth.js', () => ({ getUserState: () => ({ watchlist: ['GME', 'TSLA', 'NVDA'], notes: {} }) }));
vi.mock('../server/lib/buzz.js', () => ({
  getRedditBuzz: async () => ({ items: [
    { symbol: 'AAPL', delta: 5 },
    { symbol: 'GME', shortVol: { ratio: 68 }, rising: true, delta: 2 },
    { symbol: 'XYZ', delta: 'new', shortVol: { ratio: 71 } },
    { symbol: 'NVDA', delta: 'new' },
  ] }),
}));
vi.mock('../server/lib/insider.js', () => ({
  getInsiderTransactions: async () => ([
    { symbol: 'TSLA', side: 'Buy', value: 500_000, insider: 'Jane Roe' },
    { symbol: 'TSLA', side: 'Buy', value: 300_000, insider: 'John Doe' },
    { symbol: 'TSLA', side: 'Sell', value: 999_999, insider: 'Sam' },
    { symbol: 'AAPL', side: 'Buy', value: 1_000_000, insider: 'Not Watched' }, // not on watchlist
  ]),
}));
vi.mock('../server/lib/finnhub.js', () => ({
  getNextEarnings: async (sym) => (sym === 'NVDA' ? { date: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10), hour: 'amc' } : { date: '2027-01-01', hour: 'bmo' }),
}));

const { getDigest } = await import('../server/lib/digest.js');

describe('getDigest', () => {
  it('aggregates trending, insider buys, earnings-soon, and new-on-board for the watchlist', async () => {
    const d = await getDigest(1);
    expect(d.watchlistCount).toBe(3);

    // GME (rank 2) and NVDA (rank 4) are both on the board and the watchlist.
    expect(d.trending).toEqual([
      { symbol: 'GME', rank: 2, shortVol: 68, rising: true },
      { symbol: 'NVDA', rank: 4, shortVol: null, rising: false },
    ]);

    // TSLA buys aggregated (2 distinct buyers, $800k); the AAPL buy is off-watchlist.
    expect(d.insiderBuys).toEqual([{ symbol: 'TSLA', buyers: 2, value: 800_000 }]);

    // NVDA reports within the week; the 2027 dates are excluded.
    expect(d.earningsSoon.map((e) => e.symbol)).toEqual(['NVDA']);

    // Fresh names on the board (delta === 'new').
    expect(d.newOnBoard.map((n) => n.symbol)).toEqual(['XYZ', 'NVDA']);
    expect(d.empty).toBe(false);
  });
});
