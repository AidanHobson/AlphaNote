// SQLite-backed key-value cache (persistent disk in production). Sits BEHIND
// the in-memory caches as a second tier, so deploys and restarts start warm
// instead of refetching everything (EDGAR facts, 13F boards, social scans).
// Strictly best-effort: a cache failure must never break a request.

import db from './db.js';

export function createKv(handle) {
  const qGet = handle.prepare('SELECT value, expires_at FROM kv_cache WHERE key = ?');
  const qSet = handle.prepare(`INSERT INTO kv_cache (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`);
  const qDel = handle.prepare('DELETE FROM kv_cache WHERE key = ?');
  const qPrune = handle.prepare('DELETE FROM kv_cache WHERE expires_at < ?');
  let writes = 0;

  return {
    get(key) {
      try {
        const row = qGet.get(key);
        if (!row) return null;
        if (row.expires_at < Date.now()) { qDel.run(key); return null; }
        return JSON.parse(row.value);
      } catch { return null; }
    },
    set(key, value, ttlMs) {
      try {
        qSet.run(key, JSON.stringify(value), Date.now() + ttlMs);
        if (++writes % 50 === 0) qPrune.run(Date.now()); // occasional housekeeping
      } catch { /* best-effort */ }
    },
  };
}

export default createKv(db);
