import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { MoverItem } from '../lib/models';
import Card from '../components/Card';
import MarketTable from '../components/MarketTable';
import Skeleton, { SkeletonLines } from '../components/Skeleton';
import { getWatchlist, onStorageChange } from '../lib/storage';
import { formatPct } from '../lib/format';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

export default function Watchlist() {
  const [symbols, setSymbols] = useState<string[]>(getWatchlist());
  const [items, setItems] = useState<MoverItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => onStorageChange(() => setSymbols(getWatchlist())), []);

  const load = useCallback(() => {
    if (!symbols.length) { setItems([]); return; }
    setItems(null);
    getJSON<{ items: MoverItem[] }>(`/api/watchlist?symbols=${encodeURIComponent(symbols.join(','))}`)
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  }, [symbols.join(',')]);

  useEffect(() => { load(); }, [load]);

  const bar = (data: MoverItem[]) => {
    const sorted = [...data].sort((a, b) => a.changePercent - b.changePercent);
    return [{
      type: 'bar', orientation: 'h',
      x: sorted.map((m) => m.changePercent), y: sorted.map((m) => m.symbol),
      text: sorted.map((m) => formatPct(m.changePercent)), textposition: 'auto',
      hovertemplate: '%{y}: %{x:.2f}%<extra></extra>',
      marker: { color: sorted.map((m) => (m.changePercent >= 0 ? cssVar('--color-up') : cssVar('--color-down'))) },
    }];
  };

  return (
    <div>
      <div className="page-head">
        <h1>Watchlist</h1>
        <p>Saved on this device. Open any row for charts, AI insight, and notes.</p>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {symbols.length === 0 ? (
        <div className="empty"><strong>Your watchlist is empty</strong>Search a ticker above, open it, and hit “Add to watchlist”.</div>
      ) : (
        <div className="grid grid-2">
          <Card title="Returns" sub="today %">
            {!items ? <Skeleton height={300} /> : items.length === 0 ? <div className="empty">No data.</div> : (
              <Suspense fallback={<Skeleton height={300} />}>
                <Chart data={bar(items)} height={Math.max(220, items.length * 30)} layout={{ xaxis: { ticksuffix: '%' } }} />
              </Suspense>
            )}
          </Card>
          <Card title="Holdings">
            {!items ? <SkeletonLines lines={6} /> : <MarketTable items={items} />}
          </Card>
        </div>
      )}
    </div>
  );
}
