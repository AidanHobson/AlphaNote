import { useState } from 'react';
import { postJSON } from '../lib/api';
import type { ResearchNote } from '../lib/models';
import AIText from '../components/AIText';
import { SkeletonLines } from '../components/Skeleton';

const providerLabel = (p: string) => ({ claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' }[p] || p);
const SUGGESTIONS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'JPM', 'XOM'];

export default function Research() {
  const [input, setInput] = useState('');
  const [note, setNote] = useState<ResearchNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = (symbol: string, force = false) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || loading) return;
    setLoading(true); setError(''); if (!force) setNote(null);
    setInput(sym);
    postJSON<ResearchNote>('/api/ai/research', { symbol: sym, force })
      .then(setNote)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <div className="page-head">
        <h1>AI Analyst</h1>
        <p>
          Full research note on any US-listed stock — fundamentals trajectory and earnings quality from SEC filings,
          price action, analyst consensus, news flow, and insider activity, synthesised into an evidence-led view.
        </p>
      </div>

      <form
        className="research-bar"
        onSubmit={(e) => { e.preventDefault(); run(input); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter a ticker, e.g. AAPL"
          maxLength={12}
          aria-label="Ticker symbol"
        />
        <button className="btn primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Researching…' : 'Research'}
        </button>
      </form>

      <div className="mgr-pills" style={{ marginBottom: 16 }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} className={`mgr-pill ${note?.symbol === s ? 'active' : ''}`} disabled={loading} onClick={() => run(s)}>
            {s}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !note && (
        <div className="ai-panel">
          <div className="ai-head"><span className="spark">✦</span><h3>Drafting research note…</h3></div>
          <div className="ai-body"><SkeletonLines lines={12} /></div>
        </div>
      )}

      {note && (
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
            <button
              className="icon-btn"
              style={{ width: 30, height: 30, marginLeft: 8 }}
              title="Regenerate (bypasses the 1h cache)"
              onClick={() => run(note.symbol, true)}
              disabled={loading}
            >↻</button>
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

      {!note && !loading && !error && (
        <div className="empty">
          Pick a ticker above to generate an institutional-style research note.
        </div>
      )}
    </div>
  );
}
