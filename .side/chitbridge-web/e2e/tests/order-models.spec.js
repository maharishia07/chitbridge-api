// [OM-01..06] Order models — change the model and watch every other row follow: Order model · Pricing & tax · Invoice ·
// Offers · Storefront. Athi, 2026-09-04: "write specific use cases to change the order model and see how each model
// behaves — for example, invoice, if it is negotiation or price range?"
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

const MODELS = [
  { key: 'count',   order: { model: 'count' },                       word: 'whole units',        invoiceQty: '1 bag',  pricing: 'one unit after tax' },
  { key: 'pack',    order: { model: 'pack', step: 6 },               word: 'a pack multiple',    invoiceQty: '6 bag',  pricing: '6 bag after tax' },
  { key: 'measure', order: { model: 'measure', step: 0.5, min: 2 },  word: 'a measured amount',  invoiceQty: '2 bag',  pricing: '2 bag after tax' },
  { key: 'range',   order: { model: 'range', min: 10, max: 100 },    word: 'a range',            invoiceQty: '10 bag', pricing: '10 bag after tax' },
  { key: 'pick',    order: { model: 'pick' },                        word: 'pick',               invoiceQty: '1 bag',  pricing: 'one unit after tax' },
  { key: 'offer',   order: { model: 'offer' },                       word: 'buyer names the price', invoiceQty: '1 bag', pricing: 'indicative' },
];

test('[OM-01] each order model reaches the money rows and the storefront', async ({ page }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true });   /* authors definitions by name — its own entity */
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel);
  expect(pid).toBeTruthy();
  /* a live slab and an offer, so the rows have something to show */
  await page.evaluate(async ({ pid }) => {
    const slab = (await api('defAdd', { body: { kind: 'tax', name: 'GST 5', rules: { rate: 5 }, status: 'live' } })).definition.definition_id;
    await api('defAdd', { body: { kind: 'offer', name: 'Basmati 10% off', sub_kind: 'percent_off', rules: { kind: 'percent_off', percent: 10, applies_to: { item_ids: [pid] } }, status: 'live', confirmed: true } });
    const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid);
    await api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, p.item_data, { tax_slab: slab }) } });
    await cbDefsLive('tax', true); UI._ctOffers = undefined; await new Promise((ok) => ctOffersEnsure(ok));
  }, { pid });

  for (const m of MODELS) {
    await test.step(`MODEL ${m.key}`, async () => {
      await page.evaluate(async ({ pid, order }) => {
        const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid);
        await api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, p.item_data, { order }) } });
        UI._prodOpen = {}; await loadCatalogue('fresh'); paintProdList(); paintProdDetail();
      }, { pid, order: m.order });
      await settle(page);
      /* Order model row names the model */
      await expect(page.getByTestId('prod-outcome-ordermodel')).toContainText(m.word === 'pick' ? /one|pick/i : m.word, { timeout: 25000 });
      /* Pricing & tax prices the model's own quantity, or says the price is indicative */
      await expect(page.getByTestId('prod-outcome-pricing')).toContainText(m.pricing, { timeout: 25000 });
      /* Invoice line quantity follows the model */
      await page.getByTestId('prod-tab-invoice').click();
      await expect(page.getByTestId('prod-invoice-qty')).toContainText(m.invoiceQty, { timeout: 25000 });
      if (m.key === 'offer') {
        await expect(page.getByTestId('prod-invoice-negotiable')).toBeVisible();
        await expect(page.getByTestId('prod-outcome-invoice')).toContainText('agreed price');
        await expect(page.getByTestId('prod-outcome-offers')).toContainText('indicative');
        await page.getByTestId('prod-tab-storefront').click();
        await expect(page.getByTestId('prod-storefront-coherence')).toBeVisible({ timeout: 25000 });
      } else {
        await expect(page.getByTestId('prod-outcome-invoice')).not.toContainText('agreed price');
        await expect(page.getByTestId('prod-outcome-offers')).toContainText('Basmati 10% off');
      }
    });
  }
});
