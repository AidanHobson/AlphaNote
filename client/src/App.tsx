import { lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Shell from './layout/Shell';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';

// Code-split each route into its own chunk (ReturnSignal pattern).
const DailyUpdate = lazy(() => import('./pages/DailyUpdate'));
const Explorer = lazy(() => import('./pages/Explorer'));
const Valuation = lazy(() => import('./pages/Valuation'));
const Macro = lazy(() => import('./pages/Macro'));
const Economy = lazy(() => import('./pages/Economy'));
const Factors = lazy(() => import('./pages/Factors'));
const Risk = lazy(() => import('./pages/Risk'));
const Earnings = lazy(() => import('./pages/Earnings'));
const Insider = lazy(() => import('./pages/Insider'));
const SmartMoney = lazy(() => import('./pages/SmartMoney'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Notes = lazy(() => import('./pages/Notes'));
const Admin = lazy(() => import('./pages/Admin'));
const Account = lazy(() => import('./pages/Account'));

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/daily-update" replace /> },
      { path: 'daily-update', element: <DailyUpdate /> },
      { path: 'explorer', element: <Explorer /> },
      { path: 'valuation', element: <Valuation /> },
      { path: 'macro', element: <Macro /> },
      { path: 'economy', element: <Economy /> },
      { path: 'factors', element: <Factors /> },
      { path: 'risk', element: <Risk /> },
      { path: 'earnings', element: <Earnings /> },
      { path: 'insider', element: <Insider /> },
      { path: 'smart-money', element: <SmartMoney /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'notes', element: <Notes /> },
      { path: 'admin', element: <Admin /> },
      { path: 'account', element: <Account /> },
      { path: '*', element: <Navigate to="/daily-update" replace /> },
    ],
  },
]);

// Auth gate: the whole app is behind a login. Until authenticated we show the
// Login screen instead of the router; once signed in, the dashboard mounts at the
// current URL (deep links preserved).
function Root() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-screen"><div className="login-loading">Loading…</div></div>;
  if (!user) return <Login />;
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
