# Security

A pragmatic security pass for AlphaNote, mapped to the AthenaGuard "Vibe Coder's
Security Handbook". AlphaNote is a **read-only markets-research dashboard**: a
React SPA plus an Express API that proxies public data sources (Finnhub, FRED,
multpl, World Bank, sec-api.io, API Ninjas) and two AI providers (Claude → Gemini).
There is **no database, no user accounts, no authentication, and no PII**.

## Secrets management
- All credentials are read from environment variables (`server/lib/env.js` loads
  `.env` with `override: true`). Nothing is hardcoded.
- `.env` (and `.env.*.local`, `.insider-cache.json`, `.claude/`) are git-ignored;
  only `.env.example` with placeholders is tracked.
- **Errors never leak keys.** Upstream fetch errors strip the query string (which
  carries the FRED `api_key`), and any client-facing `reason`/error text is run
  through `redactSecrets()` (`server/lib/valuation.js`), which scrubs
  `?key=…`/`token=…`, `sk-…`, and long hex tokens.
- Secrets scanning is configured via `.pre-commit-config.yaml` (gitleaks). Enable
  with `pre-commit install`; scan the tree with `pre-commit run --all-files`.

> **Action — rotate the keys that were pasted into chat during development**
> (Anthropic, Finnhub, Gemini, FRED, sec-api.io, API Ninjas). Pasting a real
> credential anywhere outside `.env` should be treated as a disclosure: rotate,
> revoke the old value, and check provider access logs.

## API hardening (Express)
- **Rate limiting:** 300 req/min per IP on `/api`, plus a stricter 20 req/min on
  the AI endpoints (which cost money). See `express-rate-limit` setup in `index.js`.
- **Generic errors:** all handlers return generic messages; stack traces and
  upstream details are never sent to the client.
- **Request size cap:** `express.json({ limit: '256kb' })`.
- **Security headers** on every response: `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `Strict-Transport-Security`
  when served over HTTPS.

## Content-Security-Policy
`script-src`/`connect-src`/`frame-src` are restricted to `'self'` plus the
TradingView embed origins; `style-src` allows `'unsafe-inline'` for React inline
styles **only** (not scripts), plus the Google Fonts stylesheet. `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'self'`.

## XSS
- The UI renders all dynamic and AI-generated text through React elements, which
  auto-escape. There is **no `dangerouslySetInnerHTML`** in the codebase.
- The TradingView embed config is injected with `textContent` (raw text, no HTML
  parsing), and the Explorer `?symbol=` param is constrained to a ticker charset —
  so a crafted symbol cannot break out of the embed `<script>`.

## Not applicable (and why)
- **SQL injection** — no database; data comes from HTTP APIs, and all symbol/query
  params are `encodeURIComponent`-escaped into URLs.
- **AuthN/AuthZ, IDOR, mass assignment** — no user accounts or user-owned
  resources; the API is read-only public market data.
- **CSRF** — no cookies/sessions; the API is stateless JSON.

## AI-specific risks
- The AI market/macro/risk briefs take news headlines and computed data as input.
  System prompts constrain the model to "use ONLY the data provided," and output
  is rendered as escaped text — so a malicious headline cannot execute code, only
  (at worst) skew wording.
- Dependencies are all real, well-known packages (no AI-hallucinated names).

## Reporting
This is a personal/research project. For a real deployment, add a vulnerability
disclosure contact here and wire the `ErrorBoundary` / server error handler to an
error-reporting service.
