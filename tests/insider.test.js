import { describe, it, expect } from 'vitest';
import { parseForm4, roleOf, ninjasRole } from '../server/lib/insider.js';

const FORM4 = `<SEC-HEADER>
FILED AS OF DATE:		20260605
</SEC-HEADER>
<XML>
<ownershipDocument>
  <issuer>
    <issuerName>Test Corp</issuerName>
    <issuerTradingSymbol>TST</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector>
      <isOfficer>0</isOfficer>
      <isTenPercentOwner>0</isTenPercentOwner>
      <officerTitle></officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>50.5</value></transactionPricePerShare>
      </transactionAmounts>
      <transactionDate><value>2026-06-03</value></transactionDate>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>500</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
      </transactionAmounts>
      <transactionDate><value>2026-06-03</value></transactionDate>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">Sale pursuant to a Rule 10b5-1 trading plan.</footnote>
  </footnotes>
</ownershipDocument>
</XML>`;

describe('parseForm4', () => {
  it('extracts issuer, owner, role, plan, and only open-market P/S transactions', () => {
    const f = parseForm4(FORM4);
    expect(f.symbol).toBe('TST');
    expect(f.company).toBe('Test Corp');
    expect(f.insider).toBe('DOE JANE');
    expect(f.title).toBe('Director');
    expect(f.isDirector).toBe(true);
    expect(f.isOfficer).toBe(false);
    expect(f.plan).toBe('10b5-1');
    expect(f.filingDate).toBe('2026-06-05');
    expect(f.txns).toHaveLength(1); // the grant (code A) is excluded
    expect(f.txns[0]).toMatchObject({ code: 'S', side: 'Sell', shares: 1000, price: 50.5, value: 50500, transactionDate: '2026-06-03' });
  });

  it('returns null when there is no ownership document or no P/S trades', () => {
    expect(parseForm4('not a filing')).toBeNull();
    expect(parseForm4(FORM4.replace('<transactionCode>S</transactionCode>', '<transactionCode>M</transactionCode>'))).toBeNull();
  });
});

describe('roleOf (sec-api relationship → label)', () => {
  it('builds a combined role string', () => {
    expect(roleOf({ isDirector: true })).toBe('Director');
    expect(roleOf({ isOfficer: true, officerTitle: 'CFO' })).toBe('CFO');
    expect(roleOf({ isOfficer: true })).toBe('Officer');
    expect(roleOf({ isTenPercentOwner: true })).toBe('10% Owner');
    expect(roleOf({ isDirector: true, isOfficer: true, officerTitle: 'CEO', isTenPercentOwner: true })).toBe('Director, CEO, 10% Owner');
    expect(roleOf({})).toBe('Other');
  });
});

describe('ninjasRole (position string → role booleans)', () => {
  it('infers director/officer/10% from the position text', () => {
    expect(ninjasRole('Director')).toMatchObject({ isDirector: true, isOfficer: false, isTenPercent: false });
    expect(ninjasRole('Chief Financial Officer')).toMatchObject({ isOfficer: true, isDirector: false });
    expect(ninjasRole('President and CEO')).toMatchObject({ isOfficer: true });
    expect(ninjasRole('10% Owner')).toMatchObject({ isTenPercent: true, isOfficer: false });
    expect(ninjasRole('Director, 10% Owner')).toMatchObject({ isDirector: true, isTenPercent: true });
  });
});
