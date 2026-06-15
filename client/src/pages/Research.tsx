import { useEffect, useReducer, useState } from 'react';
import { deleteJSON, getJSON, postJSON, streamJSON } from '../lib/api';
import type { ResearchNote, OutlookNote, BuzzBoard, BuzzBrief, PredictionsBoard, ThemeRadarNote, MonopolyNote, MonopolyRadarNote, HistoryNote } from '../lib/models';
import AIText from '../components/AIText';
import Tabs from '../components/Tabs';
import { SkeletonLines } from '../components/Skeleton';
import BuzzBoardCard from '../components/BuzzBoardCard';
import PredictionsCard from '../components/PredictionsCard';
import SignalPerformance from '../components/SignalPerformance';
import ResearchShortlist from '../components/ResearchShortlist';
import RetailPulsePanel from '../components/RetailPulsePanel';
import ThemeRadarPanel from '../components/ThemeRadarPanel';
import MonopolyRadarPanel from '../components/MonopolyRadarPanel';
import MyResearch from '../components/MyResearch';
import { onStorageChange } from '../lib/storage';
import { providerLabel } from '../lib/format';

const MODES = ['Deep research', 'Speculative outlook', 'Monopoly research'];
const RESEARCH_PILLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'JPM', 'XOM'];
const OUTLOOK_PILLS = ['Lithography', 'Memory', 'Photonics', 'Robotics', 'Energy', 'AI Picks & Shovels', 'AI Bottlenecks', 'Quantum Computing', 'Space', 'Defense Tech', 'GLP-1'];
// Seed universe from the monopoly mandate, spanning the cap tiers: mega/large
// anchors (EUV, ratings, .com registry, credit scores, life-sciences cloud,
// gov SaaS, sole-source aero), then the small/micro names where the alpha lives.
const MONOPOLY_PILLS = [
  'ASML', 'MCO', 'VRSN', 'FICO', 'VEEV', 'TYL', 'TDG', 'HEI',
  'MOG.A', 'ATEX', 'NVEE', 'PLPC', 'CLFD', 'MLAB', 'CMT', 'ULBI',
];

const sanitizeTopic = (t: string) => t.replace(/[^A-Za-z0-9 .&\-/+']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

export default function Research() {
  const [mode, setMode] = useState(MODES[0]);
  const isOutlook = mode === MODES[1];
  const isMonopoly = mode === MODES[2];

  const [input, setInput] = useState('');
  const [note, setNote] = useState<ResearchNote | null>(null);
  const [outlook, setOutlook] = useState<OutlookNote | null>(null);
  const [monopoly, setMonopoly] = useState<MonopolyNote | null>(null);
  const [monoRadar, setMonoRadar] = useState<MonopolyRadarNote | null>(null);
  const [monoRadarBusy, setMonoRadarBusy] = useState(false);
  const [monoRadarError, setMonoRadarError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamText, setStreamText] = useState('');
  const [streamStatus, setStreamStatus] = useState('');
  const [historyBump, setHistoryBump] = useState(0);

  const [buzz, setBuzz] = useState<BuzzBoard | null>(null);
  const [predictions, setPredictions] = useState<PredictionsBoard | null>(null);
  const [brief, setBrief] = useState<BuzzBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [radar, setRadar] = useState<ThemeRadarNote | null>(null);
  const [radarBusy, setRadarBusy] = useState(false);
  const [radarError, setRadarError] = useState('');
  const [briefStream, setBriefStream] = useState('');
  const [radarStream, setRadarStream] = useState('');
  const [monoRadarStream, setMonoRadarStream] = useState('');

  const [, bumpWatch] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onStorageChange(bumpWatch), []);

  // Load the Reddit buzz board + crowd odds once, when the outlook tab opens.
  useEffect(() => {
    if (isOutlook && !buzz) getJSON<BuzzBoard>('/api/social/buzz').then(setBuzz).catch(() => {});
    if (isOutlook && !predictions) getJSON<PredictionsBoard>('/api/social/predictions').then(setPredictions).catch(() => {});
  }, [isOutlook, buzz, predictions]);

  // Stream an AI note: text appears token-by-token; the final `done` carries the
  // authoritative note (with metadata) that replaces the streamed buffer.
  const streamNote = (kind: 'research' | 'outlook' | 'monopoly', topic: string, force: boolean) => {
    setLoading(true); setError(''); setStreamText(''); setStreamStatus('');
    setInput(topic);
    if (!force) { if (kind === 'monopoly') setMonopoly(null); else if (kind === 'outlook') setOutlook(null); else setNote(null); }
    const path = kind === 'monopoly' ? '/api/ai/monopoly/stream' : kind === 'outlook' ? '/api/ai/outlook/stream' : '/api/ai/research/stream';
    const body = kind === 'outlook' ? { topic, force } : { symbol: topic.toUpperCase(), topic: topic.toUpperCase(), force };
    streamJSON<ResearchNote & OutlookNote & MonopolyNote>(path, body, {
      onStatus: (s) => setStreamStatus(s),
      onDelta: (chunk) => { setStreamStatus(''); setStreamText((t) => t + chunk); },
      onDone: (note) => {
        setStreamText(''); setStreamStatus('');
        if (kind === 'monopoly') setMonopoly(note as unknown as MonopolyNote);
        else if (kind === 'outlook') setOutlook(note as unknown as OutlookNote);
        else setNote(note as unknown as ResearchNote);
        setHistoryBump((x) => x + 1);
        setLoading(false);
      },
      onError: (m) => { setError(m); setStreamText(''); setStreamStatus(''); setLoading(false); },
    });
  };

  const run = (raw: string, force = false) => {
    const topic = raw.trim();
    if (!topic || loading) return;
    streamNote(isMonopoly ? 'monopoly' : isOutlook ? 'outlook' : 'research', topic, force);
  };

  // Jump from a board row into a Deep-research note (switches tab + streams).
  const deepDive = (symbol: string) => {
    if (loading) return;
    setMode(MODES[0]);
    streamNote('research', symbol, false);
  };

  const runBrief = (force = false) => {
    if (briefBusy) return;
    setBriefBusy(true); setBriefError(''); setBriefStream('');
    streamJSON<BuzzBrief>('/api/ai/buzz-brief/stream', { force }, {
      onDelta: (c) => setBriefStream((t) => t + c),
      onDone: (n) => { setBrief(n); setBriefStream(''); setBriefBusy(false); },
      onError: (m) => { setBriefError(m); setBriefStream(''); setBriefBusy(false); },
    });
  };

  const runRadar = (force = false) => {
    if (radarBusy) return;
    setRadarBusy(true); setRadarError(''); setRadarStream('');
    streamJSON<ThemeRadarNote>('/api/ai/theme-radar/stream', { force }, {
      onDelta: (c) => setRadarStream((t) => t + c),
      onDone: (n) => { setRadar(n); setRadarStream(''); setRadarBusy(false); },
      onError: (m) => { setRadarError(m); setRadarStream(''); setRadarBusy(false); },
    });
  };

  const runMonoRadar = (force = false) => {
    if (monoRadarBusy) return;
    setMonoRadarBusy(true); setMonoRadarError(''); setMonoRadarStream('');
    streamJSON<MonopolyRadarNote>('/api/ai/monopoly-radar/stream', { force }, {
      onDelta: (c) => setMonoRadarStream((t) => t + c),
      onDone: (n) => { setMonoRadar(n); setMonoRadarStream(''); setMonoRadarBusy(false); },
      onError: (m) => { setMonoRadarError(m); setMonoRadarStream(''); setMonoRadarBusy(false); },
    });
  };

  // Reopen a saved note: the meta column holds the original response, so the
  // view restores exactly as generated (and switches to the right tab).
  const restoreNote = (id: number) => {
    getJSON<HistoryNote>(`/api/notes/history/${id}`)
      .then((n) => {
        setError('');
        if (n.kind === 'monopoly') { setMode(MODES[2]); setMonopoly(n.meta as MonopolyNote); }
        else if (n.kind === 'outlook') { setMode(MODES[1]); setOutlook(n.meta as OutlookNote); }
        else { setMode(MODES[0]); setNote(n.meta as ResearchNote); }
        setInput(n.topic);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch((e) => setError(e.message));
  };

  const pills = isMonopoly ? MONOPOLY_PILLS : isOutlook ? OUTLOOK_PILLS : RESEARCH_PILLS;
  const active = isMonopoly ? monopoly : isOutlook ? outlook : note;

  return (
    <div>
      <div className="page-head">
        <h1>AI Analyst</h1>
        <p>
          {isMonopoly
            ? 'Structural monopolists and near-monopolists in niche, critical, or emerging markets — across all cap tiers, sub-$5B explicitly included. Profiles classify the moat against six archetypes (technical, spectrum/regulatory, network/data, chokepoint, certification, niche industrial), run EPIC/FaVeS, and weigh bull/base/bear scenarios. The radar hunts for under-followed names.'
            : isOutlook
            ? 'Speculative outlooks on themes (Photonics, Robotics, Energy…) or single stocks — the forward-looking counterpart to the evidence-led research notes. Every theme maps its picks-and-shovels layer: the toolmakers and suppliers that get paid whichever player wins. Blends live data with the model’s general knowledge; speculation is labelled as such.'
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
          placeholder={isMonopoly ? 'Ticker, e.g. ATEX' : isOutlook ? 'Theme or ticker, e.g. Photonics' : 'Enter a ticker, e.g. AAPL'}
          maxLength={isOutlook ? 60 : 12}
          style={isOutlook ? { textTransform: 'none' } : undefined}
          aria-label={isOutlook ? 'Theme or ticker' : 'Ticker symbol'}
        />
        <button className="btn primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Working…' : isMonopoly ? 'Profile' : isOutlook ? 'Outlook' : 'Research'}
        </button>
      </form>

      <div className="mgr-pills" style={{ marginBottom: 16 }}>
        {pills.map((s) => (
          <button
            key={s}
            className={`mgr-pill ${(isMonopoly ? monopoly?.topic === s : isOutlook ? outlook?.topic === s : note?.symbol === s) ? 'active' : ''}`}
            disabled={loading}
            onClick={() => run(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !active && (
        <div className="ai-panel" aria-busy="true">
          <div className="ai-head">
            <span className="spark">✦</span>
            <h3>{isMonopoly ? 'Drafting monopoly profile…' : isOutlook ? 'Drafting speculative outlook…' : 'Drafting research note…'}</h3>
            {streamText && <span className="pill accent streaming-pill" style={{ marginLeft: 'auto' }}>streaming…</span>}
          </div>
          <div className="ai-body" aria-live="polite">
            {streamText
              ? <><AIText text={streamText} /><span className="stream-caret" aria-hidden="true">▍</span></>
              : <>
                  {streamStatus && <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 10 }}>{streamStatus}</div>}
                  <SkeletonLines lines={12} />
                </>}
          </div>
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
            <AIText text={note.text} onTicker={(s) => run(s)} />
          </div>
          <div className="ai-foot">
            AI-generated · {providerLabel(note.provider)}{note.fellBack ? ' (primary unavailable)' : ''}
            {' · '}sources: live quote{note.data.hasFundamentals ? ', SEC EDGAR fundamentals + quarterly trend' : ''}
            {note.data.hasValuation ? ', derived multiples' : ''}
            {note.data.hasHistory ? ', 1Y price history vs SPY' : ''}, news, analyst ratings
            {(note.data.peerCount ?? 0) > 0 ? `, ${note.data.peerCount} peer comp${(note.data.peerCount ?? 0) > 1 ? 's' : ''}` : ''}
            {(note.data.managers13F ?? 0) > 0 ? `, ${note.data.managers13F} 13F manager${(note.data.managers13F ?? 0) > 1 ? 's' : ''}` : ''}
            {note.data.insiderCount > 0 ? `, ${note.data.insiderCount} insider filing${note.data.insiderCount > 1 ? 's' : ''}` : ''}
            {note.data.insiderSignal ? ` · insider: ${note.data.insiderSignal}` : ''}
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
            <AIText text={outlook.text} onTicker={(s) => run(s)} />
          </div>
          <div className="ai-foot">
            Speculative AI analysis · {providerLabel(outlook.provider)}{outlook.fellBack ? ' (primary unavailable)' : ''}
            {' · '}blends the model's general knowledge (which may be out of date) with {outlook.mode === 'stock' ? 'live market data' : 'no live market data'}
            {(outlook.data.social?.length ?? 0) > 0 ? ` + last-30-days signal (${outlook.data.social!.join(', ')})` : ''}
            {outlook.data.buzz ? ` · #${outlook.data.buzz.rank} on Reddit's finance subs this week (${outlook.data.buzz.mentions} mentions)` : ''}
            {outlook.data.shortVol ? ` · short vol ${outlook.data.shortVol.ratio}% (FINRA ${outlook.data.shortVol.date})` : ''}
            {(outlook.data.insiderCount ?? 0) > 0 ? ` · ${outlook.data.insiderCount} insider filing${(outlook.data.insiderCount ?? 0) > 1 ? 's' : ''}` : ''}
            {(outlook.data.managers13F ?? 0) > 0 ? ` · ${outlook.data.managers13F} 13F holder${(outlook.data.managers13F ?? 0) > 1 ? 's' : ''}` : ''}
            {' · '}verify tickers and figures in Deep research before acting
            {' · '}generated {new Date(outlook.generatedAt).toLocaleTimeString()}{outlook.cached ? ' (cached)' : ''}
            {' · '}not investment advice
          </div>
        </div>
      )}

      {isMonopoly && monopoly && (
        <div className="ai-panel">
          <div className="ai-head">
            {monopoly.data.logo
              ? <img src={monopoly.data.logo} alt="" style={{ width: 24, height: 24, borderRadius: 7 }} />
              : <span className="spark">♛</span>}
            <h3>{monopoly.data.name} ({monopoly.topic})</h3>
            <span className="badge flat">MONOPOLY PROFILE</span>
            {monopoly.data.price != null && (
              <span className={`badge ${(monopoly.data.change ?? 0) >= 0 ? 'up' : 'down'}`}>
                {monopoly.data.price} {monopoly.data.currency} · {monopoly.data.changePercent != null ? monopoly.data.changePercent.toFixed(2) : '0.00'}%
              </span>
            )}
            <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(monopoly.provider)}</span>
            <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Regenerate (bypasses the 1h cache)"
              onClick={() => run(monopoly.topic, true)} disabled={loading}>↻</button>
          </div>
          <div className="ai-body" style={{ opacity: loading ? 0.5 : 1 }}>
            <AIText text={monopoly.text} onTicker={(s) => run(s)} />
          </div>
          <div className="ai-foot">
            Speculative monopoly research · {providerLabel(monopoly.provider)}{monopoly.fellBack ? ' (primary unavailable)' : ''}
            {' · '}live data{monopoly.data.hasFundamentals ? ': SEC EDGAR fundamentals' : ''}{monopoly.data.hasValuation ? ', derived multiples' : ''}
            {monopoly.data.shortVol ? `, short vol ${monopoly.data.shortVol.ratio}%` : ''}
            {(monopoly.data.insiderCount ?? 0) > 0 ? `, ${monopoly.data.insiderCount} insider filing${(monopoly.data.insiderCount ?? 0) > 1 ? 's' : ''}` : ''}
            {(monopoly.data.managers13F ?? 0) > 0 ? `, ${monopoly.data.managers13F} 13F holder${(monopoly.data.managers13F ?? 0) > 1 ? 's' : ''}` : ''}
            {' · '}moat claims blend labelled general knowledge (training cutoff) — verify before acting
            {' · '}generated {new Date(monopoly.generatedAt).toLocaleTimeString()}{monopoly.cached ? ' (cached)' : ''}
            {' · '}not investment advice
          </div>
        </div>
      )}

      {isMonopoly && (
        <>
          {monoRadarError && <div className="error-banner" style={{ marginTop: 16 }}>{monoRadarError}</div>}
          <MonopolyRadarPanel radar={monoRadar} busy={monoRadarBusy} streamText={monoRadarStream} disabled={loading} onTicker={(s) => run(s)}
            onRegen={() => runMonoRadar(true)} onProfile={(t) => run(t)} />
          {!monoRadar && !monoRadarBusy && (
            <div className={active || loading ? '' : 'empty'} style={{ marginTop: 16, textAlign: 'center' }}>
              {!active && !loading && <p style={{ marginTop: 0 }}>Pick a seed ticker above for a full monopoly profile, or scan for under-followed names.</p>}
              <button className="btn primary" onClick={() => runMonoRadar()}>🔭 Run Monopoly Radar</button>
            </div>
          )}
        </>
      )}

      {!active && !loading && !error && !isOutlook && !isMonopoly && (
        <div className="empty">
          Pick a ticker above to generate an institutional-style research note.
        </div>
      )}

      {isOutlook && (
        buzz?.available && buzz.items.length ? (
          <>
            {radarError && <div className="error-banner" style={{ marginTop: 16 }}>{radarError}</div>}
            <ThemeRadarPanel radar={radar} busy={radarBusy} streamText={radarStream} disabled={loading} onTicker={(s) => run(s)}
              onRegen={() => runRadar(true)} onTheme={(t) => run(sanitizeTopic(t))} />
            {briefError && <div className="error-banner" style={{ marginTop: 16 }}>{briefError}</div>}
            <RetailPulsePanel brief={brief} busy={briefBusy} streamText={briefStream} onRegen={() => runBrief(true)} onTicker={(s) => run(s)} />
            <BuzzBoardCard
              buzz={buzz}
              loading={loading}
              onOutlook={(sym) => run(sym)}
              onDeepDive={deepDive}
              right={<div className="row">
                {!radar && !radarBusy && <button className="btn sm" onClick={() => runRadar()}>🛰 Theme radar</button>}
                {!brief && !briefBusy && <button className="btn sm primary" onClick={() => runBrief()}>✦ Retail Pulse</button>}
              </div>}
            />
            <ResearchShortlist onResearch={(s) => run(s)} />
            <PredictionsCard predictions={predictions} />
            <SignalPerformance />
          </>
        ) : !active && !loading && !error ? (
          <div className="empty">
            {buzz && !buzz.available
              ? 'Reddit trending board unavailable right now — type any theme or ticker above for a speculative outlook.'
              : 'Pick a theme above — or type any theme or ticker — for a speculative outlook.'}
          </div>
        ) : null
      )}

      <MyResearch
        refreshKey={historyBump}
        onRestore={restoreNote}
        onDelete={(id) => deleteJSON<{ ok: boolean }>(`/api/notes/history/${id}`).then((r) => r.ok).catch(() => false)}
      />
    </div>
  );
}
