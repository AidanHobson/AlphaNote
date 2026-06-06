import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { AnalystRatings as Ratings } from '../lib/models';
import Card from './Card';
import { SkeletonLines } from './Skeleton';

const toneColor = (label: string) =>
  /Buy/.test(label) ? 'var(--color-up)' : /Sell/.test(label) ? 'var(--color-down)' : 'var(--color-warn)';

const SEGMENTS = [
  { key: 'strongBuy', label: 'Strong Buy', color: 'var(--color-up)', opacity: 1 },
  { key: 'buy', label: 'Buy', color: 'var(--color-up)', opacity: 0.55 },
  { key: 'hold', label: 'Hold', color: 'var(--color-text-muted)', opacity: 0.6 },
  { key: 'sell', label: 'Sell', color: 'var(--color-down)', opacity: 0.55 },
  { key: 'strongSell', label: 'Strong Sell', color: 'var(--color-down)', opacity: 1 },
] as const;

const monthAbbr = (period: string) => new Date(period + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });

export default function AnalystRatings({ symbol, onConsensus }: { symbol: string; onConsensus?: (label: string, total: number) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: Ratings; error?: string }>({ loading: true });

  useEffect(() => {
    setState({ loading: true });
    getJSON<Ratings>(`/api/analyst/${encodeURIComponent(symbol)}`)
      .then((data) => { setState({ loading: false, data }); if (data.hasCoverage) onConsensus?.(data.consensus.label, data.consensus.total); })
      .catch((e) => setState({ loading: false, error: e.message }));
  }, [symbol]);

  const { loading, data, error } = state;
  const latest = data?.latest;
  const total = data?.consensus.total || 0;

  return (
    <Card title="Analyst ratings" sub="consensus"
      right={data?.hasCoverage && <span className="badge" style={{ color: toneColor(data.consensus.label), background: 'var(--color-bg-elevated)' }}>{data.consensus.label}</span>}>
      {loading && <SkeletonLines lines={3} />}
      {error && <div className="error-banner">{error}</div>}
      {data && !data.hasCoverage && <div className="empty" style={{ padding: 18 }}>No analyst coverage available for {data.symbol}.</div>}

      {data?.hasCoverage && latest && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: toneColor(data.consensus.label) }}>{data.consensus.label}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{data.consensus.score.toFixed(2)}/5 · {total} analyst{total === 1 ? '' : 's'}</span>
          </div>

          {/* Distribution stacked bar */}
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            {SEGMENTS.map((s) => {
              const n = (latest as any)[s.key] as number;
              const w = total ? (n / total) * 100 : 0;
              return w > 0 ? <div key={s.key} title={`${s.label}: ${n}`} style={{ width: `${w}%`, background: s.color, opacity: s.opacity }} /> : null;
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            {SEGMENTS.map((s) => (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, opacity: s.opacity, display: 'inline-block' }} />
                {s.label} <b style={{ color: 'var(--color-text-primary)' }}>{(latest as any)[s.key]}</b>
              </span>
            ))}
          </div>

          {/* 6-month sentiment trend */}
          {data.history.length > 1 && (
            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Trend (last {data.history.length} mo)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                {data.history.map((h) => {
                  const t = h.strongBuy + h.buy + h.hold + h.sell + h.strongSell || 1;
                  const bull = ((h.strongBuy + h.buy) / t) * 100;
                  const neutral = (h.hold / t) * 100;
                  const bear = ((h.sell + h.strongSell) / t) * 100;
                  return (
                    <div key={h.period} style={{ flex: 1, textAlign: 'center' }} title={`${h.period}: ${h.consensus.label}`}>
                      <div style={{ height: 46, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ height: `${bull}%`, background: 'var(--color-up)' }} />
                        <div style={{ height: `${neutral}%`, background: 'var(--color-text-muted)', opacity: 0.5 }} />
                        <div style={{ height: `${bear}%`, background: 'var(--color-down)' }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>{monthAbbr(h.period)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ color: 'var(--color-text-muted)', fontSize: 11, marginTop: 14 }}>
            Ratings via Finnhub · numeric price targets require a paid plan · not financial advice
          </div>
        </div>
      )}
    </Card>
  );
}
