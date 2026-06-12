import { Fragment } from 'react';
import { splitTickerSegments } from '../lib/tickers';

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

  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`ul-${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b, onTicker)}</li>)}</ul>);
      bullets = [];
    }
  };

  for (const line of lines) {
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
