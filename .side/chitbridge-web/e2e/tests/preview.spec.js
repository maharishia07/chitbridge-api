// [SF-01] Owner preview — a PRIVATE catalogue still shows the owner how a customer would see the product.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, addMedia, clickNav, settle } = require('../fixtures');
test('[SF-01] the Storefront row previews a private catalogue for its owner', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Dried Fruits test', unit: 'kg', price: 1000, code: 'DRU-S' });
  const id = await page.evaluate(() => UI.prodSel);
  await addMedia(page, id, { picture: false, video: true });
  await page.evaluate(async () => { await loadCatalogue('fresh'); paintProdList(); paintProdDetail(); });
  await settle(page);
  await expect(page.getByTestId('prod-outcome-storefront')).toContainText('Not public', { timeout: 25000 });
  await page.getByTestId('prod-tab-storefront').click();
  const frame = page.frameLocator('[data-testid="prod-storefront-frame"]');
  await expect(frame.locator('#p_list').getByText('Dried Fruits test').first()).toBeVisible({ timeout: 40000 });
  await expect(frame.locator('[data-testid="prod-media"] iframe').first()).toBeVisible({ timeout: 30000 });
  await expect(frame.getByText('Preview').first()).toBeVisible();
  /* a stranger still gets nothing */
  const uid = await page.evaluate(() => prodShopHandle());
  const anon = await page.evaluate(async (uid) => { const r = await fetch((CFG.API_BASE || '') + '/api/catalogue/' + encodeURIComponent(uid) + '?preview=1'); return r.status; }, uid);
  expect(anon).toBe(404);
});
