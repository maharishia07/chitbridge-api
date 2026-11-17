// [LIF-01] Lifecycle and History rows — status, the parked change, since-when; every cut version with what changed.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[LIF-01] Lifecycle shows the state; History shows the versions and what changed', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  expect(pid).toBeTruthy();

  await test.step('LIFECYCLE — available, since today; the Status control lives here', async () => {
    await expect(page.getByTestId('prod-outcome-lifecycle')).toContainText('Available', { timeout: 25000 });
    await page.getByTestId('prod-tab-lifecycle').click();
    await expect(page.getByTestId('prod-lifecycle-status')).toContainText('Available');
    await expect(page.getByTestId('prod-lifecycle')).toContainText('Since');
  });

  await test.step('HISTORY — v1 created; a price edit cuts v2 with the change named', async () => {
    await page.getByTestId('prod-tab-history').click();
    await expect(page.getByTestId('prod-history')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('[data-testid="prod-history-row"]')).toHaveCount(1);
    await expect(page.getByTestId('prod-outcome-history')).toContainText('v1');
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('cat-field-price').fill('1200');
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
    await page.getByTestId('cat-save').click(); await saved;
    await settle(page);
    await page.getByTestId('prod-tab-history').click();
    await expect(page.locator('[data-testid="prod-history-row"]')).toHaveCount(2, { timeout: 25000 });
    await expect(page.locator('[data-testid="prod-history-row"]').first()).toContainText('Price');
    await expect(page.locator('[data-testid="prod-history-row"]').first()).toContainText('1,200');
    await expect(page.getByTestId('prod-outcome-history')).toContainText('v2');
  });

  await test.step('LIFECYCLE — a change parked for a date shows here', async () => {
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('cat-field-price').fill('1300');
    const at = new Date(Date.now() + 3 * 3600 * 1000); const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.getByTestId('cat-field-effective').fill(local);
    const parked = page.waitForResponse((r) => /\/schedule$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('cat-save').click(); await parked;
    await settle(page);
    await expect(page.getByTestId('prod-outcome-lifecycle')).toContainText('parked', { timeout: 25000 });
    await page.getByTestId('prod-tab-lifecycle').click();
    await expect(page.getByTestId('prod-scheduled')).toBeVisible({ timeout: 25000 });
  });
});
