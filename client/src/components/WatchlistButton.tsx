import { useEffect, useState } from 'react';
import { isInWatchlist, toggleWatchlist, onStorageChange } from '../lib/storage';
import { toast } from './toast';

export default function WatchlistButton({ symbol }: { symbol: string }) {
  const [inWl, setInWl] = useState(false);
  useEffect(() => {
    setInWl(isInWatchlist(symbol));
    return onStorageChange(() => setInWl(isInWatchlist(symbol)));
  }, [symbol]);

  return (
    <button
      className={`btn ${inWl ? 'danger' : 'primary'}`}
      onClick={() => {
        const added = toggleWatchlist(symbol);
        toast(added ? `${symbol.toUpperCase()} added to watchlist` : `${symbol.toUpperCase()} removed`);
      }}
    >
      {inWl ? '★ In watchlist' : '☆ Add to watchlist'}
    </button>
  );
}
