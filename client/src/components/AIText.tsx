import { Fragment } from 'react';
import { splitTickerSegments } from '../lib/tickers';
import { parseMdTable } from '../lib/mdtable';

// Renders the AI's plain-text reply into paragraphs, bullets, section headers,
// and a highlighted "Bottom line:" / "Watch:" callout. React escapes all text
// → XSS-safe. When `onTicker` is provided, parenthesised tickers — "(HEI)",
// "(TER:NASDAQ)" — become clickable chips.

function renderTickers(s: string, onTicker: ((symbol: string) => void) | undefined, keyPrefix: string) {
  if (!onTicker) return s;
  const segs = splitTickerSegments(s);
  if (segs.length === 1 && segs[0].type === 'text') return s;
  return segs.map((seg, j) =>
    seg.type === 'ticker'
      ? (
        <Fragment key={`${keyPrefix}-${j}`}>
          (<button type="button" className="ticker-link" title={`Analyse ${seg.symbol}`}
            onClick={() => onTicker(seg.symbol)}>{seg.symbol}</button>{seg.inner.slice(seg.symbol.length)})
        </Fragment>
      )
      : <Fragment key={`${keyPrefix}-${j}`}>{seg.value}</Fragment>
  );
}

function inline(s: string, onTicker?: (symbol: string) => void) {
  // Support **bold** only; everything else is plain text.
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{renderTickers(p.slice(2, -2), onTicker, `${i}b`)}</strong>
      : <Fragment key={i}>{renderTickers(p, onTicker, String(i))}</Fragment>
  );
}

export default function AIText({ text, onTicker }: { text: string; onTicker?: (symbol: string) => void }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  let tableLines: string[] = [];

  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`ul-${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b, onTicker)}</li>)}</ul>);
      bullets = [];
    }
    if (tableLines.length) {
      const table = parseMdTable(tableLines);
      if (table) {
        out.push(
          <table className="mtable ai-mdtable" key={`t-${out.length}`}>
            <thead><tr>{table.header.map((h, i) => <th key={i}>{inline(h, onTicker)}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} style={{ cursor: 'default' }}>{r.map((c, j) => <td key={j}>{inline(c, onTicker)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        );
      } else {
        // Malformed table → render the raw lines as paragraphs rather than losing them.
        tableLines.forEach((l) => out.push(<p key={`p-${out.length}`}>{inline(l, onTicker)}</p>));
      }
      tableLines = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('|')) {
      tableLines.push(line);
      continue;
    }
    if (tableLines.length) flush();
    // Drop horizontal-rule separators some models emit between sections.
    if (/^[-—_*]{3,}$/.test(line)) continue;
    // A line that is entirely **Bold** is a section header (research notes).
    const header = line.match(/^\*\*([^*]+)\*\*$/);
    if (header) {
      flush();
      out.push(<h4 className="ai-section" key={`h-${out.length}`}>{renderTickers(header[1], onTicker, `h${out.length}`)}</h4>);
      continue;
    }
    // Tolerate a bold-wrapped label: "Bottom line:", "**Bottom line:**", "**Bottom line**:".
    const callout = line.match(/^(?:\*\*)?(bottom line|watch|key takeaway)\s*:?\s*(?:\*\*)?\s*:?\s*(.*)$/i);
    if (callout) {
      flush();
      out.push(
        <div className="ai-callout" key={`c-${out.length}`}>
          <strong>{callout[1].replace(/\b\w/g, (c) => c.toUpperCase())}:</strong> {inline(callout[2], onTicker)}
        </div>
      );
    } else if (/^[-•▹]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•▹]\s+/, ''));
    } else {
      flush();
      out.push(<p key={`p-${out.length}`}>{inline(line, onTicker)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}
