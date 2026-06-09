import SearchBar from '../components/SearchBar';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../lib/auth';

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} title="Menu" aria-label="Open navigation menu">☰</button>
      <SearchBar />
      <div className="spacer" />
      <a className="icon-btn" href="https://finnhub.io" target="_blank" rel="noreferrer" title="Market data: Finnhub" aria-label="Market data provider: Finnhub (opens in new tab)">📊</a>
      <ThemeToggle />
      {user && (
        <span className="user-chip" title={`Signed in as ${user.username}${user.isAdmin ? ' · admin' : ''}`}>
          {user.isAdmin && <span className="admin-badge">admin</span>}
          {user.username}
        </span>
      )}
      <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => logout()}>⎋</button>
    </div>
  );
}
