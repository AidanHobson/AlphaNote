import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import type { SignalPerformance as Perf, BuzzBacktest, BacktestBucket } from '../lib/models';
import Card from './Card';
import { SkeletonLines } from './Skeleton';

const BUCKET_LABEL: Record<keyof BuzzBacktest['buckets'], string> = {
  all: 'All board names',
  highShort: 'High short vol (≥60%)',
  rising: 'Rising (🔥 today)',
  topRank: 'Top 3 by mentions',
};

const signed = (v: number | null, suffix = '%') => v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`;
const colorFor = (v: number | null) => v == null ? undefined : v > 0 ? 'var(--color-up)' : v < 0 ? 'var(--color-down)' : undefined;

function Horizon({ bt }: { bt: BuzzBacktest }) {
  const rows = (Object.keys(bt.buckets) as (keyof BuzzBacktest['buckets'])[]).map((k) => [k, bt.buckets[k]] as const);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, margin: '4px 0 6px' }}>
        {bt.horizonDays}-day forward return · {bt.signalsResolved} matured signal{bt.signalsResolved === 1 ? '' : 's'}
        {bt.unresolvedSymbols > 0 && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> ({bt.unresolvedSymbols} symbols lacked price data)</span>}
      </div>
      {bt.signalsResolved === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No signals are old enough yet — this fills in as history accumulates.</div>
      ) : (
        <table className="mtable">
          <thead><tr><th>Bucket</th><th className="num">N</th><th className="num">Avg</th><th className="num">Median</th><th className="num">Hit rate</th><th className="num" title="Average return minus SPY over the same window">vs SPY</th><th className="num" title="% of signals that beat SPY">Win vs SPY</th></tr></thead>
          <tbody>
            {rows.map(([k, b]: readonly [keyof BuzzBacktest['buckets'], BacktestBucket]) => (
              <tr key={k} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: k === 'all' ? 400 : 600 }}>{BUCKET_LABEL[k]}</td>
                <td className="num">{b.n}</td>
                <td className="num" style={{ color: colorFor(b.avgReturn) }}>{signed(b.avgReturn)}</td>
                <td className="num">{signed(b.medianReturn)}</td>
                <td className="num">{b.hitRate == null ? '—' : `${b.hitRate}%`}</td>
                <td className="num" style={{ color: colorFor(b.avgExcess) }}>{signed(b.avgExcess, 'pp')}</td>
                <td className="num">{b.winVsSpy == null ? '—' : `${b.winVsSpy}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Does the speculative layer work? Forward-return backtest of the buzz signals
// plus conviction calibration, measured against EODHD daily closes.
export default function SignalPerformance() {
  const [perf, setPerf] = useState<Perf | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && !perf) getJSON<Perf>('/api/social/performance').then(setPerf).catch(() => setPerf({ available: false, reason: 'Could not load performance.' }));
  }, [open, perf]);

  return (
    <Card
      title="Signal performance — does this work?"
      sub="forward-return backtest of the buzz signals + conviction calibration, vs EODHD closes — accumulates as history builds"
      style={{ marginTop: 16 }}
      right={<button className="btn sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show track record'}</button>}
    >
      {!open ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Holds the speculative layer accountable: are high-short-volume + trending names actually moving, and do higher-conviction notes fare better? Click to compute.
        </div>
      ) : !perf ? (
        <SkeletonLines lines={5} />
      ) : !perf.available ? (
        <div className="empty" style={{ border: 'none' }}>{perf.reason}</div>
      ) : (
        <>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 10 }}>
            {perf.distinctSymbols} distinct symbols seen; priced {perf.pricedSymbols}. Forward returns are entry-to-horizon on daily closes; "vs SPY" is excess over the index in the same window.
          </div>
          {perf.buzz && <Horizon bt={perf.buzz.d5} />}
          {perf.buzz && <Horizon bt={perf.buzz.d20} />}
          {perf.conviction && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, margin: '4px 0 6px' }}>
                Conviction calibration · {perf.conviction.sampled} ticker note{perf.conviction.sampled === 1 ? '' : 's'}
                {perf.conviction.avgHoldingDays != null && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> (avg {perf.conviction.avgHoldingDays}d held)</span>}
              </div>
              {perf.conviction.sampled === 0 ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No ticker notes old enough yet.</div>
              ) : (
                <table className="mtable">
                  <thead><tr><th>Conviction</th><th className="num">N</th><th className="num">Avg return since note</th><th className="num">Hit rate</th></tr></thead>
                  <tbody>
                    {([['High (4–5)', perf.conviction.bands.high], ['Mid (3)', perf.conviction.bands.mid], ['Low (1–2)', perf.conviction.bands.low]] as const).map(([label, b]) => (
                      <tr key={label} style={{ cursor: 'default' }}>
                        <td style={{ fontWeight: 600 }}>{label}</td>
                        <td className="num">{b.n}</td>
                        <td className="num" style={{ color: colorFor(b.avgReturn) }}>{signed(b.avgReturn)}</td>
                        <td className="num">{b.hitRate == null ? '—' : `${b.hitRate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 10 }}>
            Small samples early on — treat as directional, not statistically significant. Past performance does not predict future results; not investment advice.
          </div>
        </>
      )}
    </Card>
  );
}
