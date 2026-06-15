import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { HistoryItem, HistoryNote } from '../lib/models';
import Card from './Card';
import AIText from './AIText';
import { timeAgo } from '../lib/format';

const KIND_LABEL: Record<HistoryItem['kind'], string> = {
  research: 'Deep research',
  outlook: 'Outlook',
  monopoly: 'Monopoly',
};

// Per-user history of generated notes — every fresh generation is auto-saved
// server-side; restoring loads the exact original note back into the view, and
// 2+ notes can be compared side by side (conviction + full text).
export default function MyResearch({ refreshKey, onRestore, onDelete }: {
  refreshKey: number;
  onRestore: (id: number) => void;
  onDelete: (id: number) => Promise<boolean>;
}) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [compare, setCompare] = useState<HistoryNote[] | null>(null);

  useEffect(() => {
    getJSON<{ notes: HistoryItem[] }>('/api/notes/history').then((d) => setItems(d.notes)).catch(() => setItems([]));
  }, [refreshKey]);

  if (!items || items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, 8);

  const toggle = (id: number) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else if (next.size < 3) next.add(id);
    return next;
  });

  const runCompare = async () => {
    const notes = await Promise.all([...selected].map((id) => getJSON<HistoryNote>(`/api/notes/history/${id}`).catch(() => null)));
    setCompare(notes.filter((n): n is HistoryNote => Boolean(n)));
  };

  return (
    <>
      {compare && compare.length > 0 && (
        <Card
          title="Compare research notes"
          sub={`${compare.length} notes side by side`}
          style={{ marginTop: 18 }}
          right={<button className="btn sm" onClick={() => setCompare(null)}>Close</button>}
        >
          <div className="compare-grid">
            {compare.map((n) => (
              <div key={n.id} className="compare-col">
                <div className="compare-head">
                  <span className="badge flat">{KIND_LABEL[n.kind]}</span>
                  <strong style={{ marginLeft: 8 }}>{n.title}</strong>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4 }}>
                    {timeAgo(n.created_at / 1000)} · conviction {n.conviction != null ? `${n.conviction}/5` : 'n/a'}
                  </div>
                </div>
                <div className="compare-body"><AIText text={n.text} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="My research"
        sub={`${items.length} saved note${items.length === 1 ? '' : 's'} — every generated note is kept automatically (last 200)`}
        style={{ marginTop: 18 }}
        right={
          <div className="row">
            {selected.size >= 2 && <button className="btn sm primary" onClick={runCompare}>Compare {selected.size}</button>}
            {items.length > 8 && <button className="btn sm" onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</button>}
          </div>
        }
      >
        <table className="mtable">
          <thead><tr><th style={{ width: 28 }} /><th>When</th><th>Type</th><th>Subject</th><th className="num">Conviction</th><th /></tr></thead>
          <tbody>
            {shown.map((n) => (
              <tr key={n.id} role="button" tabIndex={0} title="Reopen this note"
                onClick={() => onRestore(n.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onRestore(n.id); }}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Select ${n.title} to compare`} />
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>{timeAgo(n.created_at / 1000)}</td>
                <td><span className="badge flat">{KIND_LABEL[n.kind]}</span></td>
                <td style={{ fontWeight: 600 }}>{n.title}</td>
                <td className="num">{n.conviction != null ? `${n.conviction}/5` : '—'}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" style={{ width: 28, height: 28 }} title="Delete this note"
                    onClick={async () => { if (await onDelete(n.id)) { setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? cur); setSelected((s) => { const next = new Set(s); next.delete(n.id); return next; }); } }}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected.size === 1 && <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 8 }}>Select one more note to compare (up to 3).</div>}
      </Card>
    </>
  );
}
