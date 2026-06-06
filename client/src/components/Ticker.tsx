import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';

interface WireItem { headline: string; source: string; url: string; datetime: number; }

// Bottom "wire" marquee bound to /api/daily-update/wire-feed (ReturnSignal).
export default function Ticker() {
  const [items, setItems] = useState<WireItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJSON<{ items: WireItem[] }>('/api/daily-update/wire-feed')
        .then((d) => { if (alive) setItems(d.items || []); })
        .catch(() => {});
    load();
    const id = setInterval(load, 120000); // refresh every 2 min
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!items.length) return null;
  // Duplicate the list so the -50% marquee loop is seamless.
  const loop = [...items, ...items];

  return (
    <div className="ticker">
      <div className="label"><span className="live-dot" /> Wire</div>
      <div className="track">
        {loop.map((it, i) => (
          <a className="item" key={i} href={it.url} target="_blank" rel="noreferrer noopener">
            <b>{it.source}</b> &nbsp;{it.headline}
          </a>
        ))}
      </div>
    </div>
  );
}
