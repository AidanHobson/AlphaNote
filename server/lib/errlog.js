// In-app error log — a small ring buffer of recent server-side errors, surfaced
// on the Admin page. Zero external services: enough visibility to answer "did
// anything break in prod today?" without shipping logs anywhere. Messages pass
// through redactSecrets so a credential can never end up in the buffer.

import { redactSecrets } from './valuation.js';

const MAX = 100;
const ring = [];

export function recordError(scope, err, extra = {}) {
  const msg = err instanceof Error ? err.message : String(err);
  ring.push({
    t: Date.now(),
    scope: String(scope || 'server').slice(0, 80),
    message: redactSecrets(msg).slice(0, 500),
    path: extra.path ? String(extra.path).slice(0, 200) : undefined,
    status: extra.status,
  });
  if (ring.length > MAX) ring.shift();
}

export function listErrors() {
  return [...ring].reverse(); // newest first
}
