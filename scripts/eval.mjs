#!/usr/bin/env node
// Note quality eval harness. Generates real notes for a set of golden inputs
// and validates each against its structural/rail contract. Requires an AI key
// (skips with a clear message otherwise, so CI without keys is a no-op). Run:
//   npm run eval
import '../server/lib/env.js';
import { isProviderConfigured } from '../server/lib/ai-provider.js';
import { generateResearchNote } from '../server/lib/research.js';
import { generateOutlook } from '../server/lib/outlook.js';
import { generateMonopolyNote } from '../server/lib/monopoly.js';
import { validateNote, noteKind } from '../server/lib/note-eval.js';

if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
  console.log('eval: no AI provider key configured — skipping live generation.');
  process.exit(0);
}

const GOLDEN = [
  { label: 'research AAPL', run: () => generateResearchNote('AAPL', { force: true }) },
  { label: 'outlook theme Robotics', run: () => generateOutlook('Robotics', { force: true }) },
  { label: 'outlook stock NVDA', run: () => generateOutlook('NVDA', { force: true }) },
  { label: 'monopoly ASML', run: () => generateMonopolyNote('ASML', { force: true }) },
];

let failed = 0;
for (const g of GOLDEN) {
  try {
    const note = await g.run();
    const { ok, issues } = validateNote(noteKind(note), note.text);
    console.log(`${ok ? '✓' : '✗'} ${g.label} (${note.provider}, ${note.text.length} chars)${ok ? '' : ' — ' + issues.join('; ')}`);
    if (!ok) failed += 1;
  } catch (e) {
    console.log(`✗ ${g.label} — generation error: ${e.message}`);
    failed += 1;
  }
}
console.log(`\neval: ${GOLDEN.length - failed}/${GOLDEN.length} passed`);
process.exit(failed ? 1 : 0);
