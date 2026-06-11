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
// per key. Resolve .env relative to the repo root (two levels up from
// server/lib), not process.cwd() — the server must find its keys however it
// is launched. This module must be imported FIRST (before any module that
// reads process.env at load time), because ESM evaluates imports first.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const parsed = dotenv.parse(fs.readFileSync(path.join(repoRoot, '.env')));
  for (const [k, v] of Object.entries(parsed)) {
    const ambient = process.env[k];
    if (ambient == null || String(ambient).trim() === '') process.env[k] = v;
  }
} catch { /* no .env (e.g. production platforms) — ambient env only */ }

// Defensively trim this app's env values: dashboard paste boxes (e.g. Render's
// multiline inputs) love to smuggle in a trailing newline/space, which silently
// breaks exact-shape checks like the FRED key regex and HTTP header values.
for (const k of [
  'FINNHUB_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'SEC_API_KEY',
  'NINJAS_API_KEY', 'FRED_API_KEY', 'EODHD_API_KEY', 'SEC_USER_AGENT',
  'ADMIN_USERNAMES', 'DB_PATH', 'TRUST_PROXY', 'PORT',
]) {
  if (typeof process.env[k] === 'string') process.env[k] = process.env[k].trim();
}
