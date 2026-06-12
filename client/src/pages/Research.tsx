import { useEffect, useReducer, useState } from 'react';
import { getJSON, postJSON } from '../lib/api';
import type { ResearchNote, OutlookNote, BuzzBoard, BuzzBrief, PredictionsBoard } from '../lib/models';
import AIText from '../components/AIText';
import Card from '../components/Card';
import Tabs from '../components/Tabs';
import { SkeletonLines } from '../components/Skeleton';
import { isInWatchlist, toggleWatchlist, onStorageChange } from '../lib/storage';
import { toast } from '../components/toast';

const providerLabel = (p: string) => ({ claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' }[p] || p);

const MODES = ['Deep research', 'Speculative outlook'];
const RESEARCH_PILLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'JPM', 'XOM'];
const OUTLOOK_PILLS = ['Photonics', 'Robotics', 'Energy', 'AI Infrastructure', 'Quantum Computing', 'Space', 'Defense Tech', 'GLP-1'];

export default function Research() {
  const [mode, setMode] = useState(MODES[0]);
  const isOutlook = mode === MODES[1];

  const [input, setInput] = useState('');
  const [note, setNote] = useState<ResearchNote | null>(null);
  const [outlook, setOutlook] = useState<OutlookNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [buzz, setBuzz] = useState<BuzzBoard | null>(null);
  const [brief, setBrief] = useState<BuzzBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState('');

  const [predictions, setPredictions] = useState<PredictionsBoard | null>(null);
  const [, bumpWatch] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onStorageChange(bumpWatch), []);

  // Load the Reddit buzz board + crowd odds once, when the outlook tab opens.
  useEffect(() => {
    if (isOutlook && !buzz) getJSON<BuzzBoard>('/api/social/buzz').then(setBuzz).catch(() => {});
    if (isOutlook && !predictions) getJSON<PredictionsBoard>('/api/social/predictions').then(setPredictions).catch(() => {});
  }, [isOutlook, buzz, predictions]);

  // Jump from a board row into a Deep-research note (switches tab + runs).
  const deepDive = (symbol: string) => {
    if (loading) return;
    setMode(MODES[0]);
    setInput(symbol); setLoading(true); setError(''); setNote(null);
    postJSON<ResearchNote>('/api/ai/research', { symbol })
      .then(setNote)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const runBrief = (force = false) => {
    if (briefBusy) return;
    setBriefBusy(true); setBriefError('');
    postJSON<BuzzBrief>('/api/ai/buzz-brief', { force })
      .then(setBrief)
      .catch((e) => setBriefError(e.message))
      .finally(() => setBriefBusy(false));
  };

  const run = (raw: string, force = false) => {
    const topic = raw.trim();
    if (!topic || loading) return;
    setLoading(true); setError('');
    setInput(topic);
    if (isOutlook) {
      if (!force) setOutlook(null);
      postJSON<OutlookNote>('/api/ai/outlook', { topic, force })
        .then(setOutlook)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      if (!force) setNote(null);
      postJSON<ResearchNote>('/api/ai/research', { symbol: topic.toUpperCase(), force })
        .then(setNote)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  };

  const pills = isOutlook ? OUTLOOK_PILLS : RESEARCH_PILLS;
  const active = isOutlook ? outlook : note;

  return (
    <div>
      <div className="page-head">
        <h1>AI Analyst</h1>
        <p>
          {isOutlook
            ? 'Speculative outlooks on themes (Photonics, Robotics, Energy…) or single stocks — the forward-looking counterpart to the evidence-led research notes. Blends live data with the model’s general knowledge; speculation is labelled as such.'
            : 'Full research note on any US-listed stock — fundamentals trajectory and earnings quality from SEC filings, derived valuation multiples, price action vs SPY, analyst consensus, news flow, 13F positioning, and insider activity, synthesised into an evidence-led view.'}
        </p>
      </div>

      <Tabs tabs={MODES} active={mode} onChange={(m) => { setMode(m); setError(''); }} />

      <form
        className="research-bar"
        style={{ marginTop: 14 }}
        onSubmit={(e) => { e.preventDefault(); run(input); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isOutlook ? 'Theme or ticker, e.g. Photonics' : 'Enter a ticker, e.g. AAPL'}
          maxLength={isOutlook ? 60 : 12}
          style={isOutlook ? { textTransform: 'none' } : undefined}
          aria-label={isOutlook ? 'Theme or ticker' : 'Ticker symbol'}
        />
        <button className="btn primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Working…' : isOutlook ? 'Outlook' : 'Research'}
        </button>
      </form>

      <div className="mgr-pills" style={{ marginBottom: 16 }}>
        {pills.map((s) => (
          <button
            key={s}
            className={`mgr-pill ${(isOutlook ? outlook?.topic === s : note?.symbol === s) ? 'active' : ''}`}
            disabled={loading}
            onClick={() => run(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !active && (
        <div className="ai-panel">
          <div className="ai-head"><span className="spark">✦</span><h3>{isOutlook ? 'Drafting speculative outlook…' : 'Drafting research note…'}</h3></div>
          <div className="ai-body"><SkeletonLines lines={12} /></div>
        </div>
      )}

      {!isOutlook && note && (
        <div className="ai-panel">
          <div className="ai-head">
            {note.data.logo
              ? <img src={note.data.logo} alt="" style={{ width: 24, height: 24, borderRadius: 7 }} />
              : <span className="spark">✦</span>}
            <h3>{note.data.name} ({note.symbol})</h3>
            <span className={`badge ${note.data.change >= 0 ? 'up' : 'down'}`}>
              {note.data.price} {note.data.currency} · {note.data.changePercent != null ? note.data.changePercent.toFixed(2) : '0.00'}%
            </span>
            <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(note.provider)}</span>
            <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Regenerate (bypasses the 1h cache)"
              onClick={() => run(note.symbol, true)} disabled={loading}>↻</button>
          </div>
          <div className="ai-body" style={{ opacity: loading ? 0.5 : 1 }}>
            <AIText text={note.text} />
          </div>
          <div className="ai-foot">
            AI-generated · {providerLabel(note.provider)}{note.fellBack ? ' (primary unavailable)' : ''}
            {' · '}sources: live quote{note.data.hasFundamentals ? ', SEC EDGAR fundamentals + quarterly trend' : ''}
            {note.data.hasValuation ? ', derived multiples' : ''}
            {note.data.hasHistory ? ', 1Y price history vs SPY' : ''}, news, analyst ratings
            {(note.data.managers13F ?? 0) > 0 ? `, ${note.data.managers13F} 13F manager${(note.data.managers13F ?? 0) > 1 ? 's' : ''}` : ''}
            {note.data.insiderCount > 0 ? `, ${note.data.insiderCount} insider filing${note.data.insiderCount > 1 ? 's' : ''}` : ''}
            {note.data.nextEarnings ? ` · next earnings ${note.data.nextEarnings}` : ''}
            {' · '}generated {new Date(note.generatedAt).toLocaleTimeString()}{note.cached ? ' (cached)' : ''}
            {' · '}analysis, not investment advice
          </div>
        </div>
      )}

      {isOutlook && outlook && (
        <div className="ai-panel">
          <div className="ai-head">
            {outlook.mode === 'stock' && outlook.data.logo
              ? <img src={outlook.data.logo} alt="" style={{ width: 24, height: 24, borderRadius: 7 }} />
              : <span className="spark">✦</span>}
            <h3>{outlook.data.name}{outlook.mode === 'stock' ? ` (${outlook.topic.toUpperCase()})` : ''}</h3>
            <span className="badge flat">SPECULATIVE</span>
            {outlook.mode === 'stock' && outlook.data.price != null && (
              <span className={`badge ${(outlook.data.change ?? 0) >= 0 ? 'up' : 'down'}`}>
                {outlook.data.price} {outlook.data.currency} · {outlook.data.changePercent != null ? outlook.data.changePercent.toFixed(2) : '0.00'}%
              </span>
            )}
            <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(outlook.provider)}</span>
            <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Regenerate (bypasses the 1h cache)"
              onClick={() => run(outlook.topic, true)} disabled={loading}>↻</button>
          </div>
          <div className="ai-body" style={{ opacity: loading ? 0.5 : 1 }}>
            <AIText text={outlook.text} />
          </div>
          <div className="ai-foot">
            Speculative AI analysis · {providerLabel(outlook.provider)}{outlook.fellBack ? ' (primary unavailable)' : ''}
            {' · '}blends the model's general knowledge (which may be out of date) with {outlook.mode === 'stock' ? 'live market data' : 'no live market data'}
            {(outlook.data.social?.length ?? 0) > 0 ? ` + last-30-days signal (${outlook.data.social!.join(', ')})` : ''}
            {outlook.data.buzz ? ` · #${outlook.data.buzz.rank} on Reddit's finance subs this week (${outlook.data.buzz.mentions} mentions)` : ''}
            {' · '}verify tickers and figures in Deep research before acting
            {' · '}generated {new Date(outlook.generatedAt).toLocaleTimeString()}{outlook.cached ? ' (cached)' : ''}
            {' · '}not investment advice
          </div>
        </div>
      )}

      {!active && !loading && !error && !isOutlook && (
        <div className="empty">
          Pick a ticker above to generate an institutional-style research note.
        </div>
      )}

      {isOutlook && (
        buzz?.available && buzz.items.length ? (
          <>
            {briefError && <div className="error-banner" style={{ marginTop: 16 }}>{briefError}</div>}
            {(brief || briefBusy) && (
              <div className="ai-panel" style={{ marginTop: 16 }}>
                <div className="ai-head">
                  <span className="spark">✦</span>
                  <h3>Retail Pulse</h3>
                  <span className="badge flat">SPECULATIVE</span>
                  {brief && <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(brief.provider)}</span>}
                  {brief && (
                    <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Regenerate"
                      onClick={() => runBrief(true)} disabled={briefBusy}>↻</button>
                  )}
                </div>
                <div className="ai-body" style={{ opacity: briefBusy ? 0.5 : 1 }}>
                  {brief ? <AIText text={brief.text} /> : <SkeletonLines lines={8} />}
                </div>
                {brief && (
                  <div className="ai-foot">
                    AI-generated read of the board below · {providerLabel(brief.provider)} · attention data, not fundamentals · not investment advice
                  </div>
                )}
              </div>
            )}
            <Card
              title="Trending on Reddit"
              sub={`${buzz.subreddits.join(' · ')} — ${buzz.window} (${buzz.postsScanned} posts scanned) · click a ticker for its outlook`}
              style={{ marginTop: 16 }}
              right={!brief && !briefBusy
                ? <button className="btn sm primary" onClick={() => runBrief()}>✦ Retail Pulse</button>
                : undefined}
            >
              <table className="mtable">
                <thead><tr><th>#</th><th>Ticker</th><th className="num">Price</th><th>Top thread</th><th className="num">Mentions</th><th className="num">Today</th><th className="num">Engagement</th><th /></tr></thead>
                <tbody>
                  {buzz.items.slice(0, 12).map((b, i) => (
                    <tr key={b.symbol} role="button" tabIndex={0} title={`Speculative outlook on ${b.symbol}`}
                      onClick={() => !loading && run(b.symbol)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !loading) run(b.symbol); }}>
                      <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {i + 1}
                        {b.delta === 'new' && <span className="badge up" style={{ marginLeft: 5 }} title="Not on the board a day ago">NEW</span>}
                        {typeof b.delta === 'number' && b.delta !== 0 && (
                          <span className={b.delta > 0 ? 'badge up' : 'badge down'} style={{ marginLeft: 5 }} title="Rank change vs ~a day ago">
                            {b.delta > 0 ? `▲${b.delta}` : `▼${-b.delta}`}
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                        {b.symbol}{b.rising ? <span title="Accelerating in today's scan"> 🔥</span> : null}
                        {b.name && b.name !== b.symbol && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 400 }}>{b.name}</div>}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {b.quote
                          ? <>
                              {b.quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              <span className={b.quote.changePercent >= 0 ? 'badge up' : 'badge down'} style={{ marginLeft: 6 }}>
                                {b.quote.changePercent >= 0 ? '+' : ''}{b.quote.changePercent.toFixed(2)}%
                              </span>
                            </>
                          : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                      </td>
                      <td>
                        {b.topPost && (
                          <>
                            <div style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.topPost.title}</div>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {b.topPost.subreddit} · {b.topPost.score.toLocaleString()} upvotes · {b.topPost.comments.toLocaleString()} comments
                              {(b.posts?.length ?? 0) > 1 ? ` · +${b.posts!.length - 1} more thread${b.posts!.length > 2 ? 's' : ''}` : ''}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="num">{b.mentions}</td>
                      <td className="num">{b.today?.mentions || 0}</td>
                      <td className="num">{b.engagement.toLocaleString()}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" style={{ width: 28, height: 28 }}
                          title={isInWatchlist(b.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                          onClick={() => { const added = toggleWatchlist(b.symbol); toast(added ? `${b.symbol} added to watchlist` : `${b.symbol} removed from watchlist`); }}>
                          {isInWatchlist(b.symbol) ? '★' : '☆'}
                        </button>
                        <button className="btn sm" style={{ marginLeft: 6 }} disabled={loading}
                          title={`Evidence-led deep research on ${b.symbol}`}
                          onClick={() => deepDive(b.symbol)}>
                          Deep dive
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {predictions?.available && predictions.events.length > 0 && (
              <Card
                title="Crowd odds — prediction markets"
                sub={`${predictions.source} · real-money implied probabilities on market questions · refreshed hourly`}
                style={{ marginTop: 16 }}
              >
                <table className="mtable">
                  <thead><tr><th>Event</th><th>Leading market</th><th className="num">Implied</th><th className="num">Volume</th><th className="num">Resolves</th></tr></thead>
                  <tbody>
                    {predictions.events.map((e) => (
                      <tr key={e.title} style={{ cursor: 'default' }}>
                        <td style={{ maxWidth: 280 }}>{e.title}</td>
                        <td style={{ maxWidth: 320, color: 'var(--color-text-secondary)' }}>{e.topMarket?.question || '—'}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{e.topMarket ? `${e.topMarket.pct}%` : '—'}</td>
                        <td className="num">${Math.round(e.volume).toLocaleString()}</td>
                        <td className="num">{e.endDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        ) : !active && !loading && !error ? (
          <div className="empty">
            {buzz && !buzz.available
              ? 'Reddit trending board unavailable right now — type any theme or ticker above for a speculative outlook.'
              : 'Pick a theme above — or type any theme or ticker — for a speculative outlook.'}
          </div>
        ) : null
      )}
    </div>
  );
}
