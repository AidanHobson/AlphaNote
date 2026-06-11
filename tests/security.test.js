import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../server/lib/valuation.js';

const HEX_CHUNK = '01234567';
const makeHex = (length) => HEX_CHUNK.repeat(Math.ceil(length / HEX_CHUNK.length)).slice(0, length);
const providerKeyPrefix = ['sk', 'test', 'EXAMPLE'].join('-');
const fakeProviderKey = `${providerKeyPrefix}${'0123456789'}_notreal`;

describe('redactSecrets', () => {
  // NB: all fixtures below are synthetic, key-SHAPED strings — never real keys.
  it('scrubs api_key/token query parameters', () => {
    const fakeKey = makeHex(32);
    const msg = `api.stlouisfed.org/fred/series/observations?series_id=GS10&api_key=${fakeKey}&file_type=json → 429`;
    const out = redactSecrets(msg);
    expect(out).not.toContain(fakeKey);
    expect(out).toContain('api_key=REDACTED');
    expect(out).toContain('429'); // keeps the useful status
  });

  it('scrubs sk- style provider keys', () => {
    expect(redactSecrets(`failed with key ${fakeProviderKey}`)).not.toContain(providerKeyPrefix);
  });

  it('scrubs long hex tokens even without a query param', () => {
    const fakeToken = makeHex(64);
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
    try {
      process.env.FRED_API_KEY = `${makeHex(32)}\n`;
      expect(isFredConfigured()).toBe(true);
      process.env.FRED_API_KEY = `  ${makeHex(32)} `;
      expect(isFredConfigured()).toBe(true);
      process.env.FRED_API_KEY = 'not-a-key';
      expect(isFredConfigured()).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env.FRED_API_KEY;
      } else {
        process.env.FRED_API_KEY = saved;
      }
    }
  });
});
