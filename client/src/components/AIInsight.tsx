import { useCallback, useEffect, useState } from 'react';
import { postJSON } from '../lib/api';
import type { Insight } from '../lib/models';
import AIText from './AIText';
import { SkeletonLines } from './Skeleton';

// Model-agnostic — never surface the underlying model's name in the UI.
const providerLabel = (_p: string) => 'AI';

export default function AIInsight({ symbol, onInsight }: { symbol: string; onInsight?: (i: Insight) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: Insight; error?: string }>({ loading: true });

  const load = useCallback(() => {
    setState({ loading: true });
    postJSON<Insight>('/api/ai/insight', { symbol })
      .then((data) => { setState({ loading: false, data }); onInsight?.(data); })
      .catch((e) => setState({ loading: false, error: e.message }));
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="spark">✦</span>
        <h3>AI insight</h3>
        {state.data && <span className="pill accent" style={{ marginLeft: 'auto' }}>{providerLabel(state.data.provider)}</span>}
        <button className="icon-btn" style={{ width: 30, height: 30, marginLeft: state.data ? 8 : 'auto' }} title="Regenerate" onClick={load} disabled={state.loading}>↻</button>
      </div>
      <div className="ai-body">
        {state.loading && <SkeletonLines lines={4} />}
        {state.error && <div className="error-banner">{state.error}</div>}
        {state.data && <AIText text={state.data.text} />}
      </div>
      {state.data && (
        <div className="ai-foot">
          AI-generated · {providerLabel(state.data.provider)}{state.data.fellBack ? ' (primary unavailable)' : ''} · not financial advice
        </div>
      )}
    </div>
  );
}
