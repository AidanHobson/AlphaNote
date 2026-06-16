import { describe, it, expect } from 'vitest';
import { zipRecent, pickFilings, htmlToText, extractSection } from '../server/lib/filings.js';

describe('zipRecent', () => {
  it('zips the SEC parallel-array filing table into objects, skipping rows with no document', () => {
    const recent = {
      form: ['10-Q', '8-K', '4'],
      filingDate: ['2026-05-01', '2026-04-30', '2026-04-29'],
      reportDate: ['2026-03-28', '', ''],
      accessionNumber: ['0000320193-26-000013', '0000320193-26-000011', '0000320193-26-000010'],
      primaryDocument: ['aapl-20260328.htm', 'aapl-20260430.htm', ''],
      items: ['', '2.02,9.01', ''],
    };
    const out = zipRecent(recent);
    expect(out).toHaveLength(2); // the Form 4 row has no primaryDocument → dropped
    expect(out[0]).toMatchObject({ form: '10-Q', accession: '0000320193-26-000013' });
    expect(out[1].items).toEqual(['2.02', '9.01']);
  });
  it('returns [] for an empty table', () => {
    expect(zipRecent(null)).toEqual([]);
    expect(zipRecent({})).toEqual([]);
  });
});

describe('pickFilings', () => {
  const filings = [
    { form: '8-K', filingDate: '2026-06-01' },
    { form: '10-Q', filingDate: '2026-05-01' },
    { form: '8-K', filingDate: '2026-04-30' },
    { form: '10-K', filingDate: '2025-11-01' },
    { form: '8-K', filingDate: '2026-02-01' },
    { form: '8-K', filingDate: '2026-01-01' },
  ];
  it('takes the most-recent periodic report and up to maxEvents recent 8-Ks', () => {
    const { periodic, events } = pickFilings(filings, { maxEvents: 3 });
    expect(periodic.form).toBe('10-Q'); // the 10-Q is newer than the 10-K
    expect(events.map((e) => e.filingDate)).toEqual(['2026-06-01', '2026-04-30', '2026-02-01']);
  });
  it('handles amendments and a missing periodic gracefully', () => {
    expect(pickFilings([{ form: '8-K', filingDate: '2026-06-01' }]).periodic).toBeNull();
    expect(pickFilings([{ form: '10-K/A', filingDate: '2026-06-01' }]).periodic.form).toBe('10-K/A');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Net&nbsp;income rose&#160;<b>12%</b> &amp; margins held.</p>'))
      .toBe('Net income rose 12% & margins held.');
  });
  it('drops script/style content entirely', () => {
    expect(htmlToText('<style>.x{}</style>Hello<script>alert(1)</script> world')).toBe('Hello world');
  });
  it('is safe against split/nested-bracket injection (no "<script" survives a decode)', () => {
    // &#60; decodes to "<" only AFTER tag-stripping, then the final pass removes it.
    const out = htmlToText('clean &#60;script&#62;evil&#60;/script&#62; text');
    expect(out).not.toContain('<script');
    expect(out).not.toMatch(/[<>]/);
  });
});

describe('extractSection', () => {
  const doc = [
    'TABLE OF CONTENTS',
    'Item 1A. Risk Factors .......... 14',
    "Item 2. Management's Discussion and Analysis .......... 20",
    'PART I FINANCIAL INFORMATION',
    "Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations. ",
    'Revenue grew on strong demand; gross margin expanded year over year as the mix improved and input costs eased across the period under review.',
    'Item 1A. Risk Factors. Our business is subject to numerous risks including supply concentration, regulatory change, and demand volatility that could materially affect results. We depend on a limited number of suppliers and contract manufacturers, and any disruption to those relationships, adverse macroeconomic conditions, or new trade restrictions could harm our operating results, financial condition, and the price of our common stock in ways we may not be able to foresee or mitigate in a timely manner.',
  ].join('\n');

  it('extracts the BODY section, not the table-of-contents mention (last header wins)', () => {
    const mdna = extractSection(doc, [/item\s*2\b[.:)\s-]*management[\s\S]{0,8}discussion and analysis/gi]);
    expect(mdna).toContain('Revenue grew on strong demand');
    expect(mdna).not.toContain('TABLE OF CONTENTS');
  });
  it('extracts risk factors and returns null when a header is absent', () => {
    const risk = extractSection(doc, [/item\s*1a\b[.:)\s-]*risk factors/gi]);
    expect(risk).toContain('supply concentration');
    expect(extractSection(doc, [/cybersecurity disclosures/gi])).toBeNull();
  });
  it('returns null for empty input or an implausibly short slice', () => {
    expect(extractSection('', [/risk factors/gi])).toBeNull();
    expect(extractSection('Risk Factors', [/risk factors/gi], { chars: 2000 })).toBeNull();
  });
});
