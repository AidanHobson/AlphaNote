# Deploying AlphaNote

The app is a single Node process (Express API + built React client on one
origin) with a SQLite database — it needs a **persistent process and a writable
disk**, which is why the supported path is Render (or any equivalent:
Railway/Fly with a volume). Serverless hosts (e.g. Vercel functions) are NOT
supported as-is: read-only filesystem breaks SQLite, and cold starts kill the
cache warmer.

## Before you deploy
1. **Rotate every API key** that has ever been shared outside `.env`
   (see SECURITY.md). Use the new values below — never the old ones.
2. Have your admin username decided (`ADMIN_USERNAMES`).

## Render (one-click blueprint)
1. Sign in at https://render.com (GitHub sign-in is easiest).
2. **New + → Blueprint** → select the `AidanHobson/AlphaNote` repo.
3. Render reads `render.yaml` and prompts for the secret env vars
   (`ADMIN_USERNAMES`, the seven API keys, `SEC_USER_AGENT`). Paste the
   **rotated** values.
4. Deploy. First build takes a few minutes; the service is healthy when
   `/api/health` returns `{ ok: true }`.
5. Open the URL → register your admin username (it auto-activates if it matches
   `ADMIN_USERNAMES`) → approve other users from the Admin page.

**Cost:** the blueprint pins the `starter` instance (~$7/mo) because the
persistent disk (where `alphanote.db` lives) requires a paid instance.
A free-tier instance runs the app but its filesystem is **ephemeral** — every
deploy/restart wipes accounts, sessions, and notes — fine for a demo, wrong for
real use. To try it free anyway: remove the `disk:` block and `DB_PATH`, and set
`plan: free`.

## Operational notes
- **HTTPS** is automatic on Render; `TRUST_PROXY=1` (set in the blueprint) makes
  Secure cookies, HSTS, and per-IP rate limiting work correctly behind its proxy.
- **Quotas are shared by all users** of one deployment: Finnhub ~60 req/min
  (mitigated by the server-side warmer + caches), EODHD ~20 req/day (12h cache),
  AI calls cost real money (rate-limited 20/min). A handful of approved users is
  comfortable; a crowd is not.
- **Backups:** `alphanote.db` is a single file on the disk. A cron job (Render
  cron or in-app) copying it to object storage is the simple backup story.
- **CI** (build + tests + secret scan) runs on every push; deploys happen on
  push to `main` once the service is connected.
