import type { MonopolyRadarNote } from '../lib/models';
import AIText from './AIText';
import { SkeletonLines } from './Skeleton';
import { providerLabel } from '../lib/format';

// Radar candidates are bold lines — usually "ATEX — Anterix (…)" but models
// also emit "ANTERIX (ATEX) — …"; accept a leading ticker or the first
// parenthesised uppercase token.
const tickersOf = (radar: MonopolyRadarNote | null) =>
  radar
    ? [...radar.text.matchAll(/^\*\*([^*\n]+)\*\*\s*$/gm)]
        .map((m) => {
          const line = m[1];
          return /^([A-Z][A-Z0-9.\-]{0,9})\s*[—–-]/.exec(line)?.[1]
            || /\(([A-Z][A-Z0-9.\-]{1,9})\)/.exec(line)?.[1]
            || null;
        })
        .filter((t): t is string => Boolean(t))
    : [];

export default function MonopolyRadarPanel({ radar, busy, disabled, onRegen, onProfile }: {
  radar: MonopolyRadarNote | null;
  busy: boolean;
  disabled: boolean;
  onRegen: () => void;
  onProfile: (ticker: string) => void;
}) {
  if (!radar && !busy) return null;
  const tickers = [...new Set(tickersOf(radar))];
  return (
    <div className="ai-panel" style={{ marginTop: 16 }}>
      <div className="ai-head">
        <span className="spark">🔭</span>
        <h3>Monopoly Radar — under-followed structural monopolists</h3>
        <span className="badge flat">SPECULATIVE</span>
        {radar && <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(radar.provider)}</span>}
        {radar && (
          <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Rescan"
            onClick={onRegen} disabled={busy}>↻</button>
        )}
      </div>
      <div className="ai-body" style={{ opacity: busy ? 0.5 : 1 }}>
        {radar ? <AIText text={radar.text} /> : <SkeletonLines lines={10} />}
        {radar && tickers.length > 0 && (
          <div className="mgr-pills" style={{ marginTop: 12 }}>
            {tickers.map((t) => (
              <button key={t} className="mgr-pill" disabled={disabled} title={`Full monopoly profile on ${t}`}
                onClick={() => onProfile(t)}>
                {t} →
              </button>
            ))}
          </div>
        )}
      </div>
      {radar && (
        <div className="ai-foot">
          Candidates from the model's general knowledge (training cutoff applies) — tiers, caps, and listing status MUST be verified
          {' · '}≥3 sub-$5B names per scan by mandate · generated {new Date(radar.generatedAt).toLocaleTimeString()}{radar.cached ? ' (cached)' : ''}
          {' · '}not investment advice
        </div>
      )}
    </div>
  );
}
