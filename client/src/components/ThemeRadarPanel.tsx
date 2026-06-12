import type { ThemeRadarNote } from '../lib/models';
import AIText from './AIText';
import { SkeletonLines } from './Skeleton';
import { providerLabel } from '../lib/format';

// The radar names each theme on its own bold line — extract them as chips.
const themesOf = (radar: ThemeRadarNote | null) =>
  radar
    ? [...radar.text.matchAll(/^\*\*([^*]+)\*\*$/gm)]
        .map((m) => m[1].trim())
        .filter((t) => t.length <= 60 && !/^bottom line/i.test(t))
    : [];

export default function ThemeRadarPanel({ radar, busy, disabled, onRegen, onTheme }: {
  radar: ThemeRadarNote | null;
  busy: boolean;
  disabled: boolean;
  onRegen: () => void;
  onTheme: (topic: string) => void;
}) {
  if (!radar && !busy) return null;
  const themes = themesOf(radar);
  return (
    <div className="ai-panel" style={{ marginTop: 16 }}>
      <div className="ai-head">
        <span className="spark">🛰</span>
        <h3>Theme Radar — emerging, not-yet-named themes</h3>
        <span className="badge flat">SPECULATIVE</span>
        {radar && <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(radar.provider)}</span>}
        {radar && (
          <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Rescan the live signal"
            onClick={onRegen} disabled={busy}>↻</button>
        )}
      </div>
      <div className="ai-body" style={{ opacity: busy ? 0.5 : 1 }}>
        {radar ? <AIText text={radar.text} /> : <SkeletonLines lines={10} />}
        {radar && themes.length > 0 && (
          <div className="mgr-pills" style={{ marginTop: 12 }}>
            {themes.map((t) => (
              <button key={t} className="mgr-pill" disabled={disabled} title={`Full speculative outlook on “${t}”`}
                onClick={() => onTheme(t)}>
                {t} →
              </button>
            ))}
          </div>
        )}
      </div>
      {radar && (
        <div className="ai-foot">
          Mined from live signal: {radar.signal.hnStories} HN stories, {radar.signal.redditThreads} Reddit threads, {radar.signal.predictionEvents} Polymarket events
          {' · '}every theme cites its evidence · excludes already-named themes · generated {new Date(radar.generatedAt).toLocaleTimeString()}{radar.cached ? ' (cached)' : ''}
          {' · '}not investment advice
        </div>
      )}
    </div>
  );
}
