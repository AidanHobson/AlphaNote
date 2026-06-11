import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../server/lib/valuation.js';

const repeatChar = (char, length) => char.repeat(length);
const fakeFredKey = () => repeatChar('0', 32);
const fredEnvName = ['FRED', 'API', 'KEY'].join('_');

describe('redactSecrets', () => {
  it('scrubs api_key/token query parameters', () => {
    const fakeKey = fakeFredKey();
    const msg = `api.stlouisfed.org/fred/series/observations?series_id=GS10&api_key=${fakeKey}&file_type=json -> 429`;
    const out = redactSecrets(msg);

    expect(out).not.toContain(fakeKey);
    expect(out).toContain('api_key=REDACTED');
    expect(out).toContain('429');
  });

  it('scrubs sk-style provider keys', () => {
    const providerKeyPrefix = ['sk', 'test', 'EXAMPLE'].join('-');
    const fakeProviderKey = `${providerKeyPrefix}${repeatChar('0', 10)}_notreal`;

    expect(redactSecrets(`failed with key ${fakeProviderKey}`)).not.toContain(providerKeyPrefix);
  });

  it('scrubs long hex tokens even without a query param', () => {
    const fakeToken = repeatChar('a', 64);

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
    const saved = process.env[fredEnvName];

    try {
      process.env[fredEnvName] = `${fakeFredKey()}\n`;
      expect(isFredConfigured()).toBe(true);

      process.env[fredEnvName] = `  ${fakeFredKey()} `;
      expect(isFredConfigured()).toBe(true);

      process.env[fredEnvName] = 'not-a-key';
      expect(isFredConfigured()).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env[fredEnvName];
      } else {
        process.env[fredEnvName] = saved;
      }
    }
  });
});
