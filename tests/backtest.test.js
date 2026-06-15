import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { closeOnOrBefore, forwardReturn, dailySignals, computeBuzzBacktest, computeConvictionCalibration } from '../server/lib/backtest.js';

const points = (pairs) => pairs.map(([date, close]) => ({ date, close }));

describe('price helpers', () => {
  const p = points([['2026-06-01', 100], ['2026-06-02', 110], ['2026-06-05', 120]]);
  it('closeOnOrBefore finds the latest close at or before a date (incl. gaps/weekends)', () => {
    expect(closeOnOrBefore(p, '2026-06-02')).toBe(110);
    expect(closeOnOrBefore(p, '2026-06-04')).toBe(110); // weekend → last trading close
    expect(closeOnOrBefore(p, '2026-05-30')).toBeNull(); // before first point
  });
  it('forwardReturn computes entry→exit over the horizon', () => {
    expect(forwardReturn(p, '2026-06-01', 4)).toBeCloseTo(0.2, 5); // 100 → 120
    expect(forwardReturn(p, '2026-06-01', 1)).toBeCloseTo(0.1, 5); // 100 → 110
    expect(forwardReturn(p, '2026-05-20', 4)).toBeNull();          // no entry
  });
});

describe('computeBuzzBacktest', () => {
  let db;
  const DAY = 24 * 3600_000;
  const base = Date.parse('2026-06-01T12:00:00Z');
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE buzz_history (snapped_at INTEGER, symbol TEXT, rank INTEGER, mentions INTEGER, engagement INTEGER, short_vol REAL, rising INTEGER)`);
    const ins = db.prepare('INSERT INTO buzz_history VALUES (?,?,?,?,?,?,?)');
    // GME: two correlated snapshots same day → one signal; high short vol; rank 1
    ins.run(base, 'GME', 1, 10, 100, 72, 1);
    ins.run(base + 60_000, 'GME', 1, 12, 120, 72, 1);
    // TSLA: low short vol, rank 5
    ins.run(base, 'TSLA', 5, 4, 40, 30, 0);
  });

  it('dedupes to one signal per symbol per day', () => {
    expect(dailySignals(db, { sinceMs: 0 })).toHaveLength(2);
  });

  it('computes bucketed forward returns and isolates the high-short-vol bucket', () => {
    const now = base + 10 * DAY;
    const prices = {
      GME: points([['2026-06-01', 100], ['2026-06-06', 130]]),  // +30% over horizon
      TSLA: points([['2026-06-01', 50], ['2026-06-06', 45]]),   // -10%
    };
    const spy = points([['2026-06-01', 400], ['2026-06-06', 404]]); // +1%
    const r = computeBuzzBacktest(db, { priceFor: (s) => prices[s], spyPoints: spy, horizonDays: 5, now });
    expect(r.signalsResolved).toBe(2);
    expect(r.buckets.all.n).toBe(2);
    expect(r.buckets.highShort.n).toBe(1);          // only GME (short_vol 72 ≥ 60)
    expect(r.buckets.highShort.avgReturn).toBe(30);
    expect(r.buckets.highShort.hitRate).toBe(100);
    expect(r.buckets.highShort.avgExcess).toBe(29); // 30% − 1% SPY
    expect(r.buckets.all.avgReturn).toBe(10);       // (30 + −10)/2
  });

  it('excludes signals too recent for the horizon to have elapsed', () => {
    const now = base + 2 * DAY; // horizon 5d not yet elapsed for a base-day signal
    const r = computeBuzzBacktest(db, { priceFor: () => null, horizonDays: 5, now });
    expect(r.signalsConsidered).toBe(0);
  });

  it('counts symbols with no price data as unresolved', () => {
    const now = base + 10 * DAY;
    const r = computeBuzzBacktest(db, { priceFor: () => null, horizonDays: 5, now });
    expect(r.signalsResolved).toBe(0);
    expect(r.unresolvedSymbols).toBe(2);
  });
});

describe('computeConvictionCalibration', () => {
  let db;
  const DAY = 24 * 3600_000;
  const now = Date.parse('2026-06-20T12:00:00Z');
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE research_notes (id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, topic TEXT, title TEXT, provider TEXT, conviction INTEGER, text TEXT, meta TEXT, created_at INTEGER)`);
    const ins = db.prepare("INSERT INTO research_notes (user_id, kind, topic, title, text, conviction, created_at) VALUES (1, ?, ?, ?, '', ?, ?)");
    ins.run('monopoly', 'AAA', 'AAA', 5, Date.parse('2026-06-01T00:00:00Z')); // high conviction
    ins.run('research', 'BBB', 'BBB', 2, Date.parse('2026-06-01T00:00:00Z')); // low conviction
  });
  it('buckets returns by conviction band (since-note to latest close)', () => {
    const prices = {
      AAA: points([['2026-06-01', 100], ['2026-06-19', 120]]), // +20%
      BBB: points([['2026-06-01', 100], ['2026-06-19', 90]]),  // -10%
    };
    const c = computeConvictionCalibration(db, { priceFor: (s) => prices[s], now });
    expect(c.sampled).toBe(2);
    expect(c.bands.high).toMatchObject({ n: 1, avgReturn: 20, hitRate: 100 });
    expect(c.bands.low).toMatchObject({ n: 1, avgReturn: -10, hitRate: 0 });
  });
});
