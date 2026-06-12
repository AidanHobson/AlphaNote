import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load this app's .env with explicit precedence. Two launch quirks to survive:
// - Some shells / parent processes pre-export an EMPTY `ANTHROPIC_API_KEY`
//   (or similar) — a .env value must beat a blank ambient var.
// - An explicitly-set, NON-blank ambient var (e.g. `PORT=8090 node …`, or a
//   platform like Render) must beat the file (twelve-factor: real env > file).
// dotenv's all-or-nothing `override` can't express that, so parse and apply
// per key. This module must be imported FIRST (before any module that reads
// process.env at load time), because ESM evaluates imports first.

export const TRIMMED_KEYS = [
  'FINNHUB_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'SEC_API_KEY',
  'NINJAS_API_KEY', 'FRED_API_KEY', 'EODHD_API_KEY', 'SEC_USER_AGENT',
  'ADMIN_USERNAMES', 'DB_PATH', 'TRUST_PROXY', 'PORT',
];

// Apply parsed .env entries onto a target env with the precedence above:
// the file wins over a BLANK ambient value, a non-blank ambient value wins
// over the file. Pure — exported for tests.
export function applyEnv(parsed, env = process.env) {
  for (const [k, v] of Object.entries(parsed || {})) {
    const ambient = env[k];
    if (ambient == null || String(ambient).trim() === '') env[k] = v;
  }
  return env;
}

// Defensively trim the app's env values: dashboard paste boxes (e.g. Render's
// multiline inputs) love to smuggle in a trailing newline/space, which silently
// breaks exact-shape checks like the FRED key regex and HTTP header values.
export function trimEnv(env = process.env) {
  for (const k of TRIMMED_KEYS) {
    if (typeof env[k] === 'string') env[k] = env[k].trim();
  }
  return env;
}

// Resolve .env relative to the repo root (two levels up from server/lib), not
// process.cwd() — the server must find its keys however it is launched.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  applyEnv(dotenv.parse(fs.readFileSync(path.join(repoRoot, '.env'))));
} catch { /* no .env (e.g. production platforms) — ambient env only */ }
trimEnv();
