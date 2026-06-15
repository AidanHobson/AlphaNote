import { describe, it, expect } from 'vitest';
import { scoreCandidate, buildScreener } from '../server/lib/screener.js';

const buyCluster = { label: 'strong insider buy cluster', count: 3 };
const selling = { label: 'net insider selling', count: 2 };

describe('scoreCandidate', () => {
  it('rewards short-squeeze setup, attention, momentum, and insider buying with tags', () => {
    const c = scoreCandidate(
      { symbol: 'GME', mentions: 20, shortVol: { ratio: 70 }, rising: true, quote: { price: 25, changePercent: 8 } },
      buyCluster,
      20,
    );
    expect(c.symbol).toBe('GME');
    expect(c.score).toBeGreaterThan(70);
    expect(c.tags).toEqual(expect.arrayContaining(['70% short', 'rising today', 'insider cluster buy', 'most-mentioned']));
    expect(c.components.insider).toBe(100);
  });

  it('floors the insider component at 0 for net selling but still tags it', () => {
    const c = scoreCandidate({ symbol: 'X', mentions: 1, shortVol: { ratio: 30 } }, selling, 20);
    expect(c.components.insider).toBe(-50); // raw contribution shown
    expect(c.tags).toContain('insider selling');
    expect(c.score).toBeGreaterThanOrEqual(0); // composite never negative
  });

  it('a low-signal name scores near zero with no tags', () => {
    const c = scoreCandidate({ symbol: 'QQQ', mentions: 1, shortVol: { ratio: 35 }, rising: false, quote: { price: 500, changePercent: 0.1 } }, null, 20);
    expect(c.score).toBeLessThan(15);
    expect(c.tags).toEqual([]);
  });

  it('carries the candidate source (trending vs off-board insider buying)', () => {
    expect(scoreCandidate({ symbol: 'GME', mentions: 5 }, null, 20).source).toBe('trending');
    expect(scoreCandidate({ symbol: 'XYZ', mentions: 0, source: 'insider buying' }, buyCluster, 20).source).toBe('insider buying');
  });

  it('an off-board insider-buy name (no mentions) still ranks on the insider signal', () => {
    const c = scoreCandidate({ symbol: 'XYZ', mentions: 0, source: 'insider buying' }, buyCluster, 20);
    expect(c.components.attention).toBe(0);
    expect(c.score).toBeGreaterThan(30); // insider weight 0.35 × 1.0 = 35
  });

  it('a curated Chinese ADR ranks on the free signals (squeeze + momentum) it CAN have, carrying its source', () => {
    const c = scoreCandidate(
      { symbol: 'BABA', mentions: 0, source: 'china tech', shortVol: { ratio: 65 }, rising: false, quote: { changePercent: 5 } },
      null, // foreign private issuers file no Form 4 — there is no insider signal
      20,
    );
    expect(c.source).toBe('china tech');
    expect(c.components.attention).toBe(0); // off the Reddit board
    expect(c.components.insider).toBe(0); // no Form 4
    expect(c.components.squeeze).toBeGreaterThan(0);
    expect(c.tags).toContain('65% short');
    expect(c.score).toBeGreaterThan(0);
  });

  it('a US-listed Chinese robotics ADR ranks on momentum, carrying its own source label', () => {
    const c = scoreCandidate(
      { symbol: 'EH', mentions: 0, source: 'china robotics', rising: false, quote: { changePercent: 17 } },
      null,
      20,
    );
    expect(c.source).toBe('china robotics');
    expect(c.components.attention).toBe(0);
    expect(c.components.momentum).toBeGreaterThan(0);
    expect(c.score).toBeGreaterThan(0);
  });
});

describe('buildScreener', () => {
  it('ranks candidates by composite score, highest first', () => {
    const board = { items: [
      { symbol: 'LOW', mentions: 1, shortVol: { ratio: 30 } },
      { symbol: 'HIGH', mentions: 18, shortVol: { ratio: 75 }, rising: true, quote: { changePercent: 6 } },
      { symbol: 'MID', mentions: 9, shortVol: { ratio: 55 } },
    ] };
    const insider = new Map([['HIGH', buyCluster]]);
    const ranked = buildScreener(board, insider);
    expect(ranked.map((c) => c.symbol)).toEqual(['HIGH', 'MID', 'LOW']);
    expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
  });
  it('returns [] for an empty board', () => {
    expect(buildScreener({ items: [] })).toEqual([]);
    expect(buildScreener(null)).toEqual([]);
  });
});
