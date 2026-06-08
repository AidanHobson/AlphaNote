import { lazy, Suspense, useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { MarketValuation, ValMetric } from '../lib/models';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import Skeleton, { SkeletonLines } from '../components/Skeleton';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

const TABS = ['Market', 'Yields', 'Growth', 'Quality', 'Leverage', 'Size'];
const THEME_TABS = ['Growth', 'Quality', 'Leverage'];
const THEME_INTRO: Record<string, string> = {
  Growth: 'The growth backdrop — real GDP, industrial production, consumer spending, retail sales and payrolls — each shown against its own history.',
  Quality: 'Aggregate corporate quality & credit conditions — profit share of GDP, the Baa–Aaa quality spread, bank lending standards and recession odds.',
  Leverage: 'System leverage & credit stress — high-yield and Baa spreads, household debt service, nonfinancial corporate debt/GDP and loan delinquencies.',
};

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
  const [themes, setThemes] = useState<Record<string, MarketValuation>>({});
  const [themeErr, setThemeErr] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ m: ValMetric; neutral: boolean } | null>(null);

  useEffect(() => {
    getJSON<MarketValuation>('/api/valuation/market').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab === 'Yields' && !yields && !yieldsErr) {
      getJSON<MarketValuation>('/api/valuation/yields').then(setYields).catch((e) => setYieldsErr(e.message));
    }
    if (THEME_TABS.includes(tab) && !themes[tab] && !themeErr[tab]) {
      getJSON<MarketValuation>(`/api/valuation/theme/${tab}`)
        .then((d) => setThemes((s) => ({ ...s, [tab]: d })))
        .catch((e) => setThemeErr((s) => ({ ...s, [tab]: e.message })));
    }
  }, [tab, yields, yieldsErr, themes, themeErr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Valuation Explorer</h1>
        <p>Market valuation, rates, and the macro backdrop for growth, quality and leverage — each metric shown against its own history.</p>
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
      ) : THEME_TABS.includes(tab) ? (
        <div>
          <p style={{ color: 'var(--color-text-secondary)', maxWidth: 760, marginTop: 0 }}>
            {THEME_INTRO[tab]} Click any tile for the full history.
          </p>
          {themeErr[tab] && <div className="error-banner">{themeErr[tab]}</div>}
          {!themes[tab] && !themeErr[tab] && <div className="grid grid-3">{Array.from({ length: 5 }).map((_, i) => <Card key={i}><SkeletonLines lines={4} /></Card>)}</div>}
          {themes[tab] && (
            <div className="grid grid-3">
              {themes[tab].metrics.map((m) => <ValTile key={m.key} m={m} neutral onOpen={() => m.available && setOpen({ m, neutral: true })} />)}
            </div>
          )}
        </div>
      ) : (
        <Card title="Size — small vs large cap">
          <div className="empty" style={{ border: 'none' }}>
            <strong>The size lens needs an index-history feed the free tier lacks</strong>
            A small-vs-large read needs small-cap index history (Russell 2000 / Wilshire small-cap), which FRED has discontinued and
            Finnhub gates behind its premium candle API. The <b>Market</b>, <b>Yields</b>, <b>Growth</b>, <b>Quality</b> and <b>Leverage</b> tabs
            are all live on free public data (Shiller via multpl.com + FRED).
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
      <div className="vmodal" role="dialog" aria-modal="true" aria-label={`${m.label} — full history`} onClick={(e) => e.stopPropagation()}>
        <div className="vmodal-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{m.label}</h2>
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 2 }}>
              Full history · current <b style={{ color: neutral ? 'var(--color-text-primary)' : valueColor(m.richPercentile) }}>{fmtVal(m.value, m.unit)}</b> ({m.valuePercentile}th percentile, as of {m.asOf})
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close dialog">✕</button>
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
