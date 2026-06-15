import type { ReactNode } from 'react';
import type { BuzzBoard } from '../lib/models';
import Card from './Card';
import Sparkline from './Sparkline';
import { toast } from './toast';
import { isInWatchlist, toggleWatchlist, getWatchlist } from '../lib/storage';

export default function BuzzBoardCard({ buzz, loading, right, onOutlook, onDeepDive }: {
  buzz: BuzzBoard;
  loading: boolean;
  right?: ReactNode;
  onOutlook: (symbol: string) => void;
  onDeepDive: (symbol: string) => void;
}) {
  const watch = new Set(getWatchlist());
  const onYourList = buzz.items.slice(0, 12).filter((b) => watch.has(b.symbol));
  return (
    <Card
      title="Trending on Reddit"
      sub={`${buzz.subreddits.join(' · ')} — ${buzz.window} (${buzz.postsScanned} posts scanned) · click a ticker for its outlook`}
      style={{ marginTop: 16 }}
      right={right}
    >
      {onYourList.length > 0 && (
        <div className="watchlist-hit" style={{ marginBottom: 10 }}>
          ★ On your watchlist &amp; trending now: {onYourList.map((b) => (
            <button key={b.symbol} className="ticker-link" style={{ marginRight: 8 }} onClick={() => !loading && onOutlook(b.symbol)}>
              {b.symbol}{b.shortVol ? ` (${b.shortVol.ratio}% short)` : ''}
            </button>
          ))}
        </div>
      )}
      <table className="mtable">
        <thead><tr><th>#</th><th>Ticker</th><th className="num">Price</th><th className="num" title="FINRA daily short volume — share of consolidated volume sold short (flow, not short interest)">Short vol</th><th>Top thread</th><th className="num">Mentions</th><th className="num" title="Mentions over the past 7 days">7d trend</th><th className="num">Today</th><th className="num">Engagement</th><th /></tr></thead>
        <tbody>
          {buzz.items.slice(0, 12).map((b, i) => (
            <tr key={b.symbol} role="button" tabIndex={0} title={`Speculative outlook on ${b.symbol}`}
              onClick={() => !loading && onOutlook(b.symbol)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !loading) onOutlook(b.symbol); }}>
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
              <td className="num" title={b.shortVol ? `FINRA daily short volume, ${b.shortVol.date}` : undefined}
                style={{ fontWeight: (b.shortVol?.ratio ?? 0) >= 60 ? 700 : 400, color: (b.shortVol?.ratio ?? 0) >= 60 ? 'var(--color-accent)' : undefined }}>
                {b.shortVol ? `${b.shortVol.ratio}%` : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
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
              <td className="num" style={{ verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                {b.trend ? <Sparkline data={b.trend} /> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
              </td>
              <td className="num">{b.today?.mentions || 0}</td>
              <td className="num">{b.engagement.toLocaleString()}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" style={{ width: 28, height: 28 }}
                  aria-label={isInWatchlist(b.symbol) ? `Remove ${b.symbol} from watchlist` : `Add ${b.symbol} to watchlist`}
                  title={isInWatchlist(b.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                  onClick={() => { const added = toggleWatchlist(b.symbol); toast(added ? `${b.symbol} added to watchlist` : `${b.symbol} removed from watchlist`); }}>
                  {isInWatchlist(b.symbol) ? '★' : '☆'}
                </button>
                <button className="btn sm" style={{ marginLeft: 6 }} disabled={loading}
                  title={`Evidence-led deep research on ${b.symbol}`}
                  onClick={() => onDeepDive(b.symbol)}>
                  Deep dive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
