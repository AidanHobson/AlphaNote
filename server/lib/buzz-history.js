// Time dimension for the Reddit buzz board. Each fresh scan is snapshotted to
// SQLite (persistent disk in production), so tickers get rank-change deltas vs
// roughly a day ago — ▲3 / ▼2 / NEW — instead of only a same-day velocity flag.
// Functions take the db handle so tests can run against an in-memory database.

const SNAPSHOT_MIN_GAP_MS = 30 * 60_000;   // at most one snapshot per half hour
const BASELINE_AGE_MS = 12 * 3600_000;     // compare vs the newest snapshot ≥12h old
const BASELINE_FALLBACK_MS = 60 * 60_000;  // first day: vs the oldest snapshot ≥1h old
const RETENTION_MS = 30 * 24 * 3600_000;

// Record the current board (top items, in rank order). Skips when a snapshot
// was taken recently, so cache rebuilds don't spam history.
export function snapshotBoard(db, items, now = Date.now()) {
  const last = db.prepare('SELECT MAX(snapped_at) AS t FROM buzz_history').get()?.t || 0;
  if (now - last < SNAPSHOT_MIN_GAP_MS) return false;
  const insert = db.prepare('INSERT INTO buzz_history (snapped_at, symbol, rank, mentions, engagement) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    items.forEach((item, i) => insert.run(now, item.symbol, i + 1, item.mentions, item.engagement));
    db.prepare('DELETE FROM buzz_history WHERE snapped_at < ?').run(now - RETENTION_MS);
  });
  tx();
  return true;
}

// Map of symbol → rank delta vs the baseline snapshot: positive = climbed,
// negative = fell, 'new' = absent from the baseline. Empty map when there is
// no usable baseline yet (first hours of history).
export function rankChanges(db, now = Date.now()) {
  const baseline =
    db.prepare('SELECT MAX(snapped_at) AS t FROM buzz_history WHERE snapped_at <= ?').get(now - BASELINE_AGE_MS)?.t
    ?? db.prepare('SELECT MIN(snapped_at) AS t FROM buzz_history WHERE snapped_at <= ?').get(now - BASELINE_FALLBACK_MS)?.t;
  if (!baseline) return new Map();
  const rows = db.prepare('SELECT symbol, rank FROM buzz_history WHERE snapped_at = ?').all(baseline);
  const prev = new Map(rows.map((r) => [r.symbol, r.rank]));
  return { prev, deltaFor: (symbol, rank) => (prev.has(symbol) ? prev.get(symbol) - rank : 'new') };
}

// Convenience: attach `delta` to ranked items (null when no baseline exists).
export function attachDeltas(db, items, now = Date.now()) {
  const changes = rankChanges(db, now);
  if (changes instanceof Map) return items.map((i) => ({ ...i, delta: null }));
  return items.map((item, i) => ({ ...item, delta: changes.deltaFor(item.symbol, i + 1) }));
}
