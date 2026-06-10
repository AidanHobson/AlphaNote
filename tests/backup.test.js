import { describe, it, expect } from 'vitest';

// Isolated in-memory DB for the module chain (db.js reads env at import).
process.env.DB_PATH = ':memory:';
const { backupName, isBackupName, pruneList } = await import('../server/lib/backup.js');

describe('backupName / isBackupName', () => {
  it('generates a strictly-validatable, sortable name', () => {
    const name = backupName(new Date('2026-06-11T04:05:06Z'));
    expect(name).toBe('alphanote-2026-06-11T04-05-06Z.db');
    expect(isBackupName(name)).toBe(true);
  });
  it('rejects path traversal and junk (download-route guard)', () => {
    expect(isBackupName('../../../etc/passwd')).toBe(false);
    expect(isBackupName('alphanote-2026-06-11T04-05-06Z.db/../x')).toBe(false);
    expect(isBackupName('alphanote-..%2F.db')).toBe(false);
    expect(isBackupName('')).toBe(false);
    expect(isBackupName(null)).toBe(false);
    expect(isBackupName('alphanote.db')).toBe(false); // the live DB itself is not downloadable
  });
});

describe('pruneList (retention)', () => {
  const names = Array.from({ length: 10 }, (_, i) => backupName(new Date(Date.UTC(2026, 5, i + 1))));
  it('returns everything beyond the newest N', () => {
    const pruned = pruneList(names, 7);
    expect(pruned).toHaveLength(3);
    // the OLDEST three get pruned
    expect(pruned).toEqual(expect.arrayContaining([names[0], names[1], names[2]]));
  });
  it('prunes nothing when under the cap', () => {
    expect(pruneList(names.slice(0, 5), 7)).toHaveLength(0);
  });
});
