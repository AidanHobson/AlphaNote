// Minimal markdown-table parsing for AI notes: a header row, a |---| separator
// row, then body rows. Anything malformed returns null and renders as plain
// text. Cells stay strings — the renderer React-escapes them (XSS-safe).

export interface MdTable { header: string[]; rows: string[][] }

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const isSeparator = (line: string) => /^\|?\s*:?-{2,}.*\|/.test(line.trim()) && /^[\s|:\-]+$/.test(line.trim());

export function parseMdTable(lines: string[]): MdTable | null {
  if (lines.length < 3 || !isSeparator(lines[1])) return null;
  const header = splitRow(lines[0]);
  if (header.length < 2) return null;
  const rows = lines.slice(2).map(splitRow).filter((r) => r.some((c) => c.length));
  if (!rows.length) return null;
  return { header, rows };
}
