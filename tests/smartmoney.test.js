import { describe, it, expect } from 'vitest';
import { parse13F, aggregateHoldings, diffHoldings } from '../server/lib/smartmoney.js';

// Minimal 13F information-table fixture (namespace-prefixed, like Berkshire's).
const XML = `<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass>
    <ns1:cusip>037833100</ns1:cusip><ns1:value>1000000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>5000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass>
    <ns1:cusip>037833100</ns1:cusip><ns1:value>500000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>2500</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>SPDR PUT</ns1:nameOfIssuer><ns1:titleOfClass>PUT</ns1:titleOfClass>
    <ns1:cusip>78462F103</ns1:cusip><ns1:value>9999999</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>100</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    <ns1:putCall>Put</ns1:putCall>
  </ns1:infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>SOME BOND</ns1:nameOfIssuer><ns1:titleOfClass>NOTE</ns1:titleOfClass>
    <ns1:cusip>111111111</ns1:cusip><ns1:value>7777</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>1</ns1:sshPrnamt><ns1:sshPrnamtType>PRN</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
  </ns1:infoTable>
</ns1:informationTable>`;

describe('parse13F', () => {
  it('parses every infoTable row, namespace-tolerant', () => {
    const rows = parse13F(XML);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ name: 'APPLE INC', cusip: '037833100', value: 1000000, shares: 5000, sharesType: 'SH' });
    expect(rows[2].putCall).toBe('Put');
  });
});

describe('aggregateHoldings', () => {
  it('sums sub-manager rows per CUSIP and excludes puts/calls + non-share rows', () => {
    const agg = aggregateHoldings(parse13F(XML));
    expect(agg).toHaveLength(1); // only AAPL survives (put + PRN bond dropped)
    expect(agg[0]).toMatchObject({ cusip: '037833100', value: 1500000, shares: 7500 });
  });
});

describe('diffHoldings', () => {
  const cur = [
    { cusip: 'A', name: 'AAA', value: 100, shares: 100 },
    { cusip: 'B', name: 'BBB', value: 50, shares: 200 },  // added
    { cusip: 'C', name: 'CCC', value: 30, shares: 10 },   // brand new
  ];
  const prior = [
    { cusip: 'A', name: 'AAA', value: 90, shares: 100 },   // flat
    { cusip: 'B', name: 'BBB', value: 40, shares: 100 },   // +100% shares
    { cusip: 'D', name: 'DDD', value: 70, shares: 70 },    // exited
  ];
  it('classifies new/add/trim/flat and lists exits', () => {
    const { holdings, exits } = diffHoldings(cur, prior);
    const by = Object.fromEntries(holdings.map((h) => [h.cusip, h.change]));
    expect(by.A.type).toBe('flat');
    expect(by.B).toEqual({ type: 'add', sharesPct: 100 });
    expect(by.C.type).toBe('new');
    expect(exits.map((e) => e.name)).toEqual(['DDD']);
  });
  it('marks everything new when there is no prior filing', () => {
    const { holdings } = diffHoldings(cur, []);
    expect(holdings.every((h) => h.change.type === 'new')).toBe(true);
  });
});
