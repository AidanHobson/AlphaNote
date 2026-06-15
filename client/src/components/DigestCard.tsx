import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { Digest } from '../lib/models';
import Card from './Card';

const fmtUsd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

// Pushes what's new for the user's watchlist: trending, insider buys, earnings.
export default function DigestCard() {
  const [d, setD] = useState<Digest | null>(null);
  useEffect(() => { getJSON<Digest>('/api/digest').then(setD).catch(() => {}); }, []);

  if (!d || d.watchlistCount === 0 || d.empty) return null;
  return (
    <Card title="Your watchlist digest" sub="what's new across the names you follow" style={{ marginBottom: 16 }}>
      <div className="digest-grid">
        {d.trending.length > 0 && (
          <div>
            <div className="digest-h">🔥 Trending on Reddit</div>
            {d.trending.map((t) => (
              <div key={t.symbol} className="digest-row">
                <Link to="/research" style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{t.symbol}</Link>
                <span style={{ color: 'var(--color-text-muted)' }}> #{t.rank}{t.shortVol != null ? ` · ${t.shortVol}% short` : ''}{t.rising ? ' · rising' : ''}</span>
              </div>
            ))}
          </div>
        )}
        {d.insiderBuys.length > 0 && (
          <div>
            <div className="digest-h">★ Insider buying</div>
            {d.insiderBuys.map((b) => (
              <div key={b.symbol} className="digest-row">
                <Link to={`/explorer?symbol=${b.symbol}`} style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{b.symbol}</Link>
                <span style={{ color: 'var(--color-text-muted)' }}> {b.buyers} buyer{b.buyers > 1 ? 's' : ''} · {fmtUsd(b.value)}</span>
              </div>
            ))}
          </div>
        )}
        {d.earningsSoon.length > 0 && (
          <div>
            <div className="digest-h">📅 Earnings this week</div>
            {d.earningsSoon.map((e) => (
              <div key={e.symbol} className="digest-row">
                <span style={{ fontWeight: 700 }}>{e.symbol}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> {e.date}{e.hour === 'amc' ? ' (after close)' : e.hour === 'bmo' ? ' (before open)' : ''}</span>
              </div>
            ))}
          </div>
        )}
        {d.newOnBoard.length > 0 && (
          <div>
            <div className="digest-h">New on the board</div>
            {d.newOnBoard.map((n) => (
              <div key={n.symbol} className="digest-row">
                <span style={{ fontWeight: 700 }}>{n.symbol}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{n.shortVol != null ? ` · ${n.shortVol}% short` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
