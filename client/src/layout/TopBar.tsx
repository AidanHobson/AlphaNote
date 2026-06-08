import SearchBar from '../components/SearchBar';
import ThemeToggle from '../components/ThemeToggle';

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} title="Menu" aria-label="Open navigation menu">☰</button>
      <SearchBar />
      <div className="spacer" />
      <a className="icon-btn" href="https://finnhub.io" target="_blank" rel="noreferrer" title="Market data: Finnhub" aria-label="Market data provider: Finnhub (opens in new tab)">📊</a>
      <ThemeToggle />
    </div>
  );
}
