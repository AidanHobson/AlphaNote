

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

### Key-security audit (last run 2026-06-11)
Verified, with commands, across every place a key could leak:
- **Storage:** all 7 keys (Finnhub, Anthropic, Gemini, sec-api.io, API Ninjas,
  FRED, EODHD) live only in `.env` — gitignored and untracked.
- **Git history:** every commit scanned for every real key pattern — zero hits.
- **Client bundle:** zero key values in any built chunk (the only `API_KEY`
  string in `client/dist` is a UI tooltip naming the env var). Client code reads
  no env vars; all data flows through the server proxy.
- **Runtime:** `/api/health` exposes configured/not booleans only; client-facing
  error `reason`s pass through `redactSecrets()`; upstream errors carry HTTP
  status only (URLs with tokens are never thrown or logged).
- **Logs:** server output scanned — zero key fragments.

> **Action — rotate the keys that were pasted into chat during development**
> (Anthropic, Finnhub, Gemini, FRED, sec-api.io, API Ninjas, EODHD). The code
> can't protect a credential that was disclosed outside it: rotate, revoke the
> old value, and check provider access logs.

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

## Authentication (multi-user)
Accounts, sessions and per-user state live in a local SQLite DB (`server/lib/db.js`).
Controls follow the guide's §5 checklist (`server/lib/auth.js`):
- **Passwords** hashed with **bcrypt (cost 12)** — never stored or compared in
  plaintext. Registration enforces username/length rules.
- **Login is enumeration-resistant:** identical generic error for unknown-user vs
  wrong-password, and a constant-time bcrypt compare against a dummy hash when the
  user doesn't exist (no timing oracle).
- **Sessions** are 32-byte random tokens stored server-side (so they're
  **revocable** — logout deletes the row), delivered in an **`httpOnly`,
  `SameSite=Lax`** cookie (`Secure` when over HTTPS) with a 7-day expiry.
- **Brute-force defense:** the auth routes are rate-limited to 10 attempts / 15 min
  per IP.
- **Admin approval:** new sign-ups are created `pending` and get **no session** —
  an admin must approve them before they can log in (the first user and any
  `ADMIN_USERNAMES` are auto-active so you can't lock yourself out). Disabling a
  user revokes their access mid-session.
- **Authorization:** all `/api` routes except `/health` and `/auth/*` are behind an
  auth gate; per-user state is keyed to the session's user id (no IDOR — a user can
  only read/write their own watchlist/notes).

> The SQLite file suits a persistent process (local, Render, Railway, Fly). It does
> **not** work on a read-only serverless filesystem (e.g. Vercel functions) — use a
> hosted Postgres/managed SQLite there.

## Not applicable (and why)
- **SQL injection** — all DB access uses **parameterized prepared statements**
  (better-sqlite3 bound params); external data comes from HTTP APIs with
  `encodeURIComponent`-escaped params.
- **CSRF** — the session cookie is `SameSite=Lax` and the API only accepts JSON
  (`Content-Type: application/json`), so cross-site form posts can't drive it. (A
  CSRF token would be the next step if cookie auth is exposed to third-party origins.)
- **Mass assignment** — endpoints read only the specific fields they expect
  (`username`/`password`, `watchlist`/`notes`), never spread request bodies into
  records.

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
