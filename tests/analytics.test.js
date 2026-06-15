import { describe, it, expect } from 'vitest';
import { scoreInsiderActivity, insiderScoreLine, peerCompLines } from '../server/lib/analytics.js';

const tx = (insider, side, value, role = {}) => ({ insider, side, value, ...role });

describe('scoreInsiderActivity', () => {
  it('flags a strong cluster: multiple officers buying, none selling', () => {
    const s = scoreInsiderActivity([
      tx('Jane Roe', 'Buy', 500_000, { isOfficer: true }),
      tx('John Doe', 'Buy', 300_000, { isDirector: true }),
      tx('Jane Roe', 'Buy', 100_000, { isOfficer: true }),
    ]);
    expect(s.label).toBe('strong insider buy cluster');
    expect(s.distinctBuyers).toBe(2);
    expect(s.officerBuyers).toBe(2);
    expect(s.cluster).toBe(true);
    expect(s.buyValue).toBe(900_000);
  });
  it('detects net selling and net buying by value skew', () => {
    expect(scoreInsiderActivity([tx('A', 'Sell', 1_000_000), tx('B', 'Buy', 100_000)]).label).toBe('net insider selling');
    expect(scoreInsiderActivity([tx('A', 'Buy', 1_000_000), tx('B', 'Sell', 100_000)]).label).toBe('net insider buying');
  });
  it('returns a neutral label with no transactions', () => {
    expect(scoreInsiderActivity([]).label).toBe('no open-market insider activity');
  });
  it('insiderScoreLine summarises buyers, value, and the cluster note', () => {
    const line = insiderScoreLine(scoreInsiderActivity([
      tx('A', 'Buy', 2_000_000, { isOfficer: true }), tx('B', 'Buy', 1_000_000, { isDirector: true }),
    ]), 'GME');
    expect(line).toContain('GME: strong insider buy cluster');
    expect(line).toContain('2 distinct buyers (2 officer/director)');
    expect(line).toContain('cluster of insiders');
  });
});

describe('peerCompLines', () => {
  it('renders the subject + peers with derived multiples, needs ≥2 valid rows', () => {
    const lines = peerCompLines([
      { symbol: 'AAPL', subject: true, name: 'Apple', marketCap: 4.28e12, pe: 35, ps: 9.5, evEbitda: 27 },
      { symbol: 'MSFT', name: 'Microsoft', marketCap: 3.1e12, pe: 38, ps: 13 },
    ]).join('\n');
    expect(lines).toContain('Peer comparables');
    expect(lines).toContain('AAPL (subject) — Apple: P/E 35x, P/S 9.5x, EV/EBITDA 27x');
    expect(lines).toContain('MSFT — Microsoft: P/E 38x, P/S 13x');
  });
  it('returns nothing when fewer than two rows carry multiples', () => {
    expect(peerCompLines([{ symbol: 'AAPL', pe: 35 }])).toEqual([]);
    expect(peerCompLines([{ symbol: 'AAPL', pe: 35 }, { symbol: 'X' }])).toEqual([]);
  });
});
