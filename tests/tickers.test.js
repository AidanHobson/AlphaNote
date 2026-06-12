import { describe, it, expect } from 'vitest';
import { splitTickerSegments } from '../client/src/lib/tickers.ts';

const tickersIn = (text) => splitTickerSegments(text).filter((s) => s.type === 'ticker').map((s) => s.symbol);

describe('splitTickerSegments', () => {
  it('detects the formats the prompts emit', () => {
    expect(tickersIn('Teradyne (TER:NASDAQ) owns Universal Robots')).toEqual(['TER']);
    expect(tickersIn('Coherent (COHR, NYSE) and HEICO (HEI)')).toEqual(['COHR', 'HEI']);
    expect(tickersIn('Moog (MOG.A) class A')).toEqual(['MOG.A']);
  });
  it('never matches bare uppercase words, and blacklists finance acronyms in parens', () => {
    expect(tickersIn('THE CEO SAID TAM IS HUGE')).toEqual([]);
    expect(tickersIn('a $90bn (TAM) growing at 20% (CAGR) per the (CEO)')).toEqual([]);
    expect(tickersIn('free cash flow (FCF) and (EBITDA) margins')).toEqual([]);
  });
  it('an exchange suffix overrides the blacklist', () => {
    expect(tickersIn('Global Payments (EV:NYSE) is a real listing')).toEqual(['EV']);
  });
  it('preserves surrounding text exactly', () => {
    const segs = splitTickerSegments('Buy side likes Cognex (CGNX) here.');
    expect(segs.map((s) => (s.type === 'text' ? s.value : `(${s.inner})`)).join('')).toBe('Buy side likes Cognex (CGNX) here.');
  });
  it('returns the whole string as one text segment when nothing matches', () => {
    expect(splitTickerSegments('no tickers here')).toEqual([{ type: 'text', value: 'no tickers here' }]);
  });
});
