import './lib/env.js'; // load .env (override) before anything reads process.env
import express from 'express';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached } from './lib/apicache.js';

import { getQuote, getCompanyProfile, getWatchlistData, getNews, searchStocks } from './lib/finnhub.js';
import { generateStockInsight } from './lib/insight.js';
import { generateMarketBrief, getMoversBoard } from './lib/brief.js';
import { getMacroBoard, generateMacroBrief } from './lib/macro.js';
import { getFactorBoard, generateFactorBrief } from './lib/factors.js';
import { getEarningsCalendar } from './lib/earnings.js';
import { getAnalystRatings } from './lib/analyst.js';
import { getIndicators, getEconomicCalendar, generateEconomicBrief, getYieldCurve } from './lib/economy.js';
import { getMarketValuation, getYields } from './lib/valuation.js';
import { getInsiderTransactions } from './lib/insider.js';
import { isProviderConfigured } from './lib/ai-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(compression()); // gzip responses (the data endpoints ship large JSON)
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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
    integrations: {
      finnhub: Boolean(process.env.FINNHUB_API_KEY),
      ai: {
        primary: process.env.AI_PROVIDER || 'claude',
        fallback: process.env.AI_FALLBACK_PROVIDER || 'gemini',
        claude: isProviderConfigured('claude'),
        gemini: isProviderConfigured('gemini'),
      },
    },
  });
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
  res.json(await getMoversBoard()); // default basket: cached 20s, empties not cached
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

// ── Analyst ratings consensus (free /stock/recommendation) ────────────────────
app.get('/api/analyst/:symbol', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  try {
    res.json(await getAnalystRatings(req.params.symbol));
  } catch (err) {
    console.error('analyst ratings failed:', err.message);
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
    res.status(status).json({
      error: status === 404 ? err.message : 'The AI providers could not generate an insight right now. Please try again.',
    });
  }
}));

// ── Macro board (grouped ETF-proxy returns + cross-asset tone) ────────────────
app.get('/api/macro', wrap(async (req, res) => {
  if (!requireFinnhub(res)) return;
  res.json(await getMacroBoard());
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
    res.status(502).json({ error: 'Could not generate the market brief right now. Please try again.' });
  }
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── Static (production: serve the built Vite client) ──────────────────────────
if (isProd) {
  const dist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  // SPA fallback: any non-API route returns index.html (client-side routing).
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`\n  AlphaNote API → http://localhost:${PORT}  (${isProd ? 'production: serving client/dist' : 'dev: API only, run Vite separately'})`);
  console.log(`  Finnhub: ${process.env.FINNHUB_API_KEY ? 'configured' : 'MISSING'}  |  AI: ${process.env.AI_PROVIDER || 'claude'} → ${process.env.AI_FALLBACK_PROVIDER || 'gemini'}\n`);
});
