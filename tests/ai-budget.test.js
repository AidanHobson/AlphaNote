import { describe, it, expect } from 'vitest';
import { checkAndConsume } from '../server/lib/ai-budget.js';

describe('ai-budget (per-user daily cap)', () => {
  it('consumes the budget and blocks past the cap', () => {
    const uid = Math.floor(Math.random() * 1e9);
    const cap = 3;
    expect(checkAndConsume(uid, { cap }).ok).toBe(true);
    expect(checkAndConsume(uid, { cap }).ok).toBe(true);
    const third = checkAndConsume(uid, { cap });
    expect(third).toMatchObject({ ok: true, remaining: 0 });
    expect(checkAndConsume(uid, { cap }).ok).toBe(false); // 4th over cap
  });
  it('scopes the budget by UTC day', () => {
    const uid = Math.floor(Math.random() * 1e9);
    const day1 = Date.parse('2026-06-12T10:00:00Z');
    const day2 = Date.parse('2026-06-13T10:00:00Z');
    expect(checkAndConsume(uid, { cap: 1, now: day1 }).ok).toBe(true);
    expect(checkAndConsume(uid, { cap: 1, now: day1 }).ok).toBe(false);
    expect(checkAndConsume(uid, { cap: 1, now: day2 }).ok).toBe(true); // fresh day
  });
  it('does not throttle unauthenticated callers (handled elsewhere)', () => {
    expect(checkAndConsume(undefined, { cap: 0 }).ok).toBe(true);
  });
});
