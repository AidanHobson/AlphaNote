import './lib/env.js'; // load .env (override) before anything reads process.env
import express from 'express';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached } from './lib/apicache.js';

import { getQuote, getCompanyProfile, getWatchlistData, getNews, searchStocks } from './lib/finnhub.js';
import { generateStockInsight } from './lib/insight.js';
import { generateResearchNote } from './lib/research.js';
import { generateOutlook } from './lib/outlook.js';
import { getRedditBuzz, generateBuzzBrief } from './lib/buzz.js';
import { getMarketPredictions } from './lib/predictions.js';
import { generateThemeRadar } from './lib/radar.js';
import { generateMonopolyNote, generateMonopolyRadar } from './lib/monopoly.js';
import { generateMarketBrief, getMoversBoard, getCommoditiesBoard } from './lib/brief.js';
import { getMacroBoard, generateMacroBrief } from './lib/macro.js';
import { getFactorBoard, generateFactorBrief } from './lib/factors.js';
import { getEarningsCalendar } from './lib/earnings.js';
import { getAnalystRatings } from './lib/analyst.js';
import { getFundamentals } from './lib/fundamentals.js';
import { getPriceHistory, isEodhdConfigured } from './lib/eodhd.js';
import { isFredConfigured } from './lib/fred.js';
import { getSizeBoard } from './lib/size.js';
import { listManagers, getManagerBoard } from './lib/smartmoney.js';
import { startBackups, runBackupNow, listBackups, backupDir } from './lib/backup.js';
import { recordError, listErrors } from './lib/errlog.js';
import { getIndicators, getEconomicCalendar, generateEconomicBrief, getYieldCurve } from './lib/economy.js';
import { getMarketValuation, getYields, getValuationTheme, VALUATION_THEMES } from './lib/valuation.js';
import { getRiskBoard, generateRiskBrief } from './lib/risk.js';
import { getInsiderTransactions } from './lib/insider.js';
import { startWarmer, getWarmSnapshot, warmerStatus } from './lib/warmer.js';
import {
  validateCredentials, registerUser, verifyLogin, createSession, destroySession,
  attachUser, requireAuth, requireAdmin, isAdminUsername, sessionCookie, clearCookie, isSecureRequest,
  getUserState, putUserState, publicUser, listUsers, setUserStatus,
  changePassword, destroyAllSessions,
} from './lib/auth.js';
import { isProviderConfigured } from './lib/ai-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Trust X-Forwarded-* only when explicitly running behind a proxy (set TRUST_PROXY
// to the number of hops). Off by default so a directly-exposed server can't be
// fooled by spoofed X-Forwarded-For (rate-limit keying) or X-Forwarded-Proto.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false);
app.use(compression()); // gzip responses (the data endpoints ship large JSON)
app.use(express.json({ limit: '256kb' }));

// Content-Security-Policy: lock script/style/connect sources to 'self' plus the
// few external origins the app genuinely needs — TradingView embeds (Explorer) and
// the Google Fonts stylesheet. 'unsafe-inline' is required for React inline styles
// only (style-src), NOT for scripts. This sharply limits the blast radius of any
// injected markup.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' https://*.tradingview.com https://*.tradingview-widget.com",
  "connect-src 'self' https://*.tradingview.com https://*.tradingview-widget.com",
  "frame-src https://*.tradingview.com https://*.tradingview-widget.com",
  "worker-src 'self' blob:",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // clickjacking (legacy backstop to frame-ancestors)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  // HSTS only when actually served over HTTPS (req.secure honors trust proxy).
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// A generous overall cap on /api to absorb bursts, plus a much stricter cap on
// the AI endpoints (each call costs real money on Claude/Gemini).
const apiLimiter = rateLimit({
  windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});
const aiLimiter = rateLimit({
  windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'AI request limit reached — please wait a minute.' },
});
// Strict cap on auth attempts — brute-force / credential-stuffing defense (guide §5).
const authLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
});
// Dedicated cap for routes that stream a file off disk (backup download), on top
// of the global /api limiter — bounds the per-request filesystem read.
const fileLimiter = rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many download requests — please slow down.' },
});
app.use('/api', apiLimiter);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function requireFinnhub(res) {
  if (!process.env.FINNHUB_API_KEY) {
    res.status(503).json({ error: 'Market data unavailable: FINNHUB_API_KEY is not configured on the server.' });
    return false;
  }
  return true;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'AlphaNote',
    // Which build is actually serving — Render injects RENDER_GIT_COMMIT.
    commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
    integrations: {
      finnhub: Boolean(process.env.FINNHUB_API_KEY),
      eodhd: isEodhdConfigured(),
      fred: isFredConfigured(),
      ai: {
        primary: process.env.AI_PROVIDER || 'claude',
        fallback: process.env.AI_FALLBACK_PROVIDER || 'gemini',
        claude: isProviderConfigured('claude'),
        gemini: isProviderConfigured('gemini'),
      },
    },
    warmer: warmerStatus(),
  });
});

// ── Auth (public: register / login / me / logout) ─────────────────────────────
const setSession = (req, res, userId) => res.setHeader('Set-Cookie', sessionCookie(createSession(userId), { secure: isSecureRequest(req) }));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const invalid = validateCredentials(username, password);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const user = await registerUser(username, password);
    if (user.status !== 'active') {
      // Pending approval: do NOT start a session — the account can't be used yet.
      return res.status(202).json({ pending: true, message: 'Account created — an admin must approve it before you can sign in.' });
    }
    setSession(req, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === 'TAKEN') return res.status(409).json({ error: err.message });
    console.error('register failed:', err.message);
    recordError('register', err, { path: req.path });
    res.status(500).json({ error: 'Could not create the account right now.' });
  }
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await verifyLogin(username, password);
  // Identical generic error for unknown user vs wrong password (no enumeration).
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
  // Correct credentials but not yet approved / disabled (env-admins are exempt).
  if (user.status !== 'active' && !isAdminUsername(user.username)) {
    return res.status(403).json({ error: user.status === 'disabled' ? 'This account has been disabled.' : 'Your account is awaiting admin approval.' });
  }
  setSession(req, res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  attachUser(req);
  if (req.sessionToken) destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = attachUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json({ user: publicUser(user) });
});

// Change password (verifies the current one; revokes all sessions, re-issues this one).
app.post('/api/auth/change-password', authLimiter, requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const invalid = validateCredentials(req.user.username, newPassword);
  if (invalid) return res.status(400).json({ error: invalid });
  const ok = await changePassword(req.user.id, currentPassword, newPassword);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  setSession(req, res, req.user.id); // fresh session for this browser
  res.json({ ok: true, message: 'Password changed. Other sessions were signed out.' });
}));

// Log out everywhere: revoke every session for this account, including this one.
app.post('/api/auth/logout-all', requireAuth, (req, res) => {
  destroyAllSessions(req.user.id);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

// ── Auth gate: everything below requires a valid session ──────────────────────
app.use('/api', (req, res, next) => {
  if (attachUser(req)) return next();
  res.status(401).json({ error: 'Authentication required. Please log in.' });
});

// ── Per-user state (watchlist + notes) ────────────────────────────────────────
app.get('/api/user/state', (req, res) => res.json(getUserState(req.user.id)));
app.put('/api/user/state', (req, res) => {
  const { watchlist, notes } = req.body || {};
  putUserState(req.user.id, watchlist, notes);
  res.json({ ok: true });
});

// ── Admin only (env-designated admins) ────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ users: listUsers() }));

app.post('/api/admin/users/:id/approve', requireAdmin, (req, res) => {
  const ok = setUserStatus(Number(req.params.id), 'active');
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'User not found.' });
});
app.post('/api/admin/users/:id/disable', requireAdmin, (req, res) => {
  const ok = setUserStatus(Number(req.params.id), 'disabled');
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'User not found.' });
});

// ── Admin: recent server errors (in-app ring buffer, redacted) ────────────────
app.get('/api/admin/errors', requireAdmin, (req, res) => res.json({ errors: listErrors() }));

// ── Admin: database backups (list / trigger / download a snapshot) ────────────
app.get('/api/admin/backups', requireAdmin, (req, res) => res.json({ backups: listBackups() }));
app.post('/api/admin/backups/run', requireAdmin, wrap(async (req, res) => {
  res.json({ ok: true, backups: await runBackupNow() });
}));
app.get('/api/admin/backups/:name/download', requireAdmin, fileLimiter, (req, res) => {
  // Resolve the request against the server-generated backup list and serve the
  // matched entry. The download path is built from the on-disk listing, never
  // from the user-supplied parameter, so traversal is impossible by construction.
  const requested = path.basename(String(req.params.name || ''));
  const match = listBackups().find((b) => b.name === requested);
  if (!match) return res.status(404).json({ error: 'Backup not found.' });
  res.download(path.join(backupDir(), match.name));
});

// ── Search / quote / profile / watchlist / news (from OpenStock) ──────────────
app.get('/api/search', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json({ results: await searchStocks(req.query.q) });
}));

app.get('/api/quote/:symbol', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const quote = await getQuote(req.params.symbol);
  if (!quote) return res.status(502).json({ error: 'Could not load the latest quote. Try again shortly.' });
  res.json({ symbol: req.params.symbol.toUpperCase(), quote });
}));

app.get('/api/profile/:symbol', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json({ symbol: req.params.symbol.toUpperCase(), profile: (await getCompanyProfile(req.params.symbol)) || null });
}));

app.get('/api/watchlist', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbols = String(req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  res.json({ items: await getWatchlistData(symbols) });
}));

app.get('/api/news', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbols = req.query.symbols ? String(req.query.symbols).split(',').map((s) => s.trim()).filter(Boolean) : [];
  res.json({ articles: await getNews(symbols) });
}));

// ── ReturnSignal-style: market movers (cross-sectional returns for tables + Plotly)
app.get('/api/market/movers', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  if (req.query.symbols) {
    const symbols = String(req.query.symbols).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40);
    return res.json(await getMoversBoard(symbols, false)); // custom set: uncached
  }
  // Prefer the background-warmed snapshot (always complete); fall back to a
  // pull fetch only before the warmer has populated it (first seconds of boot).
  res.json(getWarmSnapshot('movers') || await getMoversBoard());
}));

// ── Commodities board (ETF-proxy day moves; warmed snapshot, else pull) ───────
app.get('/api/market/commodities', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json(getWarmSnapshot('commodities') || await getCommoditiesBoard());
}));

// ── ReturnSignal-style: wire feed for the bottom ticker marquee ────────────────
app.get('/api/daily-update/wire-feed', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const articles = await getNews([]);
  res.json({
    mode: articles.length ? 'live' : 'quiet',
    items: articles.map((a) => ({ headline: a.headline, source: a.source, url: a.url, datetime: a.datetime })),
  });
}));

// ── Price history (EODHD end-of-day; tight free quota → cached 12h) ───────────
app.get('/api/history/:symbol', wrap(async (req, res) => {
  res.json(await getPriceHistory(req.params.symbol));
}));

// ── Smart Money (EDGAR 13F institutional holdings, curated managers) ──────────
// ── Reddit buzz: trending tickers across finance subreddits (keyless) ────────
app.get('/api/social/buzz', wrap(async (req, res) => {
  res.json(await getRedditBuzz());
}));

// Polymarket crowd odds on macro/market events (keyless, 1h cache).
app.get('/api/social/predictions', wrap(async (req, res) => {
  res.json(await getMarketPredictions());
}));

// Monopoly research: per-ticker structural-monopoly profile + discovery radar.
app.post('/api/ai/monopoly', aiLimiter, wrap(async (req, res) => {
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI research unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await generateMonopolyNote(req.body?.topic, { force: req.body?.force === true }));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('monopoly failed:', err.message);
    recordError('monopoly', err, { path: req.path });
    res.status(status).json({
      error: [400, 404].includes(status) ? err.message : 'The AI providers could not generate the monopoly profile right now. Please try again.',
    });
  }
}));

app.post('/api/ai/monopoly-radar', aiLimiter, wrap(async (req, res) => {
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI radar unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await generateMonopolyRadar({ force: req.body?.force === true }));
  } catch (err) {
    console.error('monopoly-radar failed:', err.message);
    recordError('monopoly-radar', err, { path: req.path });
    res.status(502).json({ error: 'The AI providers could not generate the monopoly radar right now. Please try again.' });
  }
}));

// Theme Radar: emerging, not-yet-named speculative themes mined from the live
// signal (broad HN + buzz threads + Polymarket). 3h cache; force regenerates.
app.post('/api/ai/theme-radar', aiLimiter, wrap(async (req, res) => {
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI radar unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await generateThemeRadar({ force: req.body?.force === true }));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('theme-radar failed:', err.message);
    recordError('theme-radar', err, { path: req.path });
    res.status(status).json({
      error: status === 503 ? err.message : 'The AI providers could not generate the theme radar right now. Please try again.',
    });
  }
}));

// AI synthesis of the buzz board ("Retail Pulse"). Cached per board snapshot.
app.post('/api/ai/buzz-brief', aiLimiter, wrap(async (req, res) => {
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI briefs unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await generateBuzzBrief({ force: req.body?.force === true }));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('buzz-brief failed:', err.message);
    recordError('buzz-brief', err, { path: req.path });
    res.status(status).json({
      error: status === 503 ? err.message : 'The AI providers could not generate the Retail Pulse right now. Please try again.',
    });
  }
}));

app.get('/api/smartmoney', (req, res) => res.json({ managers: listManagers() }));
app.get('/api/smartmoney/:cik', wrap(async (req, res) => {
  res.json(await getManagerBoard(req.params.cik));
}));

// ── Company fundamentals (SEC EDGAR XBRL — real financials from filings) ──────
app.get('/api/fundamentals/:symbol', wrap(async (req, res) => {
  try {
    res.json(await getFundamentals(req.params.symbol));
  } catch (err) {
    console.error('fundamentals failed:', err.message);
    recordError('fundamentals', err, { path: req.path });
    res.status(502).json({ error: 'Could not load SEC filings data right now.' });
  }
}));

// ── Analyst ratings consensus (free /stock/recommendation) ────────────────────
app.get('/api/analyst/:symbol', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  try {
    res.json(await getAnalystRatings(req.params.symbol));
  } catch (err) {
    console.error('analyst ratings failed:', err.message);
    recordError('analyst ratings', err, { path: req.path });
    res.status(502).json({ error: 'Could not load analyst ratings right now.' });
  }
}));

// ── AI: per-stock insight (OpenStock) ─────────────────────────────────────────
app.post('/api/ai/insight', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = req.body?.symbol;
  if (!symbol) return res.status(400).json({ error: 'Please provide a stock symbol.' });
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI insights unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached(`insight:${String(symbol).toUpperCase()}`, 30 * 60_000, () => generateStockInsight(symbol)));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('insight failed:', err.message);
    recordError('insight', err, { path: req.path });
    res.status(status).json({
      error: status === 404 ? err.message : 'The AI providers could not generate an insight right now. Please try again.',
    });
  }
}));

// ── AI: full research note (deep-dive analyst persona) ───────────────────────
app.post('/api/ai/research', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const symbol = req.body?.symbol;
  if (!symbol) return res.status(400).json({ error: 'Please provide a stock symbol.' });
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI research unavailable: no AI provider key configured.' });
  }
  try {
    // generateResearchNote caches per symbol for 1h itself; force regenerates.
    res.json(await generateResearchNote(symbol, { force: req.body?.force === true }));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('research failed:', err.message);
    recordError('research', err, { path: req.path });
    res.status(status).json({
      error: status === 404 ? err.message : 'The AI providers could not generate a research note right now. Please try again.',
    });
  }
}));

// ── AI: speculative outlook (theme or ticker) ────────────────────────────────
app.post('/api/ai/outlook', aiLimiter, wrap(async (req, res) => {
  const topic = req.body?.topic;
  if (!topic) return res.status(400).json({ error: 'Please provide a theme or ticker.' });
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'AI outlooks unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await generateOutlook(topic, { force: req.body?.force === true }));
  } catch (err) {
    const status = err.statusCode || 502;
    console.error('outlook failed:', err.message);
    recordError('outlook', err, { path: req.path });
    res.status(status).json({
      error: status === 400 ? err.message : 'The AI providers could not generate an outlook right now. Please try again.',
    });
  }
}));

// ── Macro board (grouped ETF-proxy returns + cross-asset tone) ────────────────
app.get('/api/macro', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json(getWarmSnapshot('macro') || await getMacroBoard());
}));

// ── AI: macro read (cross-asset narrative) ────────────────────────────────────
app.get('/api/macro/brief', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'Macro read unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached('brief:macro', 15 * 60_000, generateMacroBrief));
  } catch (err) {
    console.error('macro brief failed:', err.message);
    recordError('macro brief', err, { path: req.path });
    res.status(502).json({ error: 'Could not generate the macro read right now. Please try again.' });
  }
}));

// ── Factors (factor-ETF returns + long/short spreads) ─────────────────────────
app.get('/api/factors', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json(await getFactorBoard());
}));

app.get('/api/factors/brief', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'Factor read unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached('brief:factors', 15 * 60_000, generateFactorBrief));
  } catch (err) {
    console.error('factor brief failed:', err.message);
    recordError('factor brief', err, { path: req.path });
    res.status(502).json({ error: 'Could not generate the factor read right now. Please try again.' });
  }
}));

// ── Economy: indicators (World Bank) + release calendar (Finnhub) + AI read ────
app.get('/api/economy/indicators', wrap(async (req, res) => {
  res.json(await getIndicators());
}));

app.get('/api/economy/calendar', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 30);
  res.json(await getEconomicCalendar({ days }));
}));

app.get('/api/economy/yield-curve', wrap(async (req, res) => {
  res.json(await getYieldCurve());
}));

app.get('/api/economy/brief', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'Economic read unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached('brief:economy', 15 * 60_000, generateEconomicBrief));
  } catch (err) {
    console.error('economic brief failed:', err.message);
    recordError('economic brief', err, { path: req.path });
    res.status(502).json({ error: 'Could not generate the economic read right now. Please try again.' });
  }
}));

// ── Valuation Explorer (market-level valuation vs own history) ────────────────
app.get('/api/valuation/market', wrap(async (req, res) => {
  res.json(await getMarketValuation());
}));

app.get('/api/valuation/yields', wrap(async (req, res) => {
  res.json(await getYields());
}));

// Size lens — small vs large caps from EODHD EOD history (cached 12h).
app.get('/api/valuation/size', wrap(async (req, res) => {
  res.json(await getSizeBoard());
}));

// Macro lenses (Growth / Quality / Leverage) — market-level FRED series per theme.
app.get('/api/valuation/theme/:tab', wrap(async (req, res) => {
  const tab = req.params.tab;
  if (!VALUATION_THEMES.includes(tab)) {
    return res.status(404).json({ error: `Unknown valuation lens "${tab}". Available: ${VALUATION_THEMES.join(', ')}.` });
  }
  res.json(await getValuationTheme(tab));
}));

// ── Risk Monitor (interest-rate / liquidity / FX stress gauges, FRED) ─────────
app.get('/api/risk', wrap(async (req, res) => {
  res.json(await getRiskBoard());
}));

app.get('/api/risk/brief', aiLimiter, wrap(async (req, res) => {
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'Risk read unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached('brief:risk', 15 * 60_000, generateRiskBrief));
  } catch (err) {
    console.error('risk brief failed:', err.message);
    recordError('risk brief', err, { path: req.path });
    res.status(502).json({ error: 'Could not generate the risk read right now. Please try again.' });
  }
}));

// ── Insider Explorer (Form 4 open-market buys/sells, curated universe) ────────
app.get('/api/insider', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json(await getInsiderTransactions());
}));

// ── Earnings calendar ─────────────────────────────────────────────────────────
app.get('/api/earnings', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 60);
  const symbols = req.query.symbols ? String(req.query.symbols).split(',').map((s) => s.trim()).filter(Boolean) : [];
  res.json(await getEarningsCalendar({ days, symbols }));
}));

// ── AI: market brief / narrative pulse (hybrid) ───────────────────────────────
app.get('/api/market/brief', aiLimiter, wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  if (!isProviderConfigured('claude') && !isProviderConfigured('gemini')) {
    return res.status(503).json({ error: 'Market brief unavailable: no AI provider key configured.' });
  }
  try {
    res.json(await cached('brief:market', 15 * 60_000, generateMarketBrief));
  } catch (err) {
    console.error('brief failed:', err.message);
    recordError('brief', err, { path: req.path });
    res.status(502).json({ error: 'Could not generate the market brief right now. Please try again.' });
  }
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── Static (production: serve the built Vite client) ──────────────────────────
if (isProd) {
  const dist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  // SPA fallback: any non-API route returns index.html (client-side routing).
  // Rate-limited so the per-request file read can't be hammered.
  app.get('*', apiLimiter, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  recordError('unhandled', err, { path: req.path, status: 500 });
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`\n  AlphaNote API → http://localhost:${PORT}  (${isProd ? 'production: serving client/dist' : 'dev: API only, run Vite separately'})`);
  console.log(`  Finnhub: ${process.env.FINNHUB_API_KEY ? 'configured' : 'MISSING'}  |  AI: ${process.env.AI_PROVIDER || 'claude'} → ${process.env.AI_FALLBACK_PROVIDER || 'gemini'}`);
  const warming = startWarmer();
  const backups = startBackups();
  // Keep the Reddit buzz board fresh so rank-change history accumulates even
  // without traffic. Off with the warmer (dev/preview) to stay quiet locally.
  let buzzing = false;
  if (process.env.WARMER_DISABLED !== '1') {
    buzzing = true;
    const refresh = () => getRedditBuzz({ force: true }).catch(() => {});
    setTimeout(refresh, 90_000); // after boot, clear of the warmer's first pass
    setInterval(refresh, 50 * 60_000);
  }
  console.log(`  Cache warmer: ${warming ? 'started (movers / commodities / macro kept warm)' : 'off'}  |  Buzz history: ${buzzing ? 'on (50min)' : 'off'}  |  DB backups: ${backups ? 'daily (keep 7)' : 'off'}\n`);
});
