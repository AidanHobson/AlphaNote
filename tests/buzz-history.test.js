import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { snapshotBoard, attachDeltas } from '../server/lib/buzz-history.js';

const HOUR = 3600_000;
const items = (...symbols) => symbols.map((symbol) => ({ symbol, mentions: 1, engagement: 10 }));

let db;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE buzz_history (
    snapped_at INTEGER NOT NULL, symbol TEXT NOT NULL, rank INTEGER NOT NULL,
    mentions INTEGER NOT NULL, engagement INTEGER NOT NULL
  )`);
});

describe('snapshotBoard', () => {
  it('records ranks and throttles to one snapshot per half hour', () => {
    const t0 = 1_000_000_000_000;
    expect(snapshotBoard(db, items('GME', 'TSLA'), t0)).toBe(true);
    expect(snapshotBoard(db, items('GME'), t0 + 10 * 60_000)).toBe(false); // too soon
    expect(snapshotBoard(db, items('GME'), t0 + 31 * 60_000)).toBe(true);
    const rows = db.prepare('SELECT symbol, rank FROM buzz_history WHERE snapped_at = ?').all(t0);
    expect(rows).toEqual([{ symbol: 'GME', rank: 1 }, { symbol: 'TSLA', rank: 2 }]);
  });
  it('prunes history older than 30 days', () => {
    const now = 1_000_000_000_000;
    snapshotBoard(db, items('OLD'), now - 31 * 24 * HOUR);
    snapshotBoard(db, items('GME'), now);
    expect(db.prepare('SELECT COUNT(*) AS n FROM buzz_history').get().n).toBe(1);
  });
});

describe('attachDeltas', () => {
  const now = 1_000_000_000_000;
  it('returns null deltas when no usable baseline exists yet', () => {
    const out = attachDeltas(db, items('GME'), now);
    expect(out[0].delta).toBeNull();
  });
  it('computes rank movement vs the snapshot from ~a day ago', () => {
    snapshotBoard(db, items('TSLA', 'GME', 'MU'), now - 24 * HOUR); // TSLA #1, GME #2, MU #3
    const out = attachDeltas(db, items('GME', 'TSLA', 'NVDA'), now); // GME #1, TSLA #2, NVDA #3
    expect(out.find((o) => o.symbol === 'GME').delta).toBe(1);   // 2 → 1: climbed
    expect(out.find((o) => o.symbol === 'TSLA').delta).toBe(-1); // 1 → 2: fell
    expect(out.find((o) => o.symbol === 'NVDA').delta).toBe('new');
  });
  it('falls back to the oldest snapshot during the first day of history', () => {
    snapshotBoard(db, items('GME'), now - 2 * HOUR); // younger than 12h, older than 1h
    const out = attachDeltas(db, items('TSLA', 'GME'), now);
    expect(out.find((o) => o.symbol === 'GME').delta).toBe(-1); // 1 → 2
    expect(out.find((o) => o.symbol === 'TSLA').delta).toBe('new');
  });
});
