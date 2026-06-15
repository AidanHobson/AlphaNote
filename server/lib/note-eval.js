// Note quality eval — checks that a generated AI note obeys its structural
// contract and its rails. The notes assert facts and are supposed to label
// speculation, end with a Bottom line, and carry a not-advice disclaimer;
// nothing verified that until now. Pure + exported so it runs in CI against
// fixtures (no API key) and the server can flag live violations.

// Core sections that must always be present per note kind (a tolerant subset —
// conditional sections like Peer comparables / Bottlenecks aren't required).
const RULES = {
  research: ['Snapshot', 'What matters', 'Scenarios'],
  'outlook-theme': ['The theme', 'Bull case', 'Bear case'],
  'outlook-stock': ['Setup', 'The dream', 'The nightmare'],
  monopoly: ['Monopoly classification', 'Scenarios', 'Disruption risk'],
};

const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());

// A note that was cut off mid-generation won't end on terminal punctuation.
function looksTruncated(text) {
  const lastLine = String(text).trim().split('\n').filter((l) => l.trim()).pop() || '';
  return !/[.!?%)"'’”\d]\s*$/.test(lastLine.trim());
}

export function validateNote(kind, text) {
  const issues = [];
  const body = String(text || '');
  if (!body.trim()) return { ok: false, issues: ['empty note'] };

  const sections = RULES[kind];
  if (sections) {
    for (const sec of sections) if (!has(body, sec)) issues.push(`missing section: ${sec}`);
  }
  if (!/^\**\s*bottom line/im.test(body)) issues.push('missing Bottom line');
  if (!/not (investment|financial) advice/i.test(body)) issues.push('missing not-advice disclaimer');
  if (looksTruncated(body)) issues.push('appears truncated');

  return { ok: issues.length === 0, issues };
}

// Map a generated note object to the validator's kind key.
export function noteKind(note) {
  if (note?.kind === 'monopoly') return 'monopoly';
  if (note?.symbol != null && note?.kind == null) return 'research'; // research notes carry `symbol`
  if (note?.mode === 'stock') return 'outlook-stock';
  if (note?.mode === 'theme') return 'outlook-theme';
  return null;
}
