// In-app error log — recent server-side errors, surfaced on the Admin page.
// Persisted to SQLite (last ~500) so the log survives the restart that often
// accompanies whatever went wrong. Messages pass through redactSecrets so a
// credential can never end up in the log. Logging must never throw.

import { redactSecrets } from './valuation.js';
import db from './db.js';

const KEEP = 500;
const LIST = 100;

const qInsert = db.prepare('INSERT INTO error_log (t, scope, message, path, status) VALUES (?, ?, ?, ?, ?)');
const qPrune = db.prepare(`DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ${KEEP})`);
const qList = db.prepare(`SELECT t, scope, message, path, status FROM error_log ORDER BY id DESC LIMIT ${LIST}`);

let writes = 0;

export function recordError(scope, err, extra = {}) {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    qInsert.run(
      Date.now(),
      String(scope || 'server').slice(0, 80),
      redactSecrets(msg).slice(0, 500),
      extra.path ? String(extra.path).slice(0, 200) : null,
      Number.isFinite(extra.status) ? extra.status : null,
    );
    if (++writes % 50 === 0) qPrune.run();
  } catch { /* the error log must never be a source of errors */ }
}

export function listErrors() {
  try {
    // null → undefined so the JSON shape matches the previous ring buffer.
    return qList.all().map((r) => ({ ...r, path: r.path ?? undefined, status: r.status ?? undefined }));
  } catch {
    return [];
  }
}
