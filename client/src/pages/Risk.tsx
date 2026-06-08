import { lazy, Suspense, useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { RiskBoard, RiskBrief, RiskMetric } from '../lib/models';
import Card from '../components/Card';
import AIText from '../components/AIText';
import Skeleton, { SkeletonLines } from '../components/Skeleton';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

// High risk-percentile = more stress → red; low = calm → green; middle = amber.
const stressColor = (p: number) => (p >= 60 ? 'var(--color-down)' : p <= 35 ? 'var(--color-up)' : 'var(--color-warn)');
const fmtVal = (v: number, u: string) => (u === '%' ? `${v.toFixed(2)}%` : u === 'pp' ? `${v.toFixed(2)}pp` : v.toFixed(2));
const fmtChg = (m: number, u: string, lbl: string) =>
  `${m >= 0 ? '+' : ''}${u === '%' ? m.toFixed(2) + '%' : u === 'pp' ? m.toFixed(2) + 'pp' : m.toFixed(2)} ${lbl}`;

function Spark({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return null;
  const w = 120, h = 40, min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export default function Risk() {
  const [board, setBoard] = useState<RiskBoard | null>(null);
  const [err, setErr] = useState('');
  const [brief, setBrief] = useState<{ loading: boolean; data?: RiskBrief; error?: string }>({ loading: true });
  const [open, setOpen] = useState<RiskMetric | null>(null);

  useEffect(() => {
    getJSON<RiskBoard>('/api/risk').then(setBoard).catch((e) => setErr(e.message));
    getJSON<RiskBrief>('/api/risk/brief').then((d) => setBrief({ loading: false, data: d })).catch((e) => setBrief({ loading: false, error: e.message }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Risk Monitor</h1>
        <p>Interest-rate, liquidity/credit and foreign-exchange stress — each gauge scored against its own history so a higher score always means more risk.</p>
      </div>

      <div className="grid grid-3">
        <Card title="Overall risk" sub="composite">
          {!board ? <SkeletonLines lines={3} /> : (
            <div>
              <div className="regime-chip">
                <span className="regime-dot" style={{ background: stressColor(board.overall) }} />
                {board.label}
              </div>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 10, fontSize: 13 }}>
                Composite stress <b style={{ color: 'var(--color-text-primary)' }}>{board.overall}</b> / 100
              </div>
              <div className="pct-track" style={{ marginTop: 8 }}><div className="pct-fill" style={{ width: `${Math.max(board.overall, 1)}%`, background: stressColor(board.overall) }} /></div>
            </div>
          )}
        </Card>

        <Card
          className="col-span-2"
          title="Risk Read"
          sub="AI"
          right={brief.data && <span className="pill accent">{brief.data.provider}{brief.data.fellBack ? ' (fallback)' : ''}</span>}
        >
          {brief.loading && <SkeletonLines lines={4} />}
          {brief.error && <div className="error-banner">{brief.error}</div>}
          {brief.data && <div className="ai-body" style={{ padding: 0 }}><AIText text={brief.data.text} /></div>}
          {brief.data && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>AI-generated · not financial advice</div>}
        </Card>
      </div>

      {err && <div className="error-banner" style={{ marginTop: 16 }}>{err}</div>}
      {!board && !err && <div className="grid grid-3" style={{ marginTop: 16 }}>{Array.from({ length: 6 }).map((_, i) => <Card key={i}><SkeletonLines lines={4} /></Card>)}</div>}

      {board && board.groups.map((g) => (
        <section key={g.key} style={{ marginTop: 26 }}>
          <div className="risk-head">
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>{g.name}</h2>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 12.5, marginTop: 2 }}>{g.blurb}</div>
            </div>
            <div className="risk-gauge">
              <span className="stress-chip" style={{ color: stressColor(g.stress), borderColor: stressColor(g.stress) }}>{g.label}</span>
              <div style={{ minWidth: 120 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                  <span>stress</span><span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{g.stress}/100</span>
                </div>
                <div className="pct-track" style={{ marginTop: 4 }}><div className="pct-fill" style={{ width: `${Math.max(g.stress, 1)}%`, background: stressColor(g.stress) }} /></div>
              </div>
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            {g.metrics.map((m) => <RiskTile key={m.key} m={m} onOpen={() => m.available && setOpen(m)} />)}
          </div>
        </section>
      ))}

      {open && <RiskModal m={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RiskTile({ m, onOpen }: { m: RiskMetric; onOpen: () => void }) {
  if (!m.available) {
    return (
      <Card>
        <div style={{ fontWeight: 700 }}>{m.label}</div>
        <div className="empty" style={{ border: 'none', padding: '18px 0' }}>Data unavailable right now.</div>
      </Card>
    );
  }
  const color = stressColor(m.richPercentile);
  const sparkColor = m.mom >= 0 ? cssVar('--color-down') : cssVar('--color-up'); // rising metric → toward stress for most gauges
  return (
    <Card className="vtile" onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{m.label}</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>As of {m.asOf}</div>
        </div>
        <Spark values={m.spark} color={sparkColor} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
        <span className="vval" style={{ color }}>{fmtVal(m.value, m.unit)}</span>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{fmtChg(m.mom, m.unit, m.changeLabel)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-secondary)', fontSize: 12.5, marginTop: 14 }}>
        <span>Risk percentile vs history</span>
        <span style={{ fontWeight: 700, color }}>{m.richPercentile}</span>
      </div>
      <div className="pct-track"><div className="pct-fill" style={{ width: `${Math.max(m.richPercentile, 1)}%`, background: color }} /></div>

      <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>{m.description}</div>
    </Card>
  );
}

function RiskModal({ m, onClose }: { m: RiskMetric; onClose: () => void }) {
  const color = stressColor(m.richPercentile);
  return (
    <div className="vmodal-overlay" onClick={onClose}>
      <div className="vmodal" role="dialog" aria-modal="true" aria-label={`${m.label} — full history`} onClick={(e) => e.stopPropagation()}>
        <div className="vmodal-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{m.label}</h2>
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 2 }}>
              Full history · current <b style={{ color }}>{fmtVal(m.value, m.unit)}</b> ({m.richPercentile}th risk percentile, as of {m.asOf})
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
              line: { color: cssVar(m.richPercentile >= 60 ? '--color-down' : m.richPercentile <= 35 ? '--color-up' : '--color-warn'), width: 1.5 },
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
