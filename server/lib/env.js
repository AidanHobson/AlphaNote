import dotenv from 'dotenv';

// Load this app's .env and let it OVERRIDE ambient environment variables.
// Some shells / CI / parent processes pre-export an EMPTY `ANTHROPIC_API_KEY`
// (or similar); without `override`, dotenv keeps that empty value and ignores
// our .env. This module must be imported FIRST (before any module that reads
// process.env at load time), because ESM evaluates imports before statements.
dotenv.config({ override: true });
