import type { BuzzBrief } from '../lib/models';
import AIText from './AIText';
import { SkeletonLines } from './Skeleton';
import { providerLabel } from '../lib/format';

export default function RetailPulsePanel({ brief, busy, onRegen }: {
  brief: BuzzBrief | null;
  busy: boolean;
  onRegen: () => void;
}) {
  if (!brief && !busy) return null;
  return (
    <div className="ai-panel" style={{ marginTop: 16 }}>
      <div className="ai-head">
        <span className="spark">✦</span>
        <h3>Retail Pulse</h3>
        <span className="badge flat">SPECULATIVE</span>
        {brief && <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(brief.provider)}</span>}
        {brief && (
          <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: 8 }} title="Regenerate"
            onClick={onRegen} disabled={busy}>↻</button>
        )}
      </div>
      <div className="ai-body" style={{ opacity: busy ? 0.5 : 1 }}>
        {brief ? <AIText text={brief.text} /> : <SkeletonLines lines={8} />}
      </div>
      {brief && (
        <div className="ai-foot">
          AI-generated read of the board below · {providerLabel(brief.provider)} · attention data, not fundamentals · not investment advice
        </div>
      )}
    </div>
  );
}
