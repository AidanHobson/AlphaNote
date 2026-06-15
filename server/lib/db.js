// SQLite store for user accounts, sessions, and per-user state (watchlist/notes).
// File-based — fits the persistent Express process. NOTE: not suitable for a
// read-only serverless filesystem; use a hosted Postgres/managed SQLite there.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'alphanote.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_state (
    user_id    INTEGER PRIMARY KEY,
    watchlist  TEXT NOT NULL DEFAULT '[]',
    notes      TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS buzz_history (
    snapped_at INTEGER NOT NULL,
    symbol     TEXT NOT NULL,
    rank       INTEGER NOT NULL,
    mentions   INTEGER NOT NULL,
    engagement INTEGER NOT NULL,
    short_vol  REAL,
    rising     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_buzz_history_time ON buzz_history(snapped_at);
  CREATE INDEX IF NOT EXISTS idx_buzz_history_symbol ON buzz_history(symbol, snapped_at);
  CREATE TABLE IF NOT EXISTS kv_cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS error_log (
    id      INTEGER PRIMARY KEY,
    t       INTEGER NOT NULL,
    scope   TEXT NOT NULL,
    message TEXT NOT NULL,
    path    TEXT,
    status  INTEGER
  );
  CREATE TABLE IF NOT EXISTS research_notes (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    topic      TEXT NOT NULL,
    title      TEXT NOT NULL,
    provider   TEXT,
    conviction INTEGER,
    text       TEXT NOT NULL,
    meta       TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_research_notes_user ON research_notes(user_id, created_at);
`);

// Migration: add users.status to databases created before the approval flow.
// Existing accounts default to 'active' (already implicitly approved).
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'status')) {
  db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
}

// Migration: add buzz_history.short_vol / rising for the signal backtest. Older
// rows keep NULL (excluded from the short-vol / rising buckets, counted in 'all').
const buzzCols = db.prepare('PRAGMA table_info(buzz_history)').all().map((c) => c.name);
if (!buzzCols.includes('short_vol')) db.exec('ALTER TABLE buzz_history ADD COLUMN short_vol REAL');
if (!buzzCols.includes('rising')) db.exec('ALTER TABLE buzz_history ADD COLUMN rising INTEGER');

export default db;
