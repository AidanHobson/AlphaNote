import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getJSON } from '../lib/api';
import type { SearchResult } from '../lib/models';

export default function SearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      getJSON<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => { setResults(d.results || []); setActive(0); })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (sym: string) => { setOpen(false); setQ(''); setResults([]); nav(`/explorer?symbol=${encodeURIComponent(sym)}`); };

  return (
    <div className="searchbar" ref={boxRef}>
      <span className="s-ico">🔎</span>
      <input
        value={q}
        placeholder="Search a ticker or company…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) go(results[active].symbol);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <div className="results">
          {results.map((r, i) => (
            <div key={r.symbol + i} className={`r ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(r.symbol)}>
              <span className="sym">{r.symbol}</span>
              <span className="desc">{r.name}</span>
              <span className="ex">{r.exchange}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
