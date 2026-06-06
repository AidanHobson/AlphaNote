import { lazy, Suspense, useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { MarketValuation, ValMetric } from '../lib/models';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import Skeleton, { SkeletonLines } from '../components/Skeleton';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

const TABS = ['Market', 'Valuation', 'Yields', 'Quality', 'Leverage', 'Growth', 'Size'];

const richColor = (p: number) => (p >= 60 ? 'var(--color-down)' : p <= 40 ? 'var(--color-up)' : 'var(--color-warn)');
const valueColor = (p: number) => (p >= 60 ? 'var(--color-down)' : p <= 40 ? 'var(--color-up)' : 'var(--color-text-primary)');
const fmtVal = (v: number, u: string) => (u === 'x' ? `${v.toFixed(1)}x` : u === 'pp' ? `${v.toFixed(2)}pp` : `${v.toFixed(2)}%`);
const fmtMom = (m: number, u: string) => `${m >= 0 ? '+' : ''}${u === 'x' ? m.toFixed(1) + 'x' : u === 'pp' ? m.toFixed(2) + 'pp' : m.toFixed(2) + '%'} MoM`;

function Spark({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return null;
  const w = 132, h = 44, min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export default function Valuation() {
  const [tab, setTab] = useState('Market');
  const [data, setData] = useState<MarketValuation | null>(null);
  const [error, setError] = useState('');
  const [yields, setYields] = useState<MarketValuation | null>(null);
  const [yieldsErr, setYieldsErr] = useState('');
  const [open, setOpen] = useState<{ m: ValMetric; neutral: boolean } | null>(null);

  useEffect(() => {
    getJSON<MarketValuation>('/api/valuation/market').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab === 'Yields' && !yields && !yieldsErr) {
      getJSON<MarketValuation>('/api/valuation/yields').then(setYields).catch((e) => setYieldsErr(e.message));
    }
  }, [tab, yields, yieldsErr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Valuation Explorer</h1>
        <p>Fundamental metrics grouped by region, country, sector, or industry. Current values are colored relative to their own history.</p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Market' ? (
        <div>
          <p style={{ color: 'var(--color-text-secondary)', maxWidth: 760, marginTop: 0 }}>
            Headline US equity market valuation, compared against its own full history. Tiles are color-coded by percentile:
            richer valuations shown in <span style={{ color: 'var(--color-down)' }}>red</span>, cheaper in <span style={{ color: 'var(--color-up)' }}>green</span>. Click any tile to see the full historical chart.
          </p>

          {error && <div className="error-banner">{error}</div>}
          {!data && !error && <div className="grid grid-3">{Array.from({ length: 6 }).map((_, i) => <Card key={i}><SkeletonLines lines={4} /></Card>)}</div>}

          {data && (
            <div className="grid grid-3">
              {data.metrics.map((m) => <ValTile key={m.key} m={m} onOpen={() => m.available && setOpen({ m, neutral: false })} />)}
            </div>
          )}
        </div>
      ) : tab === 'Yields' ? (
        <div>
          <p style={{ color: 'var(--color-text-secondary)', maxWidth: 760, marginTop: 0 }}>
            US interest rates across the curve (Treasury constant maturities + the fed funds rate) and S&P 500 dividend &amp; earnings yields,
            each shown against its own full history. Click any tile for the full chart.
          </p>
          {yieldsErr && <div className="error-banner">{yieldsErr}</div>}
          {!yields && !yieldsErr && <div className="grid grid-3">{Array.from({ length: 6 }).map((_, i) => <Card key={i}><SkeletonLines lines={4} /></Card>)}</div>}
          {yields && (
            <div className="grid grid-3">
              {yields.metrics.map((m) => <ValTile key={m.key} m={m} neutral onOpen={() => m.available && setOpen({ m, neutral: true })} />)}
            </div>
          )}
        </div>
      ) : (
        <Card title={`${tab} — by sector / country`}>
          <div className="empty" style={{ border: 'none' }}>
            <strong>Cross-sectional fundamentals aren’t in this free build</strong>
            The “{tab}” lens groups per-company fundamentals (P/B, P/S, ROE, margins, debt, growth, market cap) by sector, country,
            and industry — which needs a premium fundamentals dataset. The <b>Market</b> and <b>Yields</b> tabs are fully live on free public data
            (Shiller via multpl.com + FRED).
          </div>
        </Card>
      )}

      {open && <ValModal m={open.m} neutral={open.neutral} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ValTile({ m, onOpen, neutral = false }: { m: ValMetric; onOpen: () => void; neutral?: boolean }) {
  if (!m.available) {
    return (
      <Card>
        <div style={{ fontWeight: 700 }}>{m.label}</div>
        <div className="empty" style={{ border: 'none', padding: '18px 0' }}>Data unavailable right now.</div>
      </Card>
    );
  }
  const sparkColor = m.mom >= 0 ? cssVar('--color-up') : cssVar('--color-down');
  const valColor = neutral ? 'var(--color-text-primary)' : valueColor(m.richPercentile);
  const barColor = neutral ? 'var(--color-accent)' : richColor(m.richPercentile);
  return (
    <Card className="vtile" onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{m.label}</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>As of {m.asOf}</div>
        </div>
        <Spark values={m.spark} color={sparkColor} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
        <span className="vval" style={{ color: valColor }}>{fmtVal(m.value, m.unit)}</span>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{fmtMom(m.mom, m.unit)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-secondary)', fontSize: 12.5, marginTop: 14 }}>
        <span>Percentile vs own history</span>
        <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{m.valuePercentile}</span>
      </div>
      <div className="pct-track"><div className="pct-fill" style={{ width: `${Math.max(m.valuePercentile, 1)}%`, background: barColor }} /></div>

      <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>{m.description}</div>
    </Card>
  );
}

function ValModal({ m, onClose, neutral = false }: { m: ValMetric; onClose: () => void; neutral?: boolean }) {
  const lineVar = neutral ? '--color-accent' : m.richPercentile >= 60 ? '--color-down' : m.richPercentile <= 40 ? '--color-up' : '--color-accent';
  return (
    <div className="vmodal-overlay" onClick={onClose}>
      <div className="vmodal" onClick={(e) => e.stopPropagation()}>
        <div className="vmodal-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{m.label}</h2>
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 2 }}>
              Full history · current <b style={{ color: neutral ? 'var(--color-text-primary)' : valueColor(m.richPercentile) }}>{fmtVal(m.value, m.unit)}</b> ({m.valuePercentile}th percentile, as of {m.asOf})
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        <Suspense fallback={<Skeleton height={380} />}>
          <Chart
            height={400}
            data={[{
              type: 'scatter', mode: 'lines',
              x: m.history.map((h) => h.date), y: m.history.map((h) => h.value),
              line: { color: cssVar(lineVar), width: 1.5 },
              hovertemplate: `%{x|%b %Y}: %{y}${m.unit === '%' ? '%' : ''}<extra></extra>`,
            }]}
            layout={{ margin: { l: 50, r: 18, t: 10, b: 34 }, yaxis: { ticksuffix: m.unit === '%' ? '%' : '' } }}
          />
        </Suspense>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 8 }}>{m.description}</div>
      </div>
    </div>
  );
}
