import { describe, it, expect } from 'vitest';
import { applyEnv, trimEnv } from '../server/lib/env.js';

describe('applyEnv (the .env vs ambient precedence that broke PORT once)', () => {
  it('.env value beats a BLANK ambient var (the empty-ANTHROPIC_API_KEY quirk)', () => {
    const env = { ANTHROPIC_API_KEY: '', FRED_API_KEY: '   ' };
    applyEnv({ ANTHROPIC_API_KEY: 'from-file', FRED_API_KEY: 'also-file' }, env);
    expect(env.ANTHROPIC_API_KEY).toBe('from-file');
    expect(env.FRED_API_KEY).toBe('also-file');
  });
  it('a non-blank ambient var beats the file (PORT=8090 node …, platform env)', () => {
    const env = { PORT: '8090' };
    applyEnv({ PORT: '8080' }, env);
    expect(env.PORT).toBe('8090');
  });
  it('fills keys that are entirely unset and tolerates a missing parse result', () => {
    const env = {};
    applyEnv({ DB_PATH: '/data/app.db' }, env);
    expect(env.DB_PATH).toBe('/data/app.db');
    expect(() => applyEnv(null, env)).not.toThrow();
  });
});

describe('trimEnv (Render paste-box whitespace)', () => {
  it('trims the app keys but leaves unknown keys untouched', () => {
    const env = { FRED_API_KEY: 'abc123\n', PORT: ' 8080 ', SOMETHING_ELSE: ' keep me ' };
    trimEnv(env);
    expect(env.FRED_API_KEY).toBe('abc123');
    expect(env.PORT).toBe('8080');
    expect(env.SOMETHING_ELSE).toBe(' keep me ');
  });
});
