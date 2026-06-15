import { describe, it, expect, beforeEach } from 'vitest';
import { recordOutcome, track, listSourceHealth } from '../server/lib/source-health.js';

// The module holds process-global state; use unique source names per test.
describe('source-health', () => {
  it('classifies a healthy source as ok and counts successes', () => {
    const n = `ok-${Math.random()}`;
    recordOutcome(n, true);
    recordOutcome(n, true);
    const s = listSourceHealth().find((x) => x.name === n);
    expect(s.status).toBe('ok');
    expect(s.successes).toBe(2);
    expect(s.recentFailRate).toBe(0);
  });
  it('flags a source as failing when the recent window is all failures', () => {
    const n = `fail-${Math.random()}`;
    for (let i = 0; i < 4; i++) recordOutcome(n, false, 'IP blocked');
    const s = listSourceHealth().find((x) => x.name === n);
    expect(s.status).toBe('failing');
    expect(s.lastError).toBe('IP blocked');
    expect(s.recentFailRate).toBe(1);
  });
  it('marks a source degraded when only some recent calls failed', () => {
    const n = `deg-${Math.random()}`;
    recordOutcome(n, true); recordOutcome(n, false, 'timeout'); recordOutcome(n, true);
    expect(listSourceHealth().find((x) => x.name === n).status).toBe('degraded');
  });
  it('track() records throw and empty-result as failures', async () => {
    const a = `t-throw-${Math.random()}`;
    await expect(track(a, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(listSourceHealth().find((x) => x.name === a).failures).toBe(1);

    const b = `t-empty-${Math.random()}`;
    const out = await track(b, async () => [], { emptyIsFailure: true });
    expect(out).toEqual([]);
    expect(listSourceHealth().find((x) => x.name === b).lastError).toBe('empty result');
  });
});
