import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../server/lib/valuation.js';

describe('redactSecrets', () => {
  // NB: all fixtures below are synthetic, key-SHAPED strings — never real keys.
  it('scrubs api_key/token query parameters', () => {
    const fakeKey = 'synthetic-test-fixture'; // 32-char hex shape (not a real key)
    const msg = `api.stlouisfed.org/fred/series/observations?series_id=GS10&api_key=${fakeKey}&file_type=json → 429`;
    const out = redactSecrets(msg);
    expect(out).not.toContain(fakeKey);
    expect(out).toContain('api_key=REDACTED');
    expect(out).toContain('429'); // keeps the useful status
  });

  it('scrubs sk- style provider keys', () => {
    expect(redactSecrets('failed with key synthetic-test-fixture')).not.toMatch(/sk-test-EXAMPLE/);
  });

  it('scrubs long hex tokens even without a query param', () => {
    const fakeToken = 'synthetic-test-fixture'.repeat(4); // 64-char hex shape (not a real key)
    expect(redactSecrets(`token ${fakeToken} here`)).toContain('REDACTED');
  });

  it('leaves ordinary messages untouched and tolerates non-strings', () => {
    expect(redactSecrets('Data temporarily unavailable')).toBe('Data temporarily unavailable');
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe('isFredConfigured (whitespace-tolerant key check)', () => {
  it('accepts a valid key even with a pasted trailing newline/space', async () => {
    const { isFredConfigured } = await import('../server/lib/fred.js');
    const saved = process.env.FRED_API_KEY;
    process.env.FRED_API_KEY = 'synthetic-test-fixture\n';
    expect(isFredConfigured()).toBe(true);
    process.env.FRED_API_KEY = '  synthetic-test-fixture ';
    expect(isFredConfigured()).toBe(true);
    process.env.FRED_API_KEY = 'not-a-key';
    expect(isFredConfigured()).toBe(false);
    process.env.FRED_API_KEY = saved;
  });
});
