// Periodic SQLite backups — daily online snapshots of the database (safe while
// the app is running, via better-sqlite3's backup API) written next to the DB
// (on Render: the persistent disk), keeping the newest 7. Admin endpoints let
// you list, trigger, and DOWNLOAD a snapshot — the download is the off-site
// story: pull a copy to your machine from the Admin page anytime.
//
// The scheduler re-checks hourly and only snapshots when the newest backup is
// ~a day old, so frequent restarts/deploys don't churn out extra copies.

import fs from 'node:fs';
import path from 'node:path';
import db, { DB_PATH } from './db.js';

const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'db-backups');
const DAY_MS = 24 * 3600_000;
const CHECK_MS = 3600_000; // hourly freshness check
const KEEP = 7;

// alphanote-2026-06-11T04-00-00Z.db — sortable, and strictly validated so the
// download route can never be steered outside the backup dir (path traversal).
const NAME_RE = /^alphanote-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/;

export function backupName(date = new Date()) {
  return `alphanote-${date.toISOString().slice(0, 19).replace(/:/g, '-')}Z.db`;
}
export function isBackupName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}
export function backupDir() { return BACKUP_DIR; }

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(isBackupName)
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, bytes: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt); // newest first
}

// Names sort lexicographically = chronologically; return the ones beyond `keep`.
export function pruneList(names, keep = KEEP) {
  return [...names].sort().reverse().slice(keep);
}

export async function runBackupNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = backupName();
  await db.backup(path.join(BACKUP_DIR, name)); // online backup — consistent under WAL
  for (const old of pruneList(listBackups().map((b) => b.name))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* non-fatal */ }
  }
  return listBackups();
}

let timer = null;
let running = false;

export function startBackups() {
  if (running || process.env.BACKUPS_DISABLED === '1') return false;
  running = true;
  const tick = async () => {
    try {
      const newest = listBackups()[0];
      if (!newest || Date.now() - newest.createdAt >= DAY_MS - 60_000) {
        await runBackupNow();
        console.log(`[backup] snapshot written (${listBackups().length} kept)`);
      }
    } catch (e) {
      console.warn('[backup] failed:', e.message);
    }
    timer = setTimeout(tick, CHECK_MS);
    timer.unref?.(); // never keep the process alive just for backups
  };
  timer = setTimeout(tick, 30_000); // first check shortly after boot
  timer.unref?.();
  return true;
}
