import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { MacroBoard, MacroBrief, MacroGroup, MacroItem } from '../lib/models';
import Card from '../components/Card';
import AIText from '../components/AIText';
import Skeleton, { SkeletonLines } from '../components/Skeleton';
import { formatPrice, formatPct, changeDir, arrow } from '../lib/format';

const Chart = lazy(() => import('../components/Chart'));
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
const toneColor = (t: string) => (t === 'Risk-on' ? cssVar('--color-up') : t === 'Risk-off' ? cssVar('--color-down') : cssVar('--color-warn'));

export default function Macro() {
  const [board, setBoard] = useState<MacroBoard | null>(null);
  const [boardErr, setBoardErr] = useState('');
  const [brief, setBrief] = useState<{ loading: boolean; data?: MacroBrief; error?: string }>({ loading: true });

  useEffect(() => {
    getJSON<MacroBoard>('/api/macro').then(setBoard).catch((e) => setBoardErr(e.message));
    getJSON<MacroBrief>('/api/macro/brief').then((data) => setBrief({ loading: false, data })).catch((e) => setBrief({ loading: false, error: e.message }));
  }, []);

  const allItems = board ? board.groups.flatMap((g) => g.items).filter((i) => i.price > 0) : [];
  const bar = () => {
    const sorted = [...allItems].sort((a, b) => a.changePercent - b.changePercent);
    return [{
      type: 'bar', orientation: 'h',
      x: sorted.map((m) => m.changePercent), y: sorted.map((m) => m.label),
      text: sorted.map((m) => formatPct(m.changePercent)), textposition: 'auto',
      hovertemplate: '%{y}: %{x:.2f}%<extra></extra>',
      marker: { color: sorted.map((m) => (m.changePercent >= 0 ? cssVar('--color-up') : cssVar('--color-down'))) },
    }];
  };

  return (
    <div>
      <div className="page-head">
        <h1>Macro</h1>
        <p>Cross-asset dashboard — equities, rates &amp; credit, FX, commodities, and crypto (liquid ETF proxies).</p>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Card title="Cross-asset tone" sub="computed">
          {!board ? <SkeletonLines lines={3} /> : (
            <div>
              <div className="regime-chip"><span className="regime-dot" style={{ background: toneColor(board.tone.tone) }} />{board.tone.tone}</div>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 10, fontSize: 13, lineHeight: 1.7 }}>
                Equities {formatPct(board.tone.equities)} · Gold {formatPct(board.tone.gold)}<br />
                20Y+ Treasuries {formatPct(board.tone.tlt)} · USD {formatPct(board.tone.dollar)}<br />
                Oil {formatPct(board.tone.oil)} · High-yield {formatPct(board.tone.hyg)}
              </div>
            </div>
          )}
        </Card>

        <Card className="col-span-2" title="Macro Read" sub="AI"
          right={brief.data && <span className="pill accent">{brief.data.provider}{brief.data.fellBack ? ' (fallback)' : ''}</span>}>
          {brief.loading && <SkeletonLines lines={4} />}
          {brief.error && <div className="error-banner">{brief.error}</div>}
          {brief.data && <div className="ai-body" style={{ padding: 0 }}><AIText text={brief.data.text} /></div>}
          {brief.data && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>AI-generated · ETF proxies, not the underlying · not financial advice</div>}
        </Card>
      </div>

      <Card title="Cross-asset returns" sub="today %" style={{ marginBottom: 16 }}>
        {boardErr ? <div className="error-banner">{boardErr}</div>
          : !board ? <Skeleton height={420} />
          : (
            <Suspense fallback={<Skeleton height={420} />}>
              <Chart data={bar()} height={Math.max(360, allItems.length * 24)} layout={{ xaxis: { ticksuffix: '%' }, margin: { l: 130, r: 18, t: 10, b: 30 } }} />
            </Suspense>
          )}
      </Card>

      <div className="grid grid-3">
        {!board ? Array.from({ length: 3 }).map((_, i) => <Card key={i} title="…"><SkeletonLines lines={4} /></Card>)
          : board.groups.map((g) => <GroupTable key={g.name} group={g} />)}
      </div>
    </div>
  );
}

function GroupTable({ group }: { group: MacroGroup }) {
  const nav = useNavigate();
  return (
    <Card title={group.name}>
      <table className="mtable">
        <thead><tr><th>Asset</th><th className="num">Price</th><th className="num">Change</th></tr></thead>
        <tbody>
          {group.items.map((it: MacroItem) => {
            const dir = changeDir(it.changePercent);
            return (
              <tr key={it.symbol} onClick={() => nav(`/explorer?symbol=${encodeURIComponent(it.symbol)}`)}>
                <td><div style={{ fontWeight: 700 }}>{it.symbol}</div><div className="nm" style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{it.label}</div></td>
                <td className="num">{formatPrice(it.price)}</td>
                <td className="num"><span className={`badge ${dir}`}>{arrow(it.changePercent)} {formatPct(it.changePercent)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
