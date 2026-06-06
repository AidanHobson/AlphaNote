import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { EarningsItem, EarningsResponse } from '../lib/models';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import { SkeletonLines } from '../components/Skeleton';
import { getWatchlist } from '../lib/storage';

const hourLabel = (h: string) => (h === 'bmo' ? 'Before open' : h === 'amc' ? 'After close' : '—');
const hourPill = (h: string) => (h === 'bmo' ? 'pill' : h === 'amc' ? 'pill' : 'pill');
function fmtRev(v: number | null) {
  if (v == null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}
function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function Earnings() {
  const watchlist = useMemo(() => getWatchlist(), []);
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Notable');

  useEffect(() => {
    const q = watchlist.length ? `?days=21&symbols=${encodeURIComponent(watchlist.join(','))}` : '?days=21';
    getJSON<EarningsResponse>(`/api/earnings${q}`).then(setData).catch((e) => setError(e.message));
  }, [watchlist.join(',')]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (tab === 'My watchlist') return data.items.filter((i) => i.inWatchlist);
    return data.items.filter((i) => i.hasEstimate);
  }, [data, tab]);

  const byDate = useMemo(() => {
    const m = new Map<string, EarningsItem[]>();
    for (const it of filtered) { if (!m.has(it.date)) m.set(it.date, []); m.get(it.date)!.push(it); }
    return [...m.entries()];
  }, [filtered]);

  return (
    <div>
      <div className="page-head">
        <h1>Earnings Calendar</h1>
        <p>Upcoming reports for the next 3 weeks — analyst-covered names, with before/after-market timing and estimates.</p>
      </div>

      <Tabs tabs={['Notable', 'My watchlist']} active={tab} onChange={setTab} />

      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <Card title=" "><SkeletonLines lines={8} /></Card>}
      {data && byDate.length === 0 && (
        <div className="empty">
          <strong>{tab === 'My watchlist' ? 'No watchlist earnings in the next 3 weeks' : 'No upcoming earnings found'}</strong>
          {tab === 'My watchlist' ? 'Add tickers to your watchlist to track their reports here.' : 'Check back later.'}
        </div>
      )}

      <div className="grid" style={{ gap: 16 }}>
        {byDate.map(([date, items]) => (
          <Card key={date} title={fmtDate(date)} sub={`${items.length} report${items.length === 1 ? '' : 's'}`}>
            <EarnTable items={items} />
          </Card>
        ))}
      </div>
    </div>
  );
}

function EarnTable({ items }: { items: EarningsItem[] }) {
  const nav = useNavigate();
  return (
    <table className="mtable">
      <thead>
        <tr><th>Symbol</th><th>Timing</th><th className="num">EPS est.</th><th className="num">Revenue est.</th></tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.symbol + it.date} onClick={() => nav(`/explorer?symbol=${encodeURIComponent(it.symbol)}`)}>
            <td>
              <span style={{ fontWeight: 700 }}>{it.symbol}</span>
              {it.inWatchlist && <span className="pill accent" style={{ marginLeft: 8 }}>watchlist</span>}
              {it.quarter && <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 8 }}>Q{it.quarter} {it.year}</span>}
            </td>
            <td><span className={hourPill(it.hour)}>{hourLabel(it.hour)}</span></td>
            <td className="num">{it.epsEstimate != null ? `$${it.epsEstimate.toFixed(2)}` : '—'}</td>
            <td className="num">{fmtRev(it.revenueEstimate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
