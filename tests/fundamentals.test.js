import { describe, it, expect } from 'vitest';
import { computeTTM, quarterlyPoints, latestInstant, normalizeIssuerName } from '../server/lib/fundamentals.js';

describe('computeTTM', () => {
  // Apple-style fiscal year: FY ends late September, no fiscal-Q4 10-Q filed.
  const annual = [{ fy: 2025, val: 400, end: '2025-09-27' }];
  const quarters = [
    { start: '2024-09-29', end: '2024-12-28', val: 120 }, // year-ago Q1
    { start: '2024-12-29', end: '2025-03-29', val: 90 },  // year-ago Q2
    { start: '2025-09-28', end: '2025-12-27', val: 140 }, // post-FY Q1
    { start: '2025-12-28', end: '2026-03-28', val: 110 }, // post-FY Q2
  ];
  it('computes FY + post-FY quarters − year-ago counterparts', () => {
    const t = computeTTM(annual, quarters);
    expect(t.value).toBe(400 + (140 + 110) - (120 + 90)); // 440
    expect(t.through).toBe('2026-03-28');
    expect(t.quartersBeyondFY).toBe(2);
  });
  it('does NOT naively sum the last 4 points across a missing fiscal Q4', () => {
    // naive sum of the 4 points = 460 ≠ correct 440
    expect(computeTTM(annual, quarters).value).not.toBe(460);
  });
  it('returns FY itself when no quarters extend beyond it', () => {
    const t = computeTTM(annual, quarters.slice(0, 2));
    expect(t.value).toBe(400);
    expect(t.quartersBeyondFY).toBe(0);
  });
  it('returns null (no TTM) when a year-ago counterpart is missing', () => {
    expect(computeTTM(annual, quarters.slice(2))).toBeNull(); // post-FY only, no counterparts
  });
  it('returns null without an FY anchor', () => {
    expect(computeTTM([], quarters)).toBeNull();
  });
});

describe('quarterlyPoints / latestInstant', () => {
  const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [
    { start: '2025-01-01', end: '2025-03-31', val: 10, form: '10-Q' },
    { start: '2025-01-01', end: '2025-03-31', val: 10, form: '10-Q/A' }, // dupe end → dedupe
    { start: '2024-01-01', end: '2025-03-31', val: 99, form: '10-K' },   // ~15 months → not a quarter
  ] } }, Assets: { units: { USD: [
    { end: '2025-03-31', val: 500, form: '10-Q' },
    { end: '2025-06-30', val: 510, form: '10-Q' },
    { start: '2025-01-01', end: '2025-12-31', val: 1, form: '10-K' },    // duration → not an instant
  ] } } } } };
  it('keeps only ~3-month windows, deduped by end', () => {
    const qs = quarterlyPoints(facts, ['Revenues']);
    expect(qs).toHaveLength(1);
    expect(qs[0].val).toBe(10);
  });
  it('latestInstant picks the freshest point without a start date', () => {
    expect(latestInstant(facts, ['Assets'])).toEqual({ end: '2025-06-30', val: 510 });
  });
});

describe('normalizeIssuerName', () => {
  it('strips suffixes and punctuation so filings match the ticker map', () => {
    expect(normalizeIssuerName('APPLE INC')).toBe(normalizeIssuerName('Apple Inc.'));
    expect(normalizeIssuerName('COCA COLA CO')).toBe(normalizeIssuerName('Coca-Cola Company'));
    expect(normalizeIssuerName('META PLATFORMS INC CL A')).toBe(normalizeIssuerName('Meta Platforms, Inc.'));
  });
});
