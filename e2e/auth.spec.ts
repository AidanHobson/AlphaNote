import { test, expect, type Page } from '@playwright/test';

// Fixed creds; ADMIN_USERNAMES=e2e_user (see playwright.config) keeps the account
// active on every run, and the throwaway DB is wiped at server start.
const USER = 'e2e_user';
const PASS = 'e2e-pass-12345';

// Register the account, or fall back to logging in if a reused dev server already
// has it (the CI server always starts on a fresh DB, so it registers there).
async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('button', { name: 'Create one' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Create account' }).click();

  const signedIn = page.getByRole('button', { name: 'Sign out' });
  const taken = page.getByText(/already taken/i);
  await expect(signedIn.or(taken)).toBeVisible();

  if (await taken.isVisible()) {
    // Account exists from a previous run — sign in instead.
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Username').fill(USER);
    await page.getByLabel('Password').fill(PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(signedIn).toBeVisible();
}

test('health endpoint is public and reports ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.app).toBe('AlphaNote');
  expect(body.integrations).toBeTruthy();
});

test('an unauthenticated deep link still shows the login screen', async ({ page }) => {
  await page.goto('/research');
  // The whole app is gated: until authenticated, every URL renders Login.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});

test('register → land in the app → sign out → back to login', async ({ page }) => {
  await signIn(page);

  // The dashboard shell is mounted: redirected to the default route and the
  // sidebar navigation is present.
  await expect(page).toHaveURL(/\/daily-update$/);
  await expect(page.getByRole('link', { name: 'Asset Explorer' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});
