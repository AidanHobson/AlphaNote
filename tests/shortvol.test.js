import { describe, it, expect } from 'vitest';
import { parseShortVolume } from '../server/lib/shortvol.js';

const FILE = `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
20260611|AAPL|7012953.595431|44676|13382061.323003|B,Q,N
20260611|GME|900000|0|1000000|B,Q,N
20260611|BAD|notanumber|0|1000|B,Q,N
20260611|ZERO|5|0|0|B,Q,N
`;

describe('parseShortVolume', () => {
  const map = parseShortVolume(FILE);

  it('computes the short share of consolidated volume with an ISO date', () => {
    expect(map.get('AAPL')).toMatchObject({ ratio: 52.4, date: '2026-06-11' });
    expect(map.get('GME').ratio).toBe(90);
  });
  it('skips the header and malformed/zero-volume rows', () => {
    expect(map.has('Symbol')).toBe(false);
    expect(map.has('BAD')).toBe(false);
    expect(map.has('ZERO')).toBe(false);
  });
});
