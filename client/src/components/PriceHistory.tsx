import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getJSON } from '../lib/api';
import type { PriceHistory as PHData } from '../lib/models';
import Card from './Card';
import Tabs from './Tabs';
import Skeleton from './Skeleton';
import { formatPct } from '../lib/format';

const Chart = lazy(() => import('./Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

const RANGES: Record<string, number> = { '1M': 22, '3M': 66, '6M': 132, '1Y': Infinity };

// Native end-of-day history chart (EODHD). One fetch covers every range — the
// 1M/3M/6M tabs just slice client-side, which matters on EODHD's ~20/day quota.
export default function PriceHistory({ symbol }: { symbol: string }) {
  const [data, setData] = useState<PHData | null>(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('1Y');

  useEffect(() => {
    setData(null); setError('');
    getJSON<PHData>(`/api/history/${encodeURIComponent(symbol)}`).then(setData).catch((e) => setError(e.message));
  }, [symbol]);

  const sliced = useMemo(() => {
    if (!data?.points) return [];
    const n = RANGES[range];
    return n === Infinity ? data.points : data.points.slice(-n);
  }, [data, range]);

  const rangeChange = sliced.length > 1 ? ((sliced[sliced.length - 1].close - sliced[0].close) / sliced[0].close) * 100 : 0;
  const up = rangeChange >= 0;

  return (
    <Card
      title="Price history"
      sub="EODHD · adjusted close"
      right={sliced.length > 1 && (
        <span className={`badge ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {formatPct(rangeChange)} {range}</span>
      )}
    >
      {error ? <div className="error-banner">{error}</div>
        : !data ? <Skeleton height={300} />
        : !data.available ? <div className="empty" style={{ border: 'none' }}>{data.reason}</div>
        : (
          <div>
            <Tabs tabs={Object.keys(RANGES)} active={range} onChange={setRange} />
            <Suspense fallback={<Skeleton height={280} />}>
              <Chart
                height={280}
                data={[{
                  type: 'scatter', mode: 'lines',
                  x: sliced.map((p) => p.date), y: sliced.map((p) => p.close),
                  line: { color: cssVar(up ? '--color-up' : '--color-down'), width: 1.6 },
                  hovertemplate: '%{x|%b %d, %Y}: $%{y:.2f}<extra></extra>',
                }]}
                layout={{ margin: { l: 48, r: 12, t: 8, b: 30 }, yaxis: { tickprefix: '$' } }}
              />
            </Suspense>
            {data.stats && (
              <div style={{ display: 'flex', gap: 22, color: 'var(--color-text-secondary)', fontSize: 12.5, marginTop: 6, flexWrap: 'wrap' }}>
                <span>Last <b style={{ color: 'var(--color-text-primary)' }}>${data.stats.lastClose.toFixed(2)}</b> ({data.stats.last})</span>
                <span>1Y high <b style={{ color: 'var(--color-text-primary)' }}>${data.stats.high.toFixed(2)}</b></span>
                <span>1Y low <b style={{ color: 'var(--color-text-primary)' }}>${data.stats.low.toFixed(2)}</b></span>
              </div>
            )}
          </div>
        )}
    </Card>
  );
}
