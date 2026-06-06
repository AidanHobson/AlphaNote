import { lazy, Suspense, useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { FactorBoard, FactorBrief } from '../lib/models';
import Card from '../components/Card';
import AIText from '../components/AIText';
import Skeleton, { SkeletonLines } from '../components/Skeleton';
import { formatPct } from '../lib/format';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

export default function Factors() {
  const [board, setBoard] = useState<FactorBoard | null>(null);
  const [boardErr, setBoardErr] = useState('');
  const [brief, setBrief] = useState<{ loading: boolean; data?: FactorBrief; error?: string }>({ loading: true });

  useEffect(() => {
    getJSON<FactorBoard>('/api/factors').then(setBoard).catch((e) => setBoardErr(e.message));
    getJSON<FactorBrief>('/api/factors/brief').then((data) => setBrief({ loading: false, data })).catch((e) => setBrief({ loading: false, error: e.message }));
  }, []);

  const factorBar = () => {
    const s = [...(board?.factors || [])].sort((a, b) => a.changePercent - b.changePercent);
    return [{
      type: 'bar', orientation: 'h', x: s.map((f) => f.changePercent), y: s.map((f) => f.label),
      text: s.map((f) => formatPct(f.changePercent)), textposition: 'auto', hovertemplate: '%{y}: %{x:.2f}%<extra></extra>',
      marker: { color: s.map((f) => (f.changePercent >= 0 ? cssVar('--color-up') : cssVar('--color-down'))) },
    }];
  };
  const spreadBar = () => {
    const s = [...(board?.spreads || [])].sort((a, b) => a.value - b.value);
    return [{
      type: 'bar', orientation: 'h', x: s.map((f) => f.value), y: s.map((f) => f.label),
      text: s.map((f) => (f.value >= 0 ? '+' : '') + f.value.toFixed(2)), textposition: 'auto', hovertemplate: '%{y}: %{x:.2f} pts<extra></extra>',
      marker: { color: s.map((f) => (f.value >= 0 ? cssVar('--color-up') : cssVar('--color-down'))) },
    }];
  };

  return (
    <div>
      <div className="page-head">
        <h1>Factors</h1>
        <p>Equity style-factor performance and long/short rotation spreads (liquid factor-ETF proxies).</p>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Card title="Leadership" sub="today">
          {!board ? <SkeletonLines lines={3} /> : (
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Leading</div>
                <span className="regime-chip" style={{ fontSize: 18 }}><span className="regime-dot" style={{ background: cssVar('--color-up') }} />{board.leader.label} <span className="badge up">{formatPct(board.leader.changePercent)}</span></span>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Lagging</div>
                <span className="regime-chip" style={{ fontSize: 18 }}><span className="regime-dot" style={{ background: cssVar('--color-down') }} />{board.laggard.label} <span className="badge down">{formatPct(board.laggard.changePercent)}</span></span>
              </div>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>Market (SPY) {formatPct(board.market)}</div>
            </div>
          )}
        </Card>

        <Card className="col-span-2" title="Factor Read" sub="AI"
          right={brief.data && <span className="pill accent">{brief.data.provider}{brief.data.fellBack ? ' (fallback)' : ''}</span>}>
          {brief.loading && <SkeletonLines lines={4} />}
          {brief.error && <div className="error-banner">{brief.error}</div>}
          {brief.data && <div className="ai-body" style={{ padding: 0 }}><AIText text={brief.data.text} /></div>}
          {brief.data && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>AI-generated · ETF proxies, not the underlying · not financial advice</div>}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Single-factor returns" sub="today %">
          {boardErr ? <div className="error-banner">{boardErr}</div> : !board ? <Skeleton height={320} /> : (
            <Suspense fallback={<Skeleton height={320} />}>
              <Chart data={factorBar()} height={320} layout={{ xaxis: { ticksuffix: '%' }, margin: { l: 110, r: 18, t: 10, b: 30 } }} />
            </Suspense>
          )}
        </Card>
        <Card title="Rotation spreads" sub="long − short, % points">
          {!board ? <Skeleton height={320} /> : (
            <Suspense fallback={<Skeleton height={320} />}>
              <Chart data={spreadBar()} height={320} layout={{ margin: { l: 150, r: 18, t: 10, b: 30 } }} />
            </Suspense>
          )}
        </Card>
      </div>
    </div>
  );
}
