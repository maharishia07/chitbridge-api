// [INV-02] Invoice row — the line as a document, and the row picker that hides what a business does not need.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[INV-02] the Invoice row shows the line on a tax invoice; the row picker hides and restores rows', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true });   /* asserts the untaxed total — its own entity */
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  expect(pid).toBeTruthy();

  await test.step('INVOICE — outcome and the document', async () => {
    await expect(page.getByTestId('prod-outcome-invoice')).toContainText('invoice', { timeout: 25000 });
    await page.getByTestId('prod-tab-invoice').click();
    await expect(page.getByTestId('prod-invoice')).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId('prod-invoice-line')).toContainText('Basmati 25kg');
    await expect(page.getByTestId('prod-invoice-total')).toContainText('1,000');   /* no slab yet: 0% — the total is the price */
    await page.getByTestId('prod-invoice-pos-other').click();
    await expect(page.getByTestId('prod-invoice')).toContainText('IGST');
  });

  await test.step('ROWS — hide Media for this business, then restore', async () => {
    await expect(page.getByTestId('prod-pane-media')).toHaveCount(1);
    await page.getByTestId('prod-rows-pick').click();
    await expect(page.getByTestId('prod-rows-grid')).toBeVisible();
    await page.getByTestId('prod-row-tick-media').uncheck();
    const saved = page.waitForResponse((r) => /\/api\/entities\/profile/.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-rows-save').click(); await saved;
    await expect(page.getByTestId('prod-pane-media')).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId('prod-pane-pricing')).toHaveCount(1);
    const me = await page.evaluate(async () => { const e = await api('me'); return (e.entity || e).ui_prefs; });
    expect(Array.isArray(me && me.product_rows) && me.product_rows.indexOf('media') < 0, 'the choice is stored on the entity').toBeTruthy();
    await page.getByTestId('prod-rows-pick').click();
    await page.getByTestId('prod-row-tick-media').check();
    const saved2 = page.waitForResponse((r) => /\/api\/entities\/profile/.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-rows-save').click(); await saved2;
    await expect(page.getByTestId('prod-pane-media')).toHaveCount(1, { timeout: 20000 });
  });
});
