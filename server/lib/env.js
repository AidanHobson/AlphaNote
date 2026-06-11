import dotenv from 'dotenv';

// Load this app's .env and let it OVERRIDE ambient environment variables.
// Some shells / CI / parent processes pre-export an EMPTY `ANTHROPIC_API_KEY`
// (or similar); without `override`, dotenv keeps that empty value and ignores
// our .env. This module must be imported FIRST (before any module that reads
// process.env at load time), because ESM evaluates imports before statements.
dotenv.config({ override: true });

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
