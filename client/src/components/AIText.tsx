import { Fragment } from 'react';

// Renders the AI's plain-text reply into paragraphs, bullets, and a highlighted
// "Bottom line:" / "Watch:" callout. React escapes all text → XSS-safe.
function inline(s: string) {
  // Support **bold** only; everything else is plain text.
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>
  );
}

export default function AIText({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`ul-${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
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
      out.push(<h4 className="ai-section" key={`h-${out.length}`}>{header[1]}</h4>);
      continue;
    }
    // Tolerate a bold-wrapped label: "Bottom line:", "**Bottom line:**", "**Bottom line**:".
    const callout = line.match(/^(?:\*\*)?(bottom line|watch|key takeaway)\s*:?\s*(?:\*\*)?\s*:?\s*(.*)$/i);
    if (callout) {
      flush();
      out.push(
        <div className="ai-callout" key={`c-${out.length}`}>
          <strong>{callout[1].replace(/\b\w/g, (c) => c.toUpperCase())}:</strong> {inline(callout[2])}
        </div>
      );
    } else if (/^[-•▹]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•▹]\s+/, ''));
    } else {
      flush();
      out.push(<p key={`p-${out.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}
