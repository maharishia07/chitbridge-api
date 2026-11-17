// MODULE: Publish on a date — a product change parked for a moment, applied on the first read after it (lib/schedule.js).
// LOCATORS: cat-field-effective · cat-save · prod-scheduled(-row) · prod-unschedule · cat-view-price ; API via api().
// ⚠️ SKIPS HONESTLY when b203 has not run (the API says enabled:false) — a dark feature is not a failing one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal } = require('../fixtures');

test('[CAT-04] a future price is parked, shown beside the live one, cancellable; a due one lands on the next read', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  const prod = 'Dated Rice ' + Date.now();
  await addProduct(page, { name: prod, price: 1000 });
  await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
  const card = page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first();
  const id = (await card.getAttribute('data-testid')).replace('cat-product-', '');
  await card.click();

  const st = await page.evaluate(async (id) => api('prodScheduled', { params: { id } }), id);
  test.skip(!st.enabled, 'b203 catalogue_item_schedule not run — scheduling is dark');

  await test.step('EDIT with a future moment parks ONLY the price; the live price is untouched', async () => {
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('cat-field-price').fill('1200');
    const at = new Date(Date.now() + 2 * 3600 * 1000);
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.getByTestId('cat-field-effective').fill(local);
    const parked = page.waitForResponse((r) => /\/schedule$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('cat-save').click(); await parked;
    await expect(page.getByTestId('prod-scheduled-row').first()).toContainText('1,200', { timeout: 20000 });
    await expect(page.getByTestId('cat-view-price')).toContainText('1,000');
  });

  await test.step('CANCEL removes the parked change', async () => {
    const gone = page.waitForResponse((r) => /\/schedule\//.test(r.url()) && r.request().method() === 'DELETE' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-tab-lifecycle').click();   /* fact sheet: the parked strip sits in the Lifecycle row */
    await page.getByTestId('prod-unschedule').first().click(); await gone;
    await expect(page.getByTestId('prod-scheduled')).toHaveCount(0, { timeout: 20000 });
  });

  await test.step('a change whose moment has PASSED lands on the next catalogue read', async () => {
    const r = await page.evaluate(async (id) => api('prodSchedule', { params: { id }, body: { effective_at: new Date(Date.now() - 60000).toISOString(), item_data: { price: 1300 } } }), id);
    expect(r && r.scheduled, JSON.stringify(r).slice(0, 200)).toBeTruthy();
    await clickNav(page, 'mis'); await settle(page);   /* leave the catalogue so the next open is a fresh list read */
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await expect(page.getByTestId('cat-view-price')).toContainText('1,300', { timeout: 25000 });
  });
});
