import { describe, it, expect } from 'vitest';
import { validateNote, noteKind } from '../server/lib/note-eval.js';

const goodResearch = `**Snapshot**
Apple is a hardware and services company.

**What matters**
- Services margin.

**Scenarios**
- Bull: services accelerate.

Bottom line: cautiously constructive, conviction 3/5. This is analysis, not investment advice.`;

describe('validateNote', () => {
  it('passes a well-formed note with all required sections, bottom line, and disclaimer', () => {
    expect(validateNote('research', goodResearch)).toEqual({ ok: true, issues: [] });
  });

  it('flags a missing section', () => {
    const r = validateNote('research', goodResearch.replace('**Scenarios**', '**Other**'));
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('missing section: Scenarios');
  });

  it('flags a missing Bottom line and missing disclaimer', () => {
    const r = validateNote('research', '**Snapshot**\nx\n**What matters**\ny\n**Scenarios**\nz\nThe end here.');
    expect(r.issues).toContain('missing Bottom line');
    expect(r.issues).toContain('missing not-advice disclaimer');
  });

  it('flags a note truncated mid-sentence', () => {
    const truncated = goodResearch.replace('not investment advice.', 'not investment advice but the company is trading at a multiple that');
    expect(validateNote('research', truncated).issues).toContain('appears truncated');
  });

  it('treats an unknown kind as a skip (no section requirements)', () => {
    expect(validateNote('mystery', 'Bottom line: fine. not investment advice.').ok).toBe(true);
  });

  it('rejects an empty note', () => {
    expect(validateNote('research', '')).toEqual({ ok: false, issues: ['empty note'] });
  });
});

describe('noteKind', () => {
  it('maps note objects to the validator kind', () => {
    expect(noteKind({ kind: 'monopoly' })).toBe('monopoly');
    expect(noteKind({ symbol: 'AAPL' })).toBe('research');
    expect(noteKind({ mode: 'stock' })).toBe('outlook-stock');
    expect(noteKind({ mode: 'theme' })).toBe('outlook-theme');
    expect(noteKind({})).toBeNull();
  });
});
