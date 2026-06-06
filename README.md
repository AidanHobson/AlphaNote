# AlphaNote

**A markets-research dashboard — a hybrid of [ReturnSignal] and [OpenStock].**

AlphaNote takes ReturnSignal's professional analytics-dashboard architecture (a
pure client-rendered **React + Vite + TypeScript** SPA, sidebar + topbar shell,
semantic CSS design tokens with light/dark themes, **lazy-loaded Plotly charts**,
a same-origin JSON REST API, a live "wire" ticker, and **Markdown report export**)
and powers it with OpenStock's real integrations: **Finnhub** market data,
**TradingView** charts, and **AI insights via Claude → Gemini fallback**.

The "Note" in AlphaNote is its own twist: per-ticker **research notes** you can
write and **export as a Markdown report** enriched with live quotes.

> Not a brokerage. Market data may be delayed. AI output is generated automatically
> and is **not financial advice**.

[ReturnSignal]: #
[OpenStock]: https://github.com/Open-Dev-Society/OpenStock

---

## ✨ Pages

| Page | What it does | Hybrid lineage |
| --- | --- | --- |
| **Daily Update** | Tabbed (Live / Movers / News): market-regime card, **AI Narrative Pulse**, **Plotly** cross-sectional returns, equities table, **wire ticker** | ReturnSignal shell + OpenStock data/AI |
| **Asset Explorer** | Search → live quote hero, **TradingView** price/technicals/profile/financials, **Claude AI insight**, **analyst ratings consensus** (distribution + trend), add-to-watchlist & add-note | OpenStock stock detail in ReturnSignal layout |
| **Valuation Explorer** | **Market** tab: US market valuation vs its own full history — Shiller CAPE, Buffett Indicator, Trailing P/E, **Price/Book, Price/Sales**, Dividend/Earnings yield, Fed Model Spread — percentile-colored (rich=red/cheap=green) with sparklines + click-to-expand full-history charts. **Yields** tab: Treasury curve (Fed Funds → 30Y, FRED) + S&P dividend/earnings yields vs own history | ReturnSignal "Valuation Explorer" + Shiller(multpl)/FRED |
| **Macro** | Cross-asset dashboard: computed tone, **AI Macro Read**, Plotly cross-asset returns, grouped tables (Equity Indices, Rates & Credit, FX, Commodities, Crypto) via liquid ETF proxies | ReturnSignal "Macro" + grouped market tables + OpenStock data/AI |
| **Factors** | Style-factor leadership, **AI Factor Read**, Plotly single-factor returns + long/short rotation spreads (Value−Growth, Small−Large, High Beta−Low Vol…) via factor-ETF proxies | ReturnSignal "Factors" + OpenStock data/AI |
| **Economy** | US macro indicator cards with history, **AI Economic Read**, a **live Treasury yield curve**, and an economic-release calendar (high/medium impact, country flags, actual/est/prev). Indicators come from **FRED** (monthly) when `FRED_API_KEY` is set, else **World Bank** (annual) — no key needed | ReturnSignal "Economic Data" + FRED/World Bank + Finnhub |
| **Insider Explorer** | **Market-wide** Form 4 insider buys/sells (sec-api.io → API Ninjas → EDGAR fallback chain) — Transactions / By-Company / By-Insider views; filters for time, side, **plan (Discretionary/10b5-1)**, **role (officers/directors)**, exclude-10%-holders, ticker, insider, market cap, min $; role/title + plan columns, summary stats, CSV export | ReturnSignal "Insider Explorer" + SEC EDGAR Form 4 |
| **Earnings Calendar** | Upcoming reports (3 wks) grouped by date with before/after-market timing + EPS/revenue estimates; Notable / My-watchlist filter | ReturnSignal "Earnings Calendar" + Finnhub `/calendar/earnings` |
| **Watchlist** | Per-device list with a Plotly returns chart + table | OpenStock watchlist + ReturnSignal Plotly |
| **Research Notes** | Per-ticker notes + **Markdown report export** (enriched with live quotes) | ReturnSignal ReportMarkdown + AlphaNote notes |

Plus: light/dark theme toggle, debounced search, skeleton loaders, graceful error
states, and a bottom wire marquee.

---

## 🏗️ Architecture

```
Browser (React SPA, Vite)  ──/api/*──▶  Express JSON API (server/)  ──▶  Finnhub
   sidebar + topbar shell        same-origin             ├─▶ Claude (Anthropic)  ← primary
   lazy routes + Plotly chunk                            └─▶ Gemini (Google)     ← fallback
   TradingView embeds (client)
```

- **Pure CSR**, exactly like ReturnSignal: `index.html` ships an empty `<div id="root">`.
- **Same-origin API**: in dev, Vite proxies `/api` → the Express server; in prod,
  the Express server serves the built `client/dist` *and* `/api` on one port.
- **Code-splitting**: each route is a lazy chunk; **Plotly is its own ~4.7 MB chunk**
  that only downloads on chart-bearing pages (verified in the build output).
- **All API keys are server-side** in `.env`, read via `process.env`, never sent to
  the browser. The SPA only ever calls this app's `/api/*`.

---

## 🧱 Project structure

```
alphanote/
├── package.json            # one install; scripts for dev + build + start
├── vite.config.ts          # Vite (root: client) + /api dev proxy
├── tsconfig.json
├── .env.example            # required env vars (placeholders)
├── .env                    # your real keys (gitignored)
├── server/
│   ├── index.js            # Express: /api routes + serves client/dist in prod
│   └── lib/                # finnhub, ai-provider (Claude+Gemini), insight, brief, utils, constants, env
└── client/
    ├── index.html
    └── src/
        ├── main.tsx, App.tsx          # entry + lazy router
        ├── layout/  Shell, Sidebar, TopBar
        ├── pages/   DailyUpdate, Explorer, Watchlist, Notes
        ├── components/  Card, Tabs, Chart(Plotly), TradingView, Ticker,
        │                MarketTable, AIInsight, AIText, SearchBar, …
        ├── lib/     api, format, storage, models, tvConfigs
        └── styles/  index.css   (design tokens: light + dark)
```

---

## 🔌 API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Configured integrations (booleans only) |
| `GET` | `/api/search?q=` | Symbol search |
| `GET` | `/api/quote/:symbol` | Live quote |
| `GET` | `/api/profile/:symbol` | Company profile |
| `GET` | `/api/watchlist?symbols=A,B` | Quote + profile per symbol |
| `GET` | `/api/news?symbols=` | Market / company news |
| `GET` | `/api/market/movers` | Cross-sectional returns + market regime |
| `GET` | `/api/market/brief` | **AI Narrative Pulse** (Claude → Gemini) |
| `GET` | `/api/valuation/market` | Market valuation metrics vs own history (percentiles, sparklines, full series) |
| `GET` | `/api/valuation/yields` | Treasury curve + equity yields vs own history |
| `GET` | `/api/macro` | Cross-asset board (grouped ETF-proxy returns) + tone |
| `GET` | `/api/macro/brief` | **AI Macro Read** (Claude → Gemini) |
| `GET` | `/api/factors` | Factor returns + long/short rotation spreads |
| `GET` | `/api/factors/brief` | **AI Factor Read** (Claude → Gemini) |
| `GET` | `/api/earnings?days=&symbols=` | Earnings calendar (analyst-covered + watchlist) |
| `GET` | `/api/insider` | Market-wide Form 4 insider buys/sells (sec-api.io primary, EDGAR fallback; enriched + cached) |
| `GET` | `/api/economy/indicators` | Macro indicators with history (World Bank, no key) |
| `GET` | `/api/economy/calendar?days=` | Economic release calendar, high/medium impact |
| `GET` | `/api/economy/yield-curve` | Live US Treasury yield curve + 2s10s (FRED; graceful if no key) |
| `GET` | `/api/economy/brief` | **AI Economic Read** (Claude → Gemini) |
| `GET` | `/api/daily-update/wire-feed` | Headlines for the wire ticker |
| `GET` | `/api/analyst/:symbol` | Analyst ratings consensus + 6-mo trend (free `/stock/recommendation`) |
| `POST` | `/api/ai/insight` `{symbol}` | **Per-stock AI insight** (Claude → Gemini, now analyst-aware) |

---

## 🤸 Quick start

**Prerequisites:** Node.js 20+.

```bash
cd alphanote
npm install              # installs server + client deps (one tree)

cp .env.example .env     # then fill in FINNHUB_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
```

### Development (hot reload, two processes via proxy)
```bash
npm run dev
# → API server on http://localhost:8080
# → Vite dev server on http://localhost:5173  (open this; /api is proxied to 8080)
```

### Production (single origin, like ReturnSignal)
```bash
npm run build            # Vite → client/dist (hashed assets, lazy Plotly chunk)
npm start                # Express serves client/dist + /api on http://localhost:8080
```

Health check: `curl -s localhost:8080/api/health`

---

## 🔑 Environment variables

| Variable | Required | Default |
| --- | --- | --- |
| `PORT` | no | `8080` |
| `FINNHUB_API_KEY` | **yes** | — |
| `FINNHUB_BASE_URL` | no | `https://finnhub.io/api/v1` |
| `AI_PROVIDER` | no | `claude` |
| `AI_FALLBACK_PROVIDER` | no | `gemini` |
| `ANTHROPIC_API_KEY` | for Claude | — |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-4-6` |
| `GEMINI_API_KEY` | for Gemini | — |
| `GEMINI_MODEL` | no | `gemini-2.5-flash-lite` |
| `FRED_API_KEY` | no | _(blank → World Bank)_ — optional; enables FRED monthly indicators + live yield curve. Free key: fredaccount.stlouisfed.org/apikeys |

---

## 🔎 Notes on the data

- **Free Finnhub tier has no historical candles** (`/stock/candle` → 403), so the
  Plotly charts show **cross-sectional returns** (today's % change across a basket /
  your watchlist). Historical time-series come from the **TradingView** widgets,
  which carry their own data.
- TradingView's legacy `company-profile` embed now 403s — AlphaNote uses the current
  `symbol-profile` widget instead.
- **Analyst data:** Finnhub's numeric price-target endpoint (`/stock/price-target`) is
  premium (403 on free), as are eps/revenue estimates and upgrade/downgrade. AlphaNote
  uses the **free `/stock/recommendation`** endpoint — the analyst **ratings consensus**
  (strongBuy/buy/hold/sell counts) — and clearly labels that price targets need a paid
  plan. The AI **never** fabricates price targets.
- **Valuation Explorer:** CAPE / trailing P/E / dividend & earnings yield come from Robert
  Shiller's monthly S&P 500 dataset (via **multpl.com**); the Buffett Indicator + Fed Model
  Spread come from **FRED**. Percentiles are computed against each metric's own full history.
  The **Market** and **Yields** tabs are fully live on free data; the remaining lenses
  (Valuation/Quality/Leverage/Growth/Size by sector & country) need a premium per-company
  fundamentals dataset and show an honest placeholder.
- **Insider data:** the Insider Explorer is **market-wide**, with a 3-tier fallback chain so
  it keeps working if any source is down:
  1. **sec-api.io** (`SEC_API_KEY`) — structured Form 4 API, paginated; parses issuer / insider
     / **role & title** / code / shares / price + the **10b5-1 plan** flag (`aff10b5One`).
     Yields ~**1,600+ transactions across ~400 companies** in seconds. (Raise `INSIDER_PAGES`
     for even more on a paid plan.)
  2. **API Ninjas** (`NINJAS_API_KEY`) — per-ticker insider transactions (`limit=100`)
     aggregated across a curated ~85-name universe → **~2,000+ transactions / ~2 years of
     history across ~80 companies**; role inferred from the insider's position; used when
     sec-api is unavailable (e.g. quota exhausted).
  3. **SEC EDGAR daily index** (no key) — parses Form 4 submissions directly; final fallback.
  Results are cached in memory **and on disk** (`.insider-cache.json` at the project root, so
  every server process shares it), letting a restarted server serve the last scan instantly.
  The Transactions table supports 7-day / 30 / 90 / 1Y / All time windows. Market cap & sector
  are best-effort enriched via Finnhub.
- **Economic data:** Finnhub's `/calendar/economic` *is* free on this tier (used for the
  release calendar). Macro indicator *levels* prefer **FRED** (monthly CPI/Core CPI,
  unemployment, Fed funds, GDP, 10Y + a live Treasury yield curve) when `FRED_API_KEY` is
  set; otherwise they fall back to the **World Bank API** (free, no key, **annual** figures
  labeled with their vintage). An invalid/blank FRED key safely degrades to World Bank, and
  the yield-curve card shows a "needs FRED" note rather than a blank chart.

## 🔐 Security
- Keys live only in the gitignored `.env`; the browser never sees them.
- All third-party text (news, AI output) is rendered through React (escaped).
- `.env.example` ships placeholders only. **Rotate any key shared in plaintext.**

## 🩺 Troubleshooting
- *"Market data unavailable"* → `FINNHUB_API_KEY` missing/invalid.
- *AI shows "(primary unavailable)"* → Claude key/credits issue; Gemini fallback is
  covering. Add Anthropic credits to switch back to Claude (no code change).
- *Charts say "unavailable"* → TradingView CDN blocked on your network (auto-retries first).
- *Plotly chunk is large* → expected; it's lazy-loaded only on chart pages.

---

Derived from the open-source **OpenStock** (© Open Dev Society, AGPL-3.0) and a
ReturnSignal-architecture build guide. Structure & patterns only — no proprietary
code or data.
