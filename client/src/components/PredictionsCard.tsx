import type { PredictionsBoard } from '../lib/models';
import Card from './Card';

export default function PredictionsCard({ predictions }: { predictions: PredictionsBoard | null }) {
  if (!predictions?.available || !predictions.events.length) return null;
  return (
    <Card
      title="Crowd odds — prediction markets"
      sub={`${predictions.source} · real-money implied probabilities on market questions · refreshed hourly`}
      style={{ marginTop: 16 }}
    >
      <table className="mtable">
        <thead><tr><th>Event</th><th>Leading market</th><th className="num">Implied</th><th className="num">Volume</th><th className="num">Resolves</th></tr></thead>
        <tbody>
          {predictions.events.map((e) => (
            <tr key={e.title} style={{ cursor: 'default' }}>
              <td style={{ maxWidth: 280 }}>{e.title}</td>
              <td style={{ maxWidth: 320, color: 'var(--color-text-secondary)' }}>{e.topMarket?.question || '—'}</td>
              <td className="num" style={{ fontWeight: 700 }}>{e.topMarket ? `${e.topMarket.pct}%` : '—'}</td>
              <td className="num">${Math.round(e.volume).toLocaleString()}</td>
              <td className="num">{e.endDate || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
