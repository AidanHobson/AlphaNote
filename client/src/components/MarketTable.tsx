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
          return (
            <tr key={it.symbol} onClick={() => nav(`/explorer?symbol=${encodeURIComponent(it.symbol)}`)}>
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
