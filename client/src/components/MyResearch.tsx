import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { HistoryItem } from '../lib/models';
import Card from './Card';
import { timeAgo } from '../lib/format';

const KIND_LABEL: Record<HistoryItem['kind'], string> = {
  research: 'Deep research',
  outlook: 'Outlook',
  monopoly: 'Monopoly',
};

// Per-user history of generated notes — every fresh generation is auto-saved
// server-side; restoring loads the exact original note back into the view.
export default function MyResearch({ refreshKey, onRestore, onDelete }: {
  refreshKey: number;
  onRestore: (id: number) => void;
  onDelete: (id: number) => Promise<boolean>;
}) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getJSON<{ notes: HistoryItem[] }>('/api/notes/history').then((d) => setItems(d.notes)).catch(() => setItems([]));
  }, [refreshKey]);

  if (!items || items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, 8);

  return (
    <Card
      title="My research"
      sub={`${items.length} saved note${items.length === 1 ? '' : 's'} — every generated note is kept automatically (last 200)`}
      style={{ marginTop: 18 }}
      right={items.length > 8
        ? <button className="btn sm" onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</button>
        : undefined}
    >
      <table className="mtable">
        <thead><tr><th>When</th><th>Type</th><th>Subject</th><th className="num">Conviction</th><th /></tr></thead>
        <tbody>
          {shown.map((n) => (
            <tr key={n.id} role="button" tabIndex={0} title="Reopen this note"
              onClick={() => onRestore(n.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onRestore(n.id); }}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>{timeAgo(n.created_at / 1000)}</td>
              <td><span className="badge flat">{KIND_LABEL[n.kind]}</span></td>
              <td style={{ fontWeight: 600 }}>{n.title}</td>
              <td className="num">{n.conviction != null ? `${n.conviction}/5` : '—'}</td>
              <td className="num" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" style={{ width: 28, height: 28 }} title="Delete this note"
                  onClick={async () => { if (await onDelete(n.id)) setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? cur); }}>
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
