import { lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Shell from './layout/Shell';

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
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Notes = lazy(() => import('./pages/Notes'));

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
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'notes', element: <Notes /> },
      { path: '*', element: <Navigate to="/daily-update" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
