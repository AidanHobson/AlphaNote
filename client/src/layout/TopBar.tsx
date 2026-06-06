import SearchBar from '../components/SearchBar';
import ThemeToggle from '../components/ThemeToggle';

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} title="Menu">☰</button>
      <SearchBar />
      <div className="spacer" />
      <a className="icon-btn" href="https://finnhub.io" target="_blank" rel="noreferrer" title="Market data: Finnhub">📊</a>
      <ThemeToggle />
    </div>
  );
}
