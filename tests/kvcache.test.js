import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createKv } from '../server/lib/kvcache.js';

let kv;
beforeEach(() => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE kv_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  kv = createKv(db);
});

describe('kvcache', () => {
  it('round-trips JSON values within the TTL', () => {
    kv.set('board', { items: [{ symbol: 'GME' }], n: 3 }, 60_000);
    expect(kv.get('board')).toEqual({ items: [{ symbol: 'GME' }], n: 3 });
  });
  it('expires entries and deletes them on read', () => {
    kv.set('stale', { a: 1 }, -1); // already expired
    expect(kv.get('stale')).toBeNull();
    expect(kv.get('stale')).toBeNull(); // gone, not just filtered
  });
  it('upserts on repeated set', () => {
    kv.set('k', 1, 60_000);
    kv.set('k', 2, 60_000);
    expect(kv.get('k')).toBe(2);
  });
  it('returns null for unknown keys and never throws on bad input', () => {
    expect(kv.get('missing')).toBeNull();
    expect(() => kv.set('weird', undefined, 60_000)).not.toThrow();
  });
});
