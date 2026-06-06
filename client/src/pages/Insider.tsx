import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { InsiderResponse, InsiderTxn } from '../lib/models';
import Card from '../components/Card';
import { SkeletonLines } from '../components/Skeleton';
import { toast } from '../components/toast';
import { formatMarketCap } from '../lib/format';

const fmtDate = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtShares = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(2) + 'K' : String(n));
const fmtUSD = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--color-bg-elevated)', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className="btn sm"
          style={{ border: 'none', background: o === value ? 'var(--color-accent)' : 'transparent', color: o === value ? '#fff' : 'var(--color-text-secondary)' }}>
          {o}
        </button>
      ))}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{label}</span>
    {children}
  </div>
);
const inputStyle: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'inherit', fontSize: 13, width: '100%' };

export default function Insider() {
  const [data, setData] = useState<InsiderResponse | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('Transactions');
  const [days, setDays] = useState('30 Days');
  const [side, setSide] = useState('All');
  const [plan, setPlan] = useState('All Plans');
  const [role, setRole] = useState('Any Role');
  const [excludePE, setExcludePE] = useState(false);
  const [ticker, setTicker] = useState('');
  const [insider, setInsider] = useState('');
  const [capMin, setCapMin] = useState('');
  const [capMax, setCapMax] = useState('');
  const [minDollar, setMinDollar] = useState('');

  useEffect(() => {
    getJSON<InsiderResponse>('/api/insider').then(setData).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const nDays = days === '7 Days' ? 7 : days === '90 Days' ? 90 : days === '1Y' ? 365 : days === 'All' ? 100000 : 30;
    const cutoff = new Date(Date.now() - nDays * 86400000).toISOString().slice(0, 10);
    const tickers = ticker.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const name = insider.trim().toLowerCase();
    const cMin = parseFloat(capMin), cMax = parseFloat(capMax), mDol = parseFloat(minDollar);
    return data.transactions.filter((t) => {
      if ((t.filingDate || '') < cutoff) return false;
      if (side === 'Buys' && t.side !== 'Buy') return false;
      if (side === 'Sells' && t.side !== 'Sell') return false;
      if (plan === 'Discretionary' && t.plan !== 'Discretionary') return false;
      if (plan === '10b5-1' && t.plan !== '10b5-1') return false;
      if (role === 'Officers' && !t.isOfficer) return false;
      if (role === 'Directors' && !t.isDirector) return false;
      if (excludePE && t.isTenPercent) return false;
      if (tickers.length && !tickers.includes(t.symbol)) return false;
      if (name && !t.insider.toLowerCase().includes(name)) return false;
      const capUsd = t.marketCap * 1e6;
      if (!Number.isNaN(cMin) && capUsd < cMin) return false;
      if (!Number.isNaN(cMax) && capUsd > cMax) return false;
      if (!Number.isNaN(mDol) && t.value < mDol) return false;
      return true;
    });
  }, [data, days, side, plan, role, excludePE, ticker, insider, capMin, capMax, minDollar]);

  const shown = filtered.slice(0, 500);
  const stats = useMemo(() => ({
    total: filtered.length,
    dollars: shown.reduce((s, t) => s + t.value, 0),
    buys: shown.filter((t) => t.side === 'Buy').length,
    sells: shown.filter((t) => t.side === 'Sell').length,
    tickers: new Set(shown.map((t) => t.symbol)).size,
  }), [filtered, shown]);

  const exportCsv = () => {
    const head = ['Filed', 'TxnDate', 'Symbol', 'Company', 'Sector', 'MktCapUSD', 'Insider', 'Title', 'Side', 'Plan', 'Shares', 'Price', 'Value'];
    const rows = filtered.map((t) => [t.filingDate, t.transactionDate, t.symbol, `"${t.company}"`, `"${t.sector}"`, Math.round(t.marketCap * 1e6), `"${t.insider}"`, `"${t.title}"`, t.side, t.plan, t.shares, t.price, t.value]);
    const csv = [head.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `alphanote-insider-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    toast(`Exported ${filtered.length} rows`);
  };

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1>Insider Explorer</h1>
          <p>Filter and sort Form 4 insider transactions (open-market buys &amp; sells) from recent SEC EDGAR filings. Discretionary view excludes scheduled 10b5-1 plan trades.</p>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>⤓ Export CSV</button>
      </div>

      <div style={{ marginBottom: 14 }}><Seg options={['Transactions', 'By Company', 'By Insider']} value={view} onChange={setView} /></div>

      <Card style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <Seg options={['7 Days', '30 Days', '90 Days', '1Y', 'All']} value={days} onChange={setDays} />
          <Seg options={['All', 'Buys', 'Sells']} value={side} onChange={setSide} />
          <Seg options={['All Plans', 'Discretionary', '10b5-1']} value={plan} onChange={setPlan} />
          <Seg options={['Any Role', 'Officers', 'Directors']} value={role} onChange={setRole} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={excludePE} onChange={(e) => setExcludePE(e.target.checked)} /> Exclude 10% holders
          </label>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Field label="Ticker (comma sep)"><input style={inputStyle} value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL, NVDA…" /></Field>
          <Field label="Insider name"><input style={inputStyle} value={insider} onChange={(e) => setInsider(e.target.value)} placeholder="Musk, Cook…" /></Field>
          <Field label="Mkt Cap Min ($)"><input style={inputStyle} value={capMin} onChange={(e) => setCapMin(e.target.value)} placeholder="e.g. 1e9" /></Field>
          <Field label="Mkt Cap Max ($)"><input style={inputStyle} value={capMax} onChange={(e) => setCapMax(e.target.value)} placeholder="e.g. 1e11" /></Field>
          <Field label="Min $ / Trade"><input style={inputStyle} value={minDollar} onChange={(e) => setMinDollar(e.target.value)} placeholder="e.g. 100000" /></Field>
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 12 }}>
          Market-wide from SEC EDGAR (most recent Form 4 filing per issuer). Market cap &amp; sector are best-effort; a “—” means no profile match.
        </div>
      </Card>

      {error && <div className="error-banner">{error}</div>}
      {!data && !error && (
        <Card>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 12 }}>
            Scanning market-wide Form 4 filings from SEC EDGAR… the first load can take ~30s (then it's cached).
          </div>
          <SkeletonLines lines={8} />
        </Card>
      )}

      {data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 16 }}>
            <StatCard value={stats.total.toLocaleString()} label={`Total (${shown.length} shown)`} />
            <StatCard value={fmtUSD(stats.dollars)} label="$ on page" color="var(--color-text-primary)" />
            <StatCard value={String(stats.buys)} label="Buys" color="var(--color-up)" />
            <StatCard value={String(stats.sells)} label="Sells" color="var(--color-down)" />
            <StatCard value={String(stats.tickers)} label="Tickers" color="var(--color-accent)" />
          </div>

          {view === 'Transactions' && <TxnTable rows={shown} />}
          {view === 'By Company' && <CompanyTable rows={filtered} />}
          {view === 'By Insider' && <InsiderTable rows={filtered} />}
        </>
      )}
    </div>
  );
}

const StatCard = ({ value, label, color }: { value: string; label: string; color?: string }) => (
  <Card style={{ textAlign: 'center', padding: '16px 12px' }}>
    <div style={{ fontSize: 24, fontWeight: 800, color: color || 'var(--color-text-primary)' }}>{value}</div>
    <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 2 }}>{label}</div>
  </Card>
);

const SideBadge = ({ side }: { side: string }) => (
  <span className={`badge ${side === 'Buy' ? 'up' : 'down'}`} style={{ borderRadius: 6 }}>{side}</span>
);

function TxnTable({ rows }: { rows: InsiderTxn[] }) {
  const nav = useNavigate();
  if (!rows.length) return <div className="empty"><strong>No transactions match your filters</strong>Try widening the window or clearing filters.</div>;
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table className="mtable" style={{ minWidth: 1180 }}>
        <thead><tr>
          <th>Filed</th><th>Txn</th><th>Symbol</th><th>Company</th><th>Sector</th><th className="num">Mkt Cap</th><th>Insider</th><th>Title</th><th>Side</th><th>Plan</th><th className="num">Shares</th><th className="num">Price</th><th className="num">Value</th>
        </tr></thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={`${t.id}-${i}`} onClick={() => nav(`/explorer?symbol=${encodeURIComponent(t.symbol)}`)}>
              <td>{fmtDate(t.filingDate)}</td>
              <td style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(t.transactionDate)}</td>
              <td style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{t.symbol}</td>
              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.company}</td>
              <td style={{ color: 'var(--color-text-secondary)' }}>{t.sector || '—'}</td>
              <td className="num">{formatMarketCap(t.marketCap)}</td>
              <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.insider}</td>
              <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>{t.title}</td>
              <td><SideBadge side={t.side} /></td>
              <td><span className="pill" style={{ color: t.plan === '10b5-1' ? 'var(--color-warn)' : 'var(--color-text-secondary)' }}>{t.plan}</span></td>
              <td className="num">{fmtShares(t.shares)}</td>
              <td className="num">{t.price ? `$${t.price.toFixed(2)}` : '—'}</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmtUSD(t.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CompanyTable({ rows }: { rows: InsiderTxn[] }) {
  const nav = useNavigate();
  const groups = useMemo(() => {
    const m = new Map<string, { symbol: string; company: string; sector: string; marketCap: number; n: number; buy: number; sell: number }>();
    for (const t of rows) {
      const g = m.get(t.symbol) || { symbol: t.symbol, company: t.company, sector: t.sector, marketCap: t.marketCap, n: 0, buy: 0, sell: 0 };
      g.n++; if (t.side === 'Buy') g.buy += t.value; else g.sell += t.value;
      m.set(t.symbol, g);
    }
    return [...m.values()].sort((a, b) => b.buy + b.sell - (a.buy + a.sell));
  }, [rows]);
  if (!groups.length) return <div className="empty">No data.</div>;
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table className="mtable" style={{ minWidth: 720 }}>
        <thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th className="num">Txns</th><th className="num">$ Bought</th><th className="num">$ Sold</th><th className="num">Net</th></tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.symbol} onClick={() => nav(`/explorer?symbol=${encodeURIComponent(g.symbol)}`)}>
              <td style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{g.symbol}</td>
              <td>{g.company}</td><td style={{ color: 'var(--color-text-secondary)' }}>{g.sector || '—'}</td>
              <td className="num">{g.n}</td>
              <td className="num" style={{ color: 'var(--color-up)' }}>{g.buy ? fmtUSD(g.buy) : '—'}</td>
              <td className="num" style={{ color: 'var(--color-down)' }}>{g.sell ? fmtUSD(g.sell) : '—'}</td>
              <td className="num" style={{ fontWeight: 700, color: g.buy - g.sell >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>{fmtUSD(g.buy - g.sell)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function InsiderTable({ rows }: { rows: InsiderTxn[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { insider: string; n: number; tickers: Set<string>; buy: number; sell: number }>();
    for (const t of rows) {
      const g = m.get(t.insider) || { insider: t.insider, n: 0, tickers: new Set<string>(), buy: 0, sell: 0 };
      g.n++; g.tickers.add(t.symbol); if (t.side === 'Buy') g.buy += t.value; else g.sell += t.value;
      m.set(t.insider, g);
    }
    return [...m.values()].sort((a, b) => b.buy + b.sell - (a.buy + a.sell));
  }, [rows]);
  if (!groups.length) return <div className="empty">No data.</div>;
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table className="mtable" style={{ minWidth: 680 }}>
        <thead><tr><th>Insider</th><th className="num">Txns</th><th>Tickers</th><th className="num">$ Bought</th><th className="num">$ Sold</th></tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.insider}>
              <td style={{ fontWeight: 600 }}>{g.insider}</td>
              <td className="num">{g.n}</td>
              <td style={{ color: 'var(--color-text-secondary)' }}>{[...g.tickers].join(', ')}</td>
              <td className="num" style={{ color: 'var(--color-up)' }}>{g.buy ? fmtUSD(g.buy) : '—'}</td>
              <td className="num" style={{ color: 'var(--color-down)' }}>{g.sell ? fmtUSD(g.sell) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
