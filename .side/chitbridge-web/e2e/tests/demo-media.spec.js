// DEMO screens — the customer view of a product with a picture and a video. Run with DEMO=1.
//   DEMO=1 npx playwright test tests/demo-media.spec.js --project=authed
// Writes e2e/demo-out/6-storefront-row.png (the product page's Storefront row, framed) and
// e2e/demo-out/7-customer-phone.png (shop.html itself at phone size, opened on this one product).
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, addMedia, clickNav, settle } = require('../fixtures');
const path = require('path');
test.skip(!process.env.DEMO, 'DEMO=1 to capture');

test('[DEMO-MEDIA] the customer view with a picture and a video', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page);
  await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const id = await page.evaluate(() => UI.prodSel);   /* addProduct returns {name, price}; the item id is the selection */
  expect(id, 'the new product must be selected').toBeTruthy();
  const media = await addMedia(page, id, { picture: true, video: true });
  console.log('MEDIA', JSON.stringify(media).slice(0, 300));
  expect(media.picture, 'the picture must land (b204 ran?)').toBeTruthy();
  await page.evaluate(async () => { await loadCatalogue('fresh'); paintProdList(); paintProdDetail(); });
  await settle(page);
  await page.getByTestId('prod-tab-media').click();
  await expect(page.locator('[data-testid^="prod-media-"] img').first()).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: path.join(__dirname, '..', 'demo-out', '5b-media-row.png') });
  await page.getByTestId('prod-tab-storefront').click();
  const frame = page.frameLocator('[data-testid="prod-storefront-frame"]');
  await expect(frame.locator('[data-testid="prod-media"] img').first()).toBeVisible({ timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(__dirname, '..', 'demo-out', '6-storefront-row.png') });
  /* the shop page itself, on a phone */
  const uid = await page.evaluate(() => prodShopHandle());
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto('/shop.html?s=' + encodeURIComponent(uid) + '&item=' + encodeURIComponent(id));
  await expect(phone.locator('[data-testid="prod-media"] img').first()).toBeVisible({ timeout: 40000 });
  await phone.waitForTimeout(3000);
  await phone.screenshot({ path: path.join(__dirname, '..', 'demo-out', '7-customer-phone.png'), fullPage: true });
  await phone.close();
});
