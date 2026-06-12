import { describe, it, expect } from 'vitest';
import { parseMdTable } from '../client/src/lib/mdtable.ts';

const TABLE = [
  '| Scenario | Probability | Key assumption | Implied move (derived) |',
  '|----------|-------------|----------------|------------------------|',
  '| Bull | 30% | Utilities accelerate 900 MHz deals | +40-70% on derived P/S |',
  '| Base | 45% | Steady contracted growth | roughly flat to +20% |',
  '| Bear | 25% | Spectrum monetisation stalls | -30-50% |',
];

describe('parseMdTable', () => {
  it('parses header, separator, and rows with trimmed cells', () => {
    const t = parseMdTable(TABLE);
    expect(t.header).toEqual(['Scenario', 'Probability', 'Key assumption', 'Implied move (derived)']);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0][0]).toBe('Bull');
    expect(t.rows[2][3]).toBe('-30-50%');
  });
  it('returns null for malformed blocks (no separator, too short, empty body)', () => {
    expect(parseMdTable(['| a | b |', '| 1 | 2 |', '| 3 | 4 |'])).toBeNull(); // no separator row
    expect(parseMdTable(['| a | b |', '|---|---|'])).toBeNull();              // no body
    expect(parseMdTable(['just text'])).toBeNull();
  });
});
