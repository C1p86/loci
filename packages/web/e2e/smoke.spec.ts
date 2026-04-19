import { test, expect } from '@playwright/test';

test.describe('smoke flow', () => {
  const randomId = Math.random().toString(36).slice(2, 8);
  const email = `e2e+${randomId}@example.com`;
  const password = 'CorrectHorseBatteryStaple-2026';

  test('signup → login → agents empty state → tasks → history → logout', async ({ page }) => {
    // 1. Signup (via UI)
    await page.goto('/signup');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(password);

    // confirm + org name fields if present
    const confirm = page.getByLabel(/confirm/i);
    if (await confirm.count()) await confirm.fill(password);
    const orgName = page.getByLabel(/organization|org name/i);
    if (await orgName.count()) await orgName.fill(`E2E Org ${randomId}`);
    await page.getByRole('button', { name: /sign\s*up/i }).click();

    // 2. Wait for redirect — signup may go to /login (email verify) or /agents (auto-verify in test mode)
    await page.waitForURL(/\/login|\/agents/, { timeout: 10_000 });

    // 3. Login if we were redirected to /login
    if (page.url().includes('/login')) {
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click();
      await page.waitForURL('**/agents', { timeout: 10_000 });
    }

    // 4. Agents page — empty state should show registration token UI
    await expect(page.getByText(/no agents registered/i)).toBeVisible();
    await page.getByRole('button', { name: /generate registration token/i }).click();
    await expect(page.locator('pre').filter({ hasText: 'xci --agent' })).toBeVisible();

    // 5. Tasks page loads
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i })).toBeVisible();

    // 6. History page loads
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: /history/i })).toBeVisible();

    // 7. Logout via top nav dropdown — graceful if selector varies slightly
    const userMenuButton = page.getByRole('button', { name: new RegExp(email.replace('+', '\\+'), 'i') });
    if (await userMenuButton.count()) {
      await userMenuButton.click();
      await page.getByRole('menuitem', { name: /log\s*out/i }).click();
      await page.waitForURL('**/login', { timeout: 10_000 });
    }
  });
});
