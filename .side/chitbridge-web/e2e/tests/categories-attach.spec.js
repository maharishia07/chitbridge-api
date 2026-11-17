// categories-attach.spec.js — [CAT-05] Categories › Edit › product ticks: attach a product to a category FROM the category side.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[CAT-05] a tick on the category attaches the product; the product page and the row follow', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  expect(pid).toBeTruthy();
  const cname = 'Rice ' + Date.now();
  const cid = await page.evaluate(async (cname) => (await api('defAdd', { body: { kind: 'category', name: cname, rules: {}, status: 'live' } })).definition.definition_id, cname);

  await clickNav(page, 'categories');
  await page.getByText(cname, { exact: true }).first().click();   /* the capability script loads lazily — drive the row, not the function */
  await page.getByTestId('catg-edit').click();
  await page.getByTestId('catg-etab-products').click();   /* the Products tab = the catalogue pane */
  await expect(page.getByTestId('catg-prod-ticks')).toBeVisible({ timeout: 25000 });
  const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
  await page.getByTestId('cat-product-' + pid).click();   /* the same row as the Catalogue screen; a click ticks */
  await saved;
  await settle(page);
  const stored = await page.evaluate(async ({ pid }) => { const r = await api('prodList', { query: { limit: 200 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid); return p && catgIdsOf(p.item_data || p); }, { pid });
  expect(stored, 'the product carries the category').toContain(cid);

  await test.step('VIEW — the category lists the product', async () => {
    await page.getByText('Cancel', { exact: true }).first().click().catch(() => {});
    await page.getByText(cname, { exact: true }).first().click();   /* the capability script loads lazily — drive the row, not the function */
    await expect(page.locator('#detailpane .cbcat-plist').first()).toContainText('Basmati 25kg', { timeout: 20000 });
  });

  await test.step('PRODUCT — its Categories row shows the category', async () => {
    await clickNav(page, 'catalogue');
    await page.evaluate((pid) => selectProduct(pid, true), pid);
    await expect(page.getByTestId('prod-outcome-categories')).toContainText('Rice', { timeout: 20000 });
  });
});
