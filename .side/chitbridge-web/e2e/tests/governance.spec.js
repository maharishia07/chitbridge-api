// [GOV-01] Governance or override — never two directions. A product's own slab NAMES the category slab it displaces;
// a product may opt OUT of a category offer, and the engine (product page, cart) honours it.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[GOV-01] the override is named on tax; a product can exclude a category offer', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  expect(pid).toBeTruthy();
  const ids = await page.evaluate(async ({ pid }) => {
    const slab5 = (await api('defAdd', { body: { kind: 'tax', name: 'GST 5', rules: { rate: 5 }, status: 'live' } })).definition.definition_id;
    const slab18 = (await api('defAdd', { body: { kind: 'tax', name: 'GST 18', rules: { rate: 18 }, status: 'live' } })).definition.definition_id;
    const cat = (await api('defAdd', { body: { kind: 'category', name: 'Rice ' + Date.now(), rules: { default_slab: slab5 }, status: 'live' } })).definition.definition_id;
    const offer = (await api('defAdd', { body: { kind: 'offer', name: 'Rice 10% off', sub_kind: 'percent_off', rules: { kind: 'percent_off', percent: 10, applies_to: { category_ids: [cat] } }, status: 'live', confirmed: true } })).definition.definition_id;
    const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid);
    await api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, p.item_data, { categories: [cat], tax_slab: slab18 }) } });
    return { slab5, slab18, cat, offer };
  }, { pid });
  await page.evaluate(async () => { await cbDefsLive('tax', true); await cbDefsLive('category', true); UI._ctOffers = undefined; await new Promise((ok) => ctOffersEnsure(ok)); await loadCatalogue('fresh'); paintProdList(); paintProdDetail(); });   /* definitions were made outside the screen (null = in flight for offers; undefined = reload) */
  await settle(page);

  await test.step('TAX — the product\'s 18% names the category\'s 5% as the override', async () => {
    await expect(page.getByTestId('prod-outcome-pricing')).toContainText('18', { timeout: 30000 });
    await expect(page.getByTestId('prod-outcome-pricing')).toContainText('override', { timeout: 30000 });
    await expect(page.getByTestId('prod-outcome-pricing')).toContainText('5%');
  });

  await test.step('OFFER — inherited via the category, applied; then excluded on the product', async () => {
    await expect(page.getByTestId('prod-outcome-offers')).toContainText('Rice 10% off', { timeout: 30000 });
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-offers').click();
    const chip = page.getByTestId('cat-offer-' + ids.offer);
    await expect(chip).toHaveAttribute('data-via', /.+/, { timeout: 25000 });
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('cat-offer-exclude-' + ids.offer).click(); await saved;
    await expect(page.getByTestId('cat-offer-' + ids.offer)).toHaveAttribute('data-excluded', '1', { timeout: 25000 });
    const on = await page.evaluate(() => { const p = (UI.prods || []).find((x) => prodId(x) === UI.prodSel); return prodOffersOn(pData(p)).map((o) => o.name); });
    expect(on, 'the engine no longer sees the excluded offer on this product').not.toContain('Rice 10% off');
    await page.getByText('Cancel', { exact: true }).first().click();
    await settle(page);
    await expect(page.getByTestId('prod-outcome-offers')).not.toContainText('Rice 10% off', { timeout: 25000 });
  });
});
