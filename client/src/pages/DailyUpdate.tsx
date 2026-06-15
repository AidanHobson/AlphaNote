import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { MarketBrief, MoverItem, Regime, NewsArticle, CommodityItem, RiskBoard } from '../lib/models';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import MarketTable from '../components/MarketTable';
import AIText from '../components/AIText';
import DigestCard from '../components/DigestCard';
import Skeleton, { SkeletonLines } from '../components/Skeleton';
import { formatPct, formatPrice, changeDir, arrow, timeAgo } from '../lib/format';

const Chart = lazy(() => import('../components/Chart'));

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
const regimeColor = (label: string) =>
  label === 'Risk-on' ? cssVar('--color-up') : label === 'Risk-off' ? cssVar('--color-down') : cssVar('--color-warn');
const stressColor = (p: number) => (p >= 60 ? 'var(--color-down)' : p <= 35 ? 'var(--color-up)' : 'var(--color-warn)');

export default function DailyUpdate() {
  const [tab, setTab] = useState('Live');
  const [movers, setMovers] = useState<MoverItem[] | null>(null);
  const [regime, setRegime] = useState<Regime | null>(null);
  const [brief, setBrief] = useState<{ loading: boolean; data?: MarketBrief; error?: string }>({ loading: true });
  const [news, setNews] = useState<NewsArticle[] | null>(null);
  const [commodities, setCommodities] = useState<CommodityItem[] | null>(null);
  const [risk, setRisk] = useState<RiskBoard | null>(null);
  const [moversError, setMoversError] = useState('');

  useEffect(() => {
    getJSON<{ items: MoverItem[]; regime: Regime }>('/api/market/movers')
      .then((d) => { setMovers(d.items); setRegime(d.regime); })
      .catch((e) => setMoversError(e.message));
    getJSON<MarketBrief>('/api/market/brief')
      .then((data) => setBrief({ loading: false, data }))
      .catch((e) => setBrief({ loading: false, error: e.message }));
    getJSON<{ articles: NewsArticle[] }>('/api/news').then((d) => setNews(d.articles)).catch(() => setNews([]));
    getJSON<{ items: CommodityItem[] }>('/api/market/commodities').then((d) => setCommodities(d.items)).catch(() => setCommodities([]));
    getJSON<RiskBoard>('/api/risk').then(setRisk).catch(() => setRisk(null));
  }, []);

  const moversBar = (items: MoverItem[]) => {
    const sorted = [...items].sort((a, b) => a.changePercent - b.changePercent);
    return [{
      type: 'bar', orientation: 'h',
      x: sorted.map((m) => m.changePercent),
      y: sorted.map((m) => m.symbol),
      text: sorted.map((m) => formatPct(m.changePercent)),
      textposition: 'auto',
      hovertemplate: '%{y}: %{x:.2f}%<extra></extra>',
      marker: { color: sorted.map((m) => (m.changePercent >= 0 ? cssVar('--color-up') : cssVar('--color-down'))) },
    }];
  };

  return (
    <div>
      <div className="page-head">
        <h1>Daily Update</h1>
        <p>Today's market regime, an AI narrative pulse, and cross-sectional returns.</p>
      </div>

      <DigestCard />

      <Tabs tabs={['Live', 'Movers', 'News']} active={tab} onChange={setTab} />

      {tab === 'Live' && (
        <div className="grid grid-3">
          {/* Regime */}
          <Card title="Market regime" sub="breadth read">
            {!regime ? <SkeletonLines lines={3} /> : (
              <div>
                <div className="regime-chip">
                  <span className="regime-dot" style={{ background: regimeColor(regime.label) }} />
                  {regime.label}
                </div>
                <div style={{ color: 'var(--color-text-secondary)', marginTop: 10, fontSize: 13 }}>
                  {regime.advancers} up · {regime.decliners} down of {regime.total}<br />
                  Breadth {(regime.breadth * 100).toFixed(0)}% · avg {formatPct(regime.avgChange)}
                </div>
                {risk && (
                  <Link to="/risk" className="risk-posture" title="Open the Risk Monitor">
                    <span style={{ color: 'var(--color-text-muted)' }}>Risk Monitor</span>
                    <span><b style={{ color: stressColor(risk.overall) }}>{risk.label}</b> <span style={{ color: 'var(--color-text-muted)' }}>{risk.overall}/100 →</span></span>
                  </Link>
                )}
              </div>
            )}
          </Card>

          {/* Narrative pulse (AI) */}
          <Card
            className="col-span-2"
            title="Narrative Pulse"
            sub="AI"
            right={brief.data && <span className="pill accent">{brief.data.provider}{brief.data.fellBack ? ' (fallback)' : ''}</span>}
          >
            {brief.loading && <SkeletonLines lines={4} />}
            {brief.error && <div className="error-banner">{brief.error}</div>}
            {brief.data && <div className="ai-body" style={{ padding: 0 }}><AIText text={brief.data.text} /></div>}
            {brief.data && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 8 }}>AI-generated · not financial advice</div>}
          </Card>

          {/* Movers chart */}
          <Card className="col-span-2" title="Cross-sectional returns" sub="today %">
            {!movers ? <Skeleton height={300} /> : (
              <Suspense fallback={<Skeleton height={300} />}>
                <Chart data={moversBar(movers)} height={Math.max(280, movers.length * 22)} layout={{ xaxis: { ticksuffix: '%' } }} />
              </Suspense>
            )}
          </Card>

          {/* Equities table */}
          <Card title="Equities" sub={movers ? `${movers.length} names` : ''}>
            {moversError ? <div className="error-banner">{moversError}</div>
              : !movers ? <SkeletonLines lines={6} />
              : <MarketTable items={movers.slice(0, 15)} showCap={false} />}
          </Card>

          {/* Commodities (ETF-proxy day moves) */}
          <Card className="col-span-3" title="Commodities" sub={commodities ? `${commodities.length} via ETF proxies` : ''}>
            {!commodities ? <Skeleton height={120} />
              : commodities.length === 0 ? <div className="empty">Commodities unavailable right now.</div>
              : (
                <div className="commodity-grid">
                  {commodities.map((c) => (
                    <div key={c.symbol} className="commodity-tile">
                      <div className="commodity-label">{c.label}</div>
                      <div className="commodity-row">
                        <span className="commodity-price">{formatPrice(c.price)}</span>
                        <span className={`badge ${changeDir(c.changePercent)}`}>{arrow(c.changePercent)} {formatPct(c.changePercent)}</span>
                      </div>
                      <div className="commodity-sym">{c.symbol}</div>
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </div>
      )}

      {tab === 'Movers' && (
        <div className="grid grid-2">
          <Card title="Returns ranking" sub="basket, today %">
            {!movers ? <Skeleton height={420} /> : (
              <Suspense fallback={<Skeleton height={420} />}>
                <Chart data={moversBar(movers)} height={Math.max(360, movers.length * 24)} layout={{ xaxis: { ticksuffix: '%' } }} />
              </Suspense>
            )}
          </Card>
          <Card title="All movers">
            {!movers ? <SkeletonLines lines={10} /> : <MarketTable items={movers} />}
          </Card>
        </div>
      )}

      {tab === 'News' && (
        <Card title="Market news" sub="live via Finnhub">
          {!news ? <SkeletonLines lines={8} /> : news.length === 0 ? <div className="empty">No news right now.</div> : (
            <div>
              {news.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" className="note-row" style={{ textDecoration: 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span className="pill">{a.source}</span>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{timeAgo(a.datetime)}</span>
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{a.headline}</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{a.summary}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
