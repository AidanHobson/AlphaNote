import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Ticker from '../components/Ticker';
import { SkeletonLines } from '../components/Skeleton';

export default function Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <div className="content" style={{ flex: 1 }}>
          <Suspense fallback={<div style={{ paddingTop: 20 }}><SkeletonLines lines={6} /></div>}>
            <Outlet />
          </Suspense>
        </div>
        <Ticker />
      </div>
    </div>
  );
}
