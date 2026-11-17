// tax-takeover.spec.js — MODULE: A slab does not go dark under its products (Athi, 2026-09-05). Retiring a cited slab is refused until a takeover
// slab is named; the takeover re-points the product with the travelling rate; a dead citation falls through and offers
// the attach; a retired slab can be reinstated.
// LOCATORS: catset-sec-tax · catset-tax-new · cbdef-* · catset-tax-retire · cbdef-takeover(-go) · catset-tax-reinstate-* ·
//           prod-tax-resolved · prod-tax-attach · prod-tax-fix(-go) · prod-tax-preview-intra
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal, openTab } = require('../fixtures');

async function openProduct(page, prod) {
  await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
  const card = page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first();
  const id = (await card.getAttribute('data-testid')).replace('cat-product-', '');
  await card.click();
  return id;
}

test('[TAX-04] retire is refused while cited → takeover re-points → dead citation falls through and attaches → reinstate', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page);
  const prod = 'Takeover Rice ' + Date.now();
  await addProduct(page, { name: prod, price: 1000 });
  const id = await openProduct(page, prod);

  let ownId = null;
  await test.step('author an own slab (12%) and cite it on the product', async () => {
    const made = await page.evaluate(async () => api('defAdd', { body: { kind: 'tax', sub_kind: 'gst_slab', name: 'Own twelve', rules: { rate: 12 } } }));
    ownId = (made && (made.definition_id || (made.definition && made.definition.definition_id))) || null;
    expect(ownId, JSON.stringify(made).slice(0, 200)).toBeTruthy();
    await page.evaluate(async (i) => api('defSave', { params: { id: i }, body: { status: 'live' } }), ownId);
    const p = await page.evaluate(async (pid) => (UI.prods || []).find((x) => (x.item_id || x.id) === pid), id);
    await page.evaluate(async ([pid, sid, cur]) => api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, cur.item_data || cur, { tax_slab: sid, gst_rate: 12, tax_slab_name: 'Own twelve' }) } }), [id, ownId, p]);
  });

  await test.step('retire from the API without a takeover → 409 with the count', async () => {
    const cited = await page.evaluate(async (pid) => { const rows = await api('prodList'); const p = rows.find((x) => (x.item_id || x.id) === pid); return p && p.item_data && { tax_slab: p.item_data.tax_slab, gst_rate: p.item_data.gst_rate }; }, id);
    const r = await page.evaluate(async (i) => { try { return await api('defRetire', { params: { id: i } }); } catch (e) { return { error: String(e && e.message), status: e && e.status }; } }, ownId);
    console.log('CITED ' + JSON.stringify(cited) + ' RETIRE ' + JSON.stringify(r));
    expect(String((r && r.error) || JSON.stringify(r))).toMatch(/cite this slab/i);
  });

  await test.step('retire with takeover IN-GST-18 → the product now cites the governed slab at 18%', async () => {
    const r = await page.evaluate(async (i) => api('defRetire', { params: { id: i }, query: { takeover: 'IN-GST-18' } }), ownId);
    expect(r.retired).toBe(true); expect(r.moved.products).toBe(1);
    await clickNav(page, 'mis'); await settle(page);
    await openProduct(page, prod);
    await openTab(page, 'pricing');
    await expect(page.getByTestId('prod-tax-resolved')).toContainText('18%', { timeout: 25000 });
    await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '18');
  });

  await test.step('a DEAD citation (a slab id nobody has) falls through to the catalogue default and offers the attach', async () => {
    await page.evaluate(async () => api('catFacePut', { body: { face: Object.assign({}, (await api('catFaceGet').catch(() => ({}))).face || {}, { tax: { default_slab: 'IN-GST-5' } }) } }).catch(() => null));
    const p = await page.evaluate(async (pid) => (UI.prods || []).find((x) => (x.item_id || x.id) === pid), id);
    const cur = Object.assign({}, p.item_data || p); delete cur.gst_rate; delete cur.tax_slab_name; cur.tax_slab = 'ghost-slab-id';
    await page.evaluate(async ([pid, data]) => api('prodEdit', { params: { id: pid }, body: { item_data: data } }), [id, cur]);
    await clickNav(page, 'mis'); await settle(page);
    await openProduct(page, prod);
    await openTab(page, 'pricing');
    const said = page.getByTestId('prod-tax-resolved');
    await expect(said).toContainText('ghost-slab-id', { timeout: 25000 });
    await expect(said).toContainText('not active');
    await expect(page.getByTestId('prod-tax-attach')).toBeVisible();
    await page.getByTestId('prod-tax-fix').selectOption('IN-GST-28');
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-tax-fix-go').click(); await saved;
    await expect(page.getByTestId('prod-tax-resolved')).toContainText('28%', { timeout: 25000 });
    await expect(page.getByTestId('prod-tax-attach')).toHaveCount(0);
  });

  await test.step('Setup › Tax: the retired own slab can be reinstated', async () => {
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.evaluate(() => goCatsetSec('tax')); await settle(page);
    const secRow = page.getByTestId('catset-sec-tax'); await expect(secRow).toBeVisible({ timeout: 25000 }); await secRow.click(); await settle(page);
    const btn = page.getByTestId('catset-tax-reinstate-' + ownId);
    await expect(btn).toBeVisible({ timeout: 25000 });
    const live = page.waitForResponse((r) => /\/api\/definitions\//.test(r.url()) && r.request().method() === 'PUT' && r.status() < 400, { timeout: 30000 });
    await btn.click(); await live;
    await expect(page.getByTestId('catset-tax-live-' + ownId)).toBeVisible({ timeout: 25000 });
  });
});
