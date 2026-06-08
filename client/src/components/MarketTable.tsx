import { useNavigate } from 'react-router-dom';
import type { MoverItem } from '../lib/models';
import { formatPrice, formatPct, changeDir, arrow, formatMarketCap } from '../lib/format';

export default function MarketTable({ items, showCap = true }: { items: MoverItem[]; showCap?: boolean }) {
  const nav = useNavigate();
  return (
    <table className="mtable">
      <thead>
        <tr>
          <th>Symbol</th>
          <th className="num">Price</th>
          <th className="num">Change</th>
          {showCap && <th className="num">Mkt Cap</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const dir = changeDir(it.changePercent);
          const go = () => nav(`/explorer?symbol=${encodeURIComponent(it.symbol)}`);
          return (
            <tr
              key={it.symbol}
              onClick={go}
              role="button"
              tabIndex={0}
              aria-label={`${it.symbol} ${it.name} — open in Explorer`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}
            >
              <td>
                <div className="sym-cell">
                  {it.logo ? <img src={it.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <div style={{ width: 22, height: 22 }} />}
                  <div>
                    <div style={{ fontWeight: 700 }}>{it.symbol}</div>
                    <div className="nm">{it.name}</div>
                  </div>
                </div>
              </td>
              <td className="num">{formatPrice(it.price, it.currency)}</td>
              <td className="num"><span className={`badge ${dir}`}>{arrow(it.changePercent)} {formatPct(it.changePercent)}</span></td>
              {showCap && <td className="num">{formatMarketCap(it.marketCap)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
