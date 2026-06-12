import { describe, it, expect } from 'vitest';
import { titleMatchesQuery, pickEvents, PREDICTION_QUERIES } from '../server/lib/predictions.js';

describe('titleMatchesQuery', () => {
  it('uses word boundaries for short queries', () => {
    expect(titleMatchesQuery('Fed decision in March?', 'Fed')).toBe(true);
    expect(titleMatchesQuery('Federation of traders meetup', 'Fed')).toBe(false);
  });
  it('substring-matches longer queries case-insensitively', () => {
    expect(titleMatchesQuery('US Recession declared by 2027?', 'recession')).toBe(true);
    expect(titleMatchesQuery('Inflation above 3% in June?', 'tariffs')).toBe(false);
  });
});

describe('pickEvents', () => {
  const eventsByQuery = [
    { query: 'Fed', events: [
      { title: 'Fed decision in March?', volume: '2000000', active: true, endDate: '2026-03-18T00:00:00Z',
        markets: [{ question: 'No change in March?', outcomes: '["Yes","No"]', outcomePrices: '["0.84","0.16"]', volume: '1500000' }] },
      { title: 'What will Powell say at the Fed presser?', volume: '10000', active: true, markets: [] }, // below min volume
      { title: 'Federation cup winner', volume: '900000', active: true, markets: [] },                   // title gate
    ] },
    { query: 'recession', events: [
      { title: 'US recession by 2027?', volume: '5000000', active: true, endDate: '2027-01-01T00:00:00Z',
        markets: [{ question: 'US recession by 2027?', outcomes: '["Yes","No"]', outcomePrices: '["0.12","0.88"]', volume: '5000000' }] },
      { title: 'US recession by 2027?', volume: '5000000', active: true, markets: [] },                  // dupe title
      { title: 'Recession themed party', volume: '100', active: false, markets: [] },                    // inactive
    ] },
  ];
  const events = pickEvents(eventsByQuery, { notBefore: '2026-01-01' });

  it('filters by title relevance, volume, active flag, and dedupes; sorts by volume', () => {
    expect(events.map((e) => e.title)).toEqual(['US recession by 2027?', 'Fed decision in March?']);
  });
  it('drops events whose resolution date has already passed', () => {
    const fresh = pickEvents(eventsByQuery, { notBefore: '2026-06-12' });
    expect(fresh.map((e) => e.title)).toEqual(['US recession by 2027?']); // March Fed event expired
  });
  it('extracts implied odds from the leading market', () => {
    expect(events[1].topMarket).toMatchObject({ question: 'No change in March?', pct: 84 });
    expect(events[0].topMarket.pct).toBe(12);
    expect(events[1].endDate).toBe('2026-03-18');
  });
  it('standing queries cover the macro basics', () => {
    for (const q of ['Fed', 'recession', 'inflation']) expect(PREDICTION_QUERIES).toContain(q);
  });
});
