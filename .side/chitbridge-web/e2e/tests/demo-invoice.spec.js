// DEMO screen — the Invoice row as a document, with a live slab and an offer on the line. DEMO=1.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');
const path = require('path');
test.skip(!process.env.DEMO, 'DEMO=1 to capture');

test('[DEMO-INVOICE] the invoice row', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page);
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5', address: 'Bengaluru' } }); UI._me = null; });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  await page.evaluate(async ({ pid }) => {
    const slab = (await api('defAdd', { body: { kind: 'tax', name: 'GST 5% · rice', rules: { rate: 5, hsn: ['1006'] }, status: 'live' } })).definition.definition_id;
    await api('defAdd', { body: { kind: 'offer', name: 'Basmati 10% off', sub_kind: 'percent_off', rules: { kind: 'percent_off', percent: 10, applies_to: { item_ids: [pid] } }, status: 'live', confirmed: true } });
    const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid);
    const d = Object.assign({}, p.item_data, { tax_slab: slab, xref: [{ role: 'buyer', system: 'Acme Ltd', id: 'A-778', direction: 'in' }] });
    await api('prodEdit', { params: { id: pid }, body: { item_data: d } });
  }, { pid });
  await page.evaluate(async () => { UI._prodOpen = {}; UI._me = await meTake(); await cbDefsLive('tax', true); await cbDefsLive('category', true); UI._ctOffers = undefined; await new Promise((ok) => ctOffersEnsure(ok)); await loadCatalogue('fresh'); paintProdList(); paintProdDetail(); });   /* the definitions were made outside the screen: refresh every cache first */
  await settle(page);
  await page.getByTestId('prod-tab-invoice').click();
  await expect(page.getByTestId('prod-invoice')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('prod-invoice').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(__dirname, '..', 'demo-out', '8-invoice-row.png') });
  console.log('OUTCOME ' + await page.getByTestId('prod-outcome-invoice').textContent());
});
