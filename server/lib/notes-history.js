// Persistent per-user history of generated AI notes (research / outlook /
// monopoly). Notes were previously ephemeral — regenerate or navigate away and
// the view was gone. Every fresh generation is auto-saved; the meta column
// stores the FULL response JSON so a saved note restores into the UI exactly
// as it was generated. Functions take the db handle for in-memory tests.

import db from './db.js';

const KEEP_PER_USER = 200;
const VALID_KINDS = new Set(['research', 'outlook', 'monopoly']);

// "cautiously constructive, conviction 3/5" → 3 (for the list + future comparisons)
export function extractConviction(text) {
  const m = /conviction[^0-9/]{0,15}([1-5])\s*\/\s*5/i.exec(String(text));
  return m ? Number(m[1]) : null;
}

export function saveNote(handle, userId, { kind, topic, title, provider, text, meta }) {
  if (!VALID_KINDS.has(kind) || !userId || !text) return null;
  const info = handle.prepare(
    'INSERT INTO research_notes (user_id, kind, topic, title, provider, conviction, text, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    userId, kind,
    String(topic || '').slice(0, 80),
    String(title || topic || '').slice(0, 160),
    provider || null,
    extractConviction(text),
    String(text),
    JSON.stringify(meta ?? {}),
    Date.now(),
  );
  // Keep the most recent N per user.
  handle.prepare(
    `DELETE FROM research_notes WHERE user_id = ? AND id NOT IN
     (SELECT id FROM research_notes WHERE user_id = ? ORDER BY id DESC LIMIT ${KEEP_PER_USER})`,
  ).run(userId, userId);
  return info.lastInsertRowid;
}

export function listNotes(handle, userId, { limit = 50 } = {}) {
  return handle.prepare(
    'SELECT id, kind, topic, title, provider, conviction, created_at FROM research_notes WHERE user_id = ? ORDER BY id DESC LIMIT ?',
  ).all(userId, Math.min(Math.max(limit, 1), 200));
}

export function getNote(handle, userId, id) {
  const row = handle.prepare(
    'SELECT id, kind, topic, title, provider, conviction, text, meta, created_at FROM research_notes WHERE user_id = ? AND id = ?',
  ).get(userId, Number(id));
  if (!row) return null;
  try { row.meta = JSON.parse(row.meta); } catch { row.meta = {}; }
  return row;
}

export function deleteNote(handle, userId, id) {
  return handle.prepare('DELETE FROM research_notes WHERE user_id = ? AND id = ?').run(userId, Number(id)).changes > 0;
}

// Bound to the real database for the routes.
export const notesHistory = {
  save: (userId, note) => saveNote(db, userId, note),
  list: (userId, opts) => listNotes(db, userId, opts),
  get: (userId, id) => getNote(db, userId, id),
  delete: (userId, id) => deleteNote(db, userId, id),
};
