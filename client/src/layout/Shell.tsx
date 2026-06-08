import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Ticker from '../components/Ticker';
import ErrorBoundary from '../components/ErrorBoundary';
import { SkeletonLines } from '../components/Skeleton';

export default function Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main id="main-content" className="content" style={{ flex: 1 }}>
          {/* key=pathname → a fresh boundary per route, so an error on one page
              clears automatically when you navigate to another. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<div style={{ paddingTop: 20 }}><SkeletonLines lines={6} /></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <Ticker />
      </div>
    </div>
  );
}
