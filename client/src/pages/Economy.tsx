import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getJSON } from '../lib/api';
import type { EconBrief, EconCalendar, EconEvent, Indicator, IndicatorsResponse, YieldCurve } from '../lib/models';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import AIText from '../components/AIText';
import Skeleton, { SkeletonLines } from '../components/Skeleton';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

// ISO-2 country code → flag emoji.
const flag = (cc: string) => (cc && cc.length === 2 ? cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : '🏳️');
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const trendColor = (good: 'low' | 'high' | 'neutral', latest?: number, prev?: number) => {
  if (good === 'neutral' || latest == null || prev == null) return 'var(--color-text-muted)';
  const up = latest > prev;
  const favorable = good === 'high' ? up : !up;
  return favorable ? 'var(--color-up)' : 'var(--color-down)';
};

export default function Economy() {
  const [ind, setInd] = useState<IndicatorsResponse | null>(null);
  const [cal, setCal] = useState<EconCalendar | null>(null);
  const [brief, setBrief] = useState<{ loading: boolean; data?: EconBrief; error?: string }>({ loading: true });
  const [yc, setYc] = useState<YieldCurve | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('High impact');

  useEffect(() => {
    getJSON<IndicatorsResponse>('/api/economy/indicators').then(setInd).catch((e) => setErr(e.message));
    getJSON<EconCalendar>('/api/economy/calendar?days=14').then(setCal).catch((e) => setErr(e.message));
    getJSON<EconBrief>('/api/economy/brief').then((data) => setBrief({ loading: false, data })).catch((e) => setBrief({ loading: false, error: e.message }));
    getJSON<YieldCurve>('/api/economy/yield-curve').then(setYc).catch(() => setYc({ available: false, reason: 'Yield curve unavailable.', curve: [] }));
  }, []);

  const source = ind?.source || 'World Bank';

  const events = useMemo(() => {
    if (!cal) return [] as EconEvent[];
    return tab === 'High impact' ? cal.items.filter((i) => i.impact === 'high') : cal.items;
  }, [cal, tab]);

  const byDate = useMemo(() => {
    const m = new Map<string, EconEvent[]>();
    for (const e of events) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e); }
    return [...m.entries()];
  }, [events]);

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1>Economy</h1>
          <p>US macro indicators ({source}) and the upcoming high-impact economic release calendar (Finnhub).</p>
        </div>
        <span className="pill accent" title={source === 'FRED' ? 'FRED key configured' : 'Add FRED_API_KEY for monthly data + yield curve'}>
          {source === 'FRED' ? 'FRED · monthly' : 'World Bank · annual'}
        </span>
      </div>

      {/* Indicators */}
      <div className={`grid ${ind && ind.indicators.length > 3 ? 'grid-3' : 'grid-3'}`} style={{ marginBottom: 16 }}>
        {!ind ? Array.from({ length: 3 }).map((_, i) => <Card key={i} title="…"><SkeletonLines lines={2} /></Card>)
          : ind.indicators.map((i) => <IndicatorCard key={i.code} ind={i} source={source} />)}
      </div>

      {/* AI economic read */}
      <Card title="Economic Read" sub="AI" style={{ marginBottom: 16 }}
        right={brief.data && <span className="pill accent">AI{brief.data.fellBack ? ' (fallback)' : ''}</span>}>
        {brief.loading && <SkeletonLines lines={3} />}
        {brief.error && <div className="error-banner">{brief.error}</div>}
        {brief.data && <div className="ai-body" style={{ padding: 0 }}><AIText text={brief.data.text} /></div>}
        {brief.data && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>AI-generated · {source === 'FRED' ? 'latest monthly/daily readings' : 'indicators are annual figures'} · not financial advice</div>}
      </Card>

      {/* Yield curve (FRED) */}
      <Card title="US Treasury yield curve" sub={yc?.available && yc.asOf ? yc.asOf : 'FRED'} style={{ marginBottom: 16 }}
        right={yc?.available && yc.spread2s10s != null && (
          <span className="badge" style={{ color: yc.inverted ? 'var(--color-down)' : 'var(--color-up)', background: 'var(--color-bg-elevated)' }}>
            2s10s {yc.spread2s10s > 0 ? '+' : ''}{yc.spread2s10s}%{yc.inverted ? ' · inverted' : ''}
          </span>
        )}>
        {!yc ? <Skeleton height={260} />
          : !yc.available ? <div className="empty" style={{ padding: 22 }}><strong>Live yield curve needs FRED</strong>{yc.reason}</div>
          : (
            <Suspense fallback={<Skeleton height={260} />}>
              <Chart
                height={280}
                data={[
                  yc.curve.some((p) => p.prior != null) && {
                    type: 'scatter', mode: 'lines', name: '~1mo ago',
                    x: yc.curve.map((p) => p.label), y: yc.curve.map((p) => p.prior),
                    line: { color: cssVar('--color-text-muted'), width: 1, dash: 'dot' }, hovertemplate: '%{x}: %{y:.2f}%<extra>~1mo ago</extra>',
                  },
                  {
                    type: 'scatter', mode: 'lines+markers', name: 'Today',
                    x: yc.curve.map((p) => p.label), y: yc.curve.map((p) => p.value),
                    line: { color: cssVar('--color-accent'), width: 2 }, marker: { size: 6, color: cssVar('--color-accent') },
                    hovertemplate: '%{x}: %{y:.2f}%<extra>Today</extra>',
                  },
                ].filter(Boolean)}
                layout={{ yaxis: { ticksuffix: '%' }, margin: { l: 44, r: 16, t: 10, b: 28 }, showlegend: true, legend: { orientation: 'h', y: 1.15 } }}
              />
            </Suspense>
          )}
      </Card>

      {/* Release calendar */}
      <div className="page-head" style={{ marginBottom: 8 }}><h1 style={{ fontSize: 18 }}>Release calendar</h1></div>
      <Tabs tabs={['High impact', 'High + Medium']} active={tab} onChange={setTab} />
      {err && <div className="error-banner">{err}</div>}
      {!cal && !err && <Card title=" "><SkeletonLines lines={8} /></Card>}
      {cal && byDate.length === 0 && <div className="empty"><strong>No releases in this window</strong>Try the “High + Medium” filter.</div>}

      <div className="grid" style={{ gap: 16 }}>
        {byDate.map(([date, items]) => (
          <Card key={date} title={fmtDate(date)} sub={`${items.length} release${items.length === 1 ? '' : 's'}`}>
            <table className="mtable">
              <thead><tr><th>Event</th><th className="num">Actual</th><th className="num">Est.</th><th className="num">Prev.</th></tr></thead>
              <tbody>
                {items.map((e, i) => (
                  <tr key={e.event + e.time + i} style={{ cursor: 'default' }}>
                    <td>
                      <span style={{ marginRight: 8 }}>{flag(e.country)}</span>
                      <span style={{ fontWeight: 600 }}>{e.event}</span>
                      <span className="pill" style={{ marginLeft: 8, color: e.impact === 'high' ? 'var(--color-down)' : 'var(--color-warn)' }}>{e.impact}</span>
                      {e.time && <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 8 }}>{e.time}</span>}
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: e.actual != null ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{e.actual != null ? `${e.actual}${e.unit}` : '—'}</td>
                    <td className="num">{e.estimate != null ? `${e.estimate}${e.unit}` : '—'}</td>
                    <td className="num" style={{ color: 'var(--color-text-secondary)' }}>{e.prev != null ? `${e.prev}${e.unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </div>
  );
}

function IndicatorCard({ ind, source }: { ind: Indicator; source: string }) {
  const latest = ind.latest;
  const max = Math.max(...ind.history.map((h) => Math.abs(h.value)), 1);
  const color = trendColor(ind.good, latest?.value, ind.prev?.value);
  return (
    <Card title={ind.label} sub={latest ? `${latest.year}${ind.freq ? ' · ' + ind.freq : ''}` : ''}>
      {!latest ? <div className="empty" style={{ padding: 14 }}>No data</div> : (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 800 }}>{latest.value}{ind.unit}</span>
            {ind.prev && <span className="badge" style={{ color, background: 'var(--color-bg-elevated)' }}>{latest.value > ind.prev.value ? '▲' : latest.value < ind.prev.value ? '▼' : '→'} vs {ind.prev.value}{ind.unit} ({ind.prev.year})</span>}
          </div>
          {/* mini history bars */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 40, marginTop: 12 }}>
            {ind.history.map((h) => (
              <div key={h.year} style={{ flex: 1, textAlign: 'center' }} title={`${h.year}: ${h.value}${ind.unit}`}>
                <div style={{ height: `${(Math.abs(h.value) / max) * 34 + 2}px`, background: h === latest ? 'var(--color-accent)' : 'var(--color-border-strong)', borderRadius: 2 }} />
              </div>
            ))}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 10.5, marginTop: 6 }}>{ind.history[0]?.year}–{latest.year} · {source}</div>
        </div>
      )}
    </Card>
  );
}
