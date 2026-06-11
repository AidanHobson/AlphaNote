import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

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
    { to: '/smart-money', label: 'Smart Money', ico: '💼' },
    { to: '/earnings', label: 'Earnings', ico: '📅' },
  ]},
  { group: 'Research', items: [
    { to: '/notes', label: 'Research Notes', ico: '✎' },
  ]},
];

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user } = useAuth();
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

      {user?.isAdmin && (
        <div>
          <div className="nav-group-label">Admin</div>
          <NavLink to="/admin" onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="ico">🛡️</span> Admin
          </NavLink>
        </div>
      )}

      <div className="spacer" />
    </aside>
  );
}
