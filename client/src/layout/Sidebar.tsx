import { NavLink } from 'react-router-dom';

const NAV = [
  { group: 'Markets', items: [
    { to: '/daily-update', label: 'Daily Update', ico: '◫' },
    { to: '/explorer', label: 'Asset Explorer', ico: '🔍' },
    { to: '/watchlist', label: 'Watchlist', ico: '★' },
  ]},
  { group: 'Analytics', items: [
    { to: '/valuation', label: 'Valuation Explorer', ico: '📐' },
    { to: '/macro', label: 'Macro', ico: '🌐' },
    { to: '/economy', label: 'Economy', ico: '🏛️' },
    { to: '/factors', label: 'Factors', ico: '🧮' },
    { to: '/risk', label: 'Risk Monitor', ico: '⚠️' },
    { to: '/insider', label: 'Insider Explorer', ico: '🕵️' },
    { to: '/earnings', label: 'Earnings', ico: '📅' },
  ]},
  { group: 'Research', items: [
    { to: '/notes', label: 'Research Notes', ico: '✎' },
  ]},
];

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <span className="mark">α</span>
        <div>
          AlphaNote
          <div className="sub">Markets Research</div>
        </div>
      </div>

      {NAV.map((g) => (
        <div key={g.group}>
          <div className="nav-group-label">{g.group}</div>
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="ico">{it.ico}</span> {it.label}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="spacer" />
      <div className="foot">
        Hybrid of ReturnSignal × OpenStock. Data via Finnhub · charts via TradingView · AI via Claude→Gemini. Not financial advice.
      </div>
    </aside>
  );
}
