// signed-out.spec.js — a tab with no session must STAY on the login screen.
//
// THE BUG (Athi, 2026-08-08): *"I copied the URL and opened another incognito window… initially it opened the
// original store and on pressing again I got the null store, and not able to log out as well."* The header read
// `null null ·` above a fully rendered app shell, at #/login.
//
// The router was never wrong: no token at #/login renders the login form. renderApp() was — it painted the whole
// authenticated shell for ANY caller, and the 20-second auto-refresh timer was never cleared on logout. So a
// signed-out tab kept polling, its callbacks repainted the app over the login form with a null identity, and
// every logout was undone 20 seconds later.
//
// WHY IT NEEDS A BROWSER: the defect is time-based and lives entirely in the client. Nothing on the API side is
// wrong, no unit test can see it, and it only appears if you WAIT. This spec waits.
//
//   CB_WEB_BASE=https://chitbridge-web.vercel.app npx playwright test signed-out --project=noauth

const { test, expect } = require('@playwright/test');

test.describe('a signed-out tab stays signed out', () => {
  test.describe.configure({ timeout: 120_000 });

  test('#/login with no session shows the login form and never becomes the app', async ({ page }) => {
    await page.goto('/app.html#/login', { waitUntil: 'networkidle' });

    // The login screen, not the shell.
    await expect(page.locator('body')).not.toContainText('null null');
    await expect(page.getByTestId('nav-task')).toHaveCount(0);

    // THE WAIT IS THE TEST. The auto-refresh fires every 20s; a repaint would land inside this window.
    await page.waitForTimeout(45_000);

    const text = await page.locator('body').innerText();
    expect(text, 'the shell must not have repainted over the login screen').not.toContain('null null');
    expect(text).not.toMatch(/Task — chits received/);
    await expect(page.getByTestId('nav-task'), 'no authenticated nav may appear').toHaveCount(0);
    // And we are still where we started, not pushed into the app.
    expect(page.url()).toContain('#/login');
  });

  test('a deep authenticated route with no session redirects to login and stays there', async ({ page }) => {
    // The URL a person actually copies out of a signed-in window.
    await page.goto('/app.html#/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_000);
    expect(page.url(), 'an unauthenticated deep link must land on login').toContain('#/login');

    await page.waitForTimeout(30_000);
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('null null');
    await expect(page.getByTestId('nav-task')).toHaveCount(0);
  });
});
