import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke tests. Playwright builds the client and boots the real
// Express server in production mode (it serves client/dist + /api on one port),
// against a throwaway SQLite file so the first registered account is auto-active
// and ADMIN_USERNAMES guarantees it stays active across reruns. No API keys are
// needed: the tests exercise the auth gate and shell, which are keyless. Data
// pages that need Finnhub/AI degrade to error states and are intentionally not
// asserted on here.
const PORT = 8099;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command:
      'rm -f /tmp/alphanote-e2e.db /tmp/alphanote-e2e.db-shm /tmp/alphanote-e2e.db-wal; '
      + 'npm run build && '
      + `NODE_ENV=production PORT=${PORT} DB_PATH=/tmp/alphanote-e2e.db `
      + 'WARMER_DISABLED=1 BACKUPS_DISABLED=1 ADMIN_USERNAMES=e2e_user '
      + 'node server/index.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
