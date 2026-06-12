import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { saveNote, listNotes, getNote, deleteNote, extractConviction } from '../server/lib/notes-history.js';

let db;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE research_notes (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
    topic TEXT NOT NULL, title TEXT NOT NULL, provider TEXT, conviction INTEGER,
    text TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
  )`);
});

const sample = (over = {}) => ({
  kind: 'outlook', topic: 'ATEX', title: 'Anterix Inc (ATEX)', provider: 'claude',
  text: 'Bottom line: cautiously constructive, conviction 3/5 — spectrum is real.',
  meta: { topic: 'ATEX', data: { name: 'Anterix Inc' } },
  ...over,
});

describe('extractConviction', () => {
  it('parses the conviction score out of bottom lines', () => {
    expect(extractConviction('cautiously constructive, conviction 3/5')).toBe(3);
    expect(extractConviction('Conviction score: 4 / 5')).toBe(4);
    expect(extractConviction('no score here')).toBeNull();
  });
});

describe('notes history', () => {
  it('saves with extracted conviction and lists newest-first per user', () => {
    saveNote(db, 1, sample());
    saveNote(db, 1, sample({ kind: 'monopoly', topic: 'VRSN', title: 'VeriSign (VRSN)', text: 'Bottom line: conviction 5/5.' }));
    saveNote(db, 2, sample({ topic: 'OTHER' })); // different user
    const list = listNotes(db, 1);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: 'monopoly', topic: 'VRSN', conviction: 5 });
    expect(list[1]).toMatchObject({ kind: 'outlook', topic: 'ATEX', conviction: 3 });
  });
  it('round-trips the full meta payload and scopes get/delete to the owner', () => {
    const id = saveNote(db, 1, sample());
    expect(getNote(db, 1, id).meta).toEqual({ topic: 'ATEX', data: { name: 'Anterix Inc' } });
    expect(getNote(db, 2, id)).toBeNull();
    expect(deleteNote(db, 2, id)).toBe(false);
    expect(deleteNote(db, 1, id)).toBe(true);
    expect(getNote(db, 1, id)).toBeNull();
  });
  it('rejects invalid kinds and prunes beyond the per-user cap', () => {
    expect(saveNote(db, 1, sample({ kind: 'weird' }))).toBeNull();
    for (let i = 0; i < 205; i++) saveNote(db, 1, sample({ topic: `T${i}` }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM research_notes WHERE user_id = 1').get().n).toBe(200);
    expect(listNotes(db, 1, { limit: 5 })[0].topic).toBe('T204'); // newest kept
  });
});
