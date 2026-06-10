import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { Fundamentals as FData } from '../lib/models';
import Card from './Card';
import { SkeletonLines } from './Skeleton';

function fmtUSD(v: number | null): string {
  if (v == null) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString()}`;
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 78, h = 22, min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / r) * (h - 3) - 1.5}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return <svg width={w} height={h} style={{ overflow: 'visible' }}><polyline points={pts} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}

export default function Fundamentals({ symbol }: { symbol: string }) {
  const [data, setData] = useState<FData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    getJSON<FData>(`/api/fundamentals/${encodeURIComponent(symbol)}`).then(setData).catch((e) => setError(e.message));
  }, [symbol]);

  return (
    <Card className="col-span-2" title="Fundamentals" sub={data?.available ? `SEC filings · FY${data.asOfFY}` : 'SEC filings'}>
      {error ? <div className="error-banner">{error}</div>
        : !data ? <SkeletonLines lines={6} />
        : !data.available ? <div className="empty" style={{ border: 'none' }}>{data.reason}</div>
        : (
          <div>
            <div className="fund-ratios">
              {data.ratios!.map((r) => (
                <div key={r.label} className="fund-ratio">
                  <div className="fund-ratio-val">{r.unit === '%' ? `${r.value}%` : `${r.value}×`}</div>
                  <div className="fund-ratio-lbl">{r.label}</div>
                </div>
              ))}
            </div>
            <table className="mtable" style={{ marginTop: 14 }}>
              <thead><tr><th>Line item</th><th className="num">FY{data.asOfFY}</th><th className="num">6-yr trend</th></tr></thead>
              <tbody>
                {data.lineItems!.map((li) => (
                  <tr key={li.key} style={{ cursor: 'default' }}>
                    <td>{li.label}</td>
                    <td className="num">{li.unit === 'perShare' ? (li.latest != null ? `$${li.latest.toFixed(2)}` : '—') : fmtUSD(li.latest)}</td>
                    <td className="num"><Spark values={li.history.map((p) => p.val)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>Source: {data.source} · CIK {data.cik}</div>
          </div>
        )}
    </Card>
  );
}
