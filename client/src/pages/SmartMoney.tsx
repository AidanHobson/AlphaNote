import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { SmartManager, SmartBoard } from '../lib/models';
import Card from '../components/Card';
import { SkeletonLines } from '../components/Skeleton';

const fmtB = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);

function ChangeBadge({ c }: { c: NonNullable<SmartBoard['holdings']>[number]['change'] }) {
  if (c.type === 'new') return <span className="badge up">NEW</span>;
  if (c.type === 'add') return <span className="badge up">▲ +{c.sharesPct}%</span>;
  if (c.type === 'trim') return <span className="badge down">▼ {c.sharesPct}%</span>;
  return <span className="badge flat">— flat</span>;
}

export default function SmartMoney() {
  const [managers, setManagers] = useState<SmartManager[] | null>(null);
  const [cik, setCik] = useState<number | null>(null);
  const [board, setBoard] = useState<SmartBoard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getJSON<{ managers: SmartManager[] }>('/api/smartmoney')
      .then((d) => { setManagers(d.managers); setCik(d.managers[0]?.cik ?? null); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (cik == null) return;
    setBoard(null); setError('');
    getJSON<SmartBoard>(`/api/smartmoney/${cik}`).then(setBoard).catch((e) => setError(e.message));
  }, [cik]);

  return (
    <div>
      <div className="page-head">
        <h1>Smart Money</h1>
        <p>Institutional portfolios from SEC 13F filings — what well-known managers held last quarter, and what changed. Filed up to 45 days after quarter-end.</p>
      </div>

      {managers && (
        <div className="mgr-pills">
          {managers.map((m) => (
            <button key={m.cik} className={`mgr-pill ${m.cik === cik ? 'active' : ''}`} onClick={() => setCik(m.cik)}>
              {m.short}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {!board && !error && <Card><SkeletonLines lines={8} /></Card>}
      {board && !board.available && <Card><div className="empty" style={{ border: 'none' }}>{board.reason}</div></Card>}

      {board && board.available && (
        <div>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <Card title="Reported portfolio" sub={`as of ${board.period}`}>
              <div className="vval" style={{ fontSize: 28 }}>{fmtB(board.totalValue!)}</div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 4 }}>{board.positions} long positions</div>
            </Card>
            <Card title="Quarter changes" sub={board.priorPeriod ? `vs ${board.priorPeriod}` : 'no prior filing'}>
              <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                <b style={{ color: 'var(--color-up)' }}>{board.holdings!.filter((h) => h.change.type === 'new').length} new</b> ·{' '}
                <b style={{ color: 'var(--color-up)' }}>{board.holdings!.filter((h) => h.change.type === 'add').length} added</b> ·{' '}
                <b style={{ color: 'var(--color-down)' }}>{board.holdings!.filter((h) => h.change.type === 'trim').length} trimmed</b> ·{' '}
                <b style={{ color: 'var(--color-down)' }}>{board.exits!.length} exits</b>
              </div>
              {board.exits!.length > 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 8 }}>
                  Exited: {board.exits!.slice(0, 4).map((e) => e.name).join(' · ')}
                </div>
              )}
            </Card>
            <Card title="About" sub="13F caveats">
              <div style={{ color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                Long US share positions only (no shorts, puts/calls, or non-US holdings). Reported with up to a 45-day lag — positions may have changed since.
              </div>
            </Card>
          </div>

          <Card title={`Top holdings — ${board.manager!.name}`} sub={`top ${board.holdings!.length} by value`}>
            <table className="mtable">
              <thead><tr><th>Holding</th><th className="num">Value</th><th className="num">% of portfolio</th><th className="num">Shares</th><th className="num">QoQ</th></tr></thead>
              <tbody>
                {board.holdings!.map((h, i) => (
                  <tr key={`${h.name}-${i}`} style={{ cursor: 'default' }}>
                    <td>
                      {h.ticker
                        ? <Link to={`/explorer?symbol=${encodeURIComponent(h.ticker)}`} style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{h.ticker}</Link>
                        : <span style={{ fontWeight: 700 }}>—</span>}
                      <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{h.name}</div>
                    </td>
                    <td className="num">{fmtB(h.value)}</td>
                    <td className="num">{h.pct}%</td>
                    <td className="num">{h.shares.toLocaleString()}</td>
                    <td className="num"><ChangeBadge c={h.change} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>{board.source}</div>
          </Card>
        </div>
      )}
    </div>
  );
}
