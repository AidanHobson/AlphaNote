import { useState } from 'react';
import { postJSON } from '../lib/api';
import type { ResearchNote, OutlookNote } from '../lib/models';
import AIText from '../components/AIText';
import Tabs from '../components/Tabs';
import { SkeletonLines } from '../components/Skeleton';

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
            {' · '}blends the model's general knowledge (which may be out of date) with {outlook.mode === 'stock' ? 'live market data' : 'no live data'}
            {' · '}verify tickers and figures in Deep research before acting
            {' · '}generated {new Date(outlook.generatedAt).toLocaleTimeString()}{outlook.cached ? ' (cached)' : ''}
            {' · '}not investment advice
          </div>
        </div>
      )}

      {!active && !loading && !error && (
        <div className="empty">
          {isOutlook
            ? 'Pick a theme above — or type any theme or ticker — for a speculative outlook.'
            : 'Pick a ticker above to generate an institutional-style research note.'}
        </div>
      )}
    </div>
  );
}
