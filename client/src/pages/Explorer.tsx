import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { Quote, Profile } from '../lib/models';
import Card from '../components/Card';
import TradingView from '../components/TradingView';
import AIInsight from '../components/AIInsight';
import AnalystRatings from '../components/AnalystRatings';
import WatchlistButton from '../components/WatchlistButton';
import Skeleton from '../components/Skeleton';
import { formatPrice, formatPct, changeDir, arrow, formatMarketCap } from '../lib/format';
import { ADVANCED_CHART, TECHNICAL, SYMBOL_PROFILE, FINANCIALS } from '../lib/tvConfigs';

export default function Explorer() {
  const [params] = useSearchParams();
  const symbol = (params.get('symbol') || '').toUpperCase().trim();
  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const [hero, setHero] = useState<{ quote?: Quote; profile?: Profile; error?: string } | null>(null);
  const [consensus, setConsensus] = useState<{ label: string; total: number } | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setHero(null);
    setConsensus(null);
    Promise.all([
      getJSON<{ quote: Quote }>(`/api/quote/${encodeURIComponent(symbol)}`),
      getJSON<{ profile: Profile }>(`/api/profile/${encodeURIComponent(symbol)}`),
    ])
      .then(([q, p]) => setHero({ quote: q.quote, profile: p.profile }))
      .catch((e) => setHero({ error: e.message }));
  }, [symbol]);

  const cfgChart = useMemo(() => ADVANCED_CHART(symbol, theme), [symbol, theme]);

  if (!symbol) {
    return <div className="empty"><strong>No asset selected</strong>Use the search bar above to look up a ticker or company.</div>;
  }

  const dir = hero?.quote ? changeDir(hero.quote.dp) : 'flat';

  return (
    <div>
      <Link to="/daily-update" className="nav-item" style={{ display: 'inline-flex', marginBottom: 12, padding: '4px 8px' }}>← Markets</Link>

      <Card style={{ marginBottom: 16 }}>
        {!hero ? <Skeleton height={48} /> : hero.error ? <div className="error-banner">{hero.error}</div> : (
          <div className="stock-hero">
            {hero.profile?.logo && <img src={hero.profile.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
            <div>
              <h1>{symbol}</h1>
              <div className="nm">{hero.profile?.name}{hero.profile?.exchange ? ` · ${hero.profile.exchange}` : ''}{hero.profile?.finnhubIndustry ? ` · ${hero.profile.finnhubIndustry}` : ''}</div>
            </div>
            <div style={{ marginLeft: 16 }}>
              <div className="px">{formatPrice(hero.quote?.c, hero.profile?.currency)}</div>
              <span className={`badge ${dir}`}>{arrow(hero.quote?.dp)} {formatPct(hero.quote?.dp)} ({formatPrice(hero.quote?.d, hero.profile?.currency)})</span>
            </div>
            <div className="actions">
              <Link to={`/notes?symbol=${encodeURIComponent(symbol)}`} className="btn">✎ Add note</Link>
              <WatchlistButton symbol={symbol} />
            </div>
          </div>
        )}
        {hero?.profile && (
          <div className="row" style={{ marginTop: 14, gap: 24, color: 'var(--color-text-secondary)', fontSize: 13 }}>
            <div><span style={{ color: 'var(--color-text-muted)' }}>Mkt cap</span> &nbsp;{formatMarketCap(hero.profile.marketCapitalization)}</div>
            <div><span style={{ color: 'var(--color-text-muted)' }}>Day range</span> &nbsp;{formatPrice(hero.quote?.l)} – {formatPrice(hero.quote?.h)}</div>
            <div><span style={{ color: 'var(--color-text-muted)' }}>Prev close</span> &nbsp;{formatPrice(hero.quote?.pc)}</div>
            {hero.profile.country && <div><span style={{ color: 'var(--color-text-muted)' }}>Country</span> &nbsp;{hero.profile.country}</div>}
            {consensus && <div><span style={{ color: 'var(--color-text-muted)' }}>Analysts</span> &nbsp;<b style={{ color: /Buy/.test(consensus.label) ? 'var(--color-up)' : /Sell/.test(consensus.label) ? 'var(--color-down)' : 'var(--color-warn)' }}>{consensus.label}</b> ({consensus.total})</div>}
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <div className="grid" style={{ gridTemplateColumns: '1fr', alignContent: 'start' }}>
          <Card title="Price chart" sub="TradingView"><TradingView scriptName="advanced-chart" config={cfgChart} height={420} /></Card>
          <Card title="Technicals"><TradingView scriptName="technical-analysis" config={TECHNICAL(symbol, theme)} height={380} /></Card>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr', alignContent: 'start' }}>
          <AIInsight symbol={symbol} />
          <AnalystRatings symbol={symbol} onConsensus={(label, total) => setConsensus({ label, total })} />
          <Card title="Company profile"><TradingView scriptName="symbol-profile" config={SYMBOL_PROFILE(symbol, theme)} height={390} /></Card>
          <Card title="Financials"><TradingView scriptName="financials" config={FINANCIALS(symbol, theme)} height={430} /></Card>
        </div>
      </div>
    </div>
  );
}
