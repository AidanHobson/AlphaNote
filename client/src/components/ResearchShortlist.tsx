import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { ResearchShortlist as Shortlist } from '../lib/models';
import Card from './Card';
import { SkeletonLines } from './Skeleton';

// Ranked research candidates by composite signal strength. Ranks WHAT TO
// RESEARCH (one click into the analyst), never what to buy.
export default function ResearchShortlist({ onResearch }: { onResearch: (symbol: string) => void }) {
  const [data, setData] = useState<Shortlist | null>(null);
  useEffect(() => { getJSON<Shortlist>('/api/social/screener').then(setData).catch(() => setData({ available: false })); }, []);

  if (data && !data.available) return null;
  return (
    <Card
      title="Research shortlist"
      sub="candidates from Reddit-trending names, market-wide insider buying, the day's biggest movers, and large Chinese tech ADRs — ranked by composite signal strength — what to research, not what to buy"
      style={{ marginTop: 16 }}
    >
      {!data ? <SkeletonLines lines={5} /> : (
        <table className="mtable">
          <thead><tr><th>#</th><th>Ticker</th><th>Source</th><th className="num">Score</th><th>Why it ranks</th><th className="num">Price</th><th /></tr></thead>
          <tbody>
            {(data.candidates || []).map((c, i) => (
              <tr key={c.symbol} role="button" tabIndex={0} title={`Research ${c.symbol}`}
                onClick={() => onResearch(c.symbol)} onKeyDown={(e) => { if (e.key === 'Enter') onResearch(c.symbol); }}>
                <td style={{ color: 'var(--color-text-muted)' }}>{i + 1}</td>
                <td style={{ fontWeight: 700, color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                  {c.symbol}{c.name && c.name !== c.symbol && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 400 }}>{c.name}</div>}
                </td>
                <td><span className={`badge ${c.source === 'insider buying' ? 'up' : 'flat'}`}>{c.source === 'insider buying' ? '★ insider' : c.source === 'big mover' ? '⇅ mover' : c.source === 'china tech' ? '🇨🇳 china' : '🔥 trending'}</span></td>
                <td className="num" style={{ fontWeight: 700 }} title={`attention ${c.components.attention} · squeeze ${c.components.squeeze} · momentum ${c.components.momentum} · insider ${c.components.insider}`}>
                  {c.score}
                </td>
                <td>{c.tags.length ? c.tags.map((t) => <span key={t} className="badge flat" style={{ marginRight: 5 }}>{t}</span>) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {c.quote
                    ? <>{c.quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}<span className={c.quote.changePercent >= 0 ? 'badge up' : 'badge down'} style={{ marginLeft: 6 }}>{c.quote.changePercent >= 0 ? '+' : ''}{c.quote.changePercent.toFixed(2)}%</span></>
                    : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" onClick={() => onResearch(c.symbol)} title={`Speculative outlook on ${c.symbol}`}>Research →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 10 }}>
        Score is a transparent weighted blend of signals the app already computes; it points you at names worth digging into, it is not a recommendation to buy. Not investment advice.
      </div>
    </Card>
  );
}
