// [IDN-01] Identifiers — a buyer's id on the product resolves their order line, and travels out on the composed line.
//   npx playwright test tests/identifiers.spec.js --project=authed
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[IDN-01] a buyer\'s item code is one of the product\'s identifiers: it shows, it matches, it travels', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const id = await page.evaluate(() => UI.prodSel);
  expect(id).toBeTruthy();

  await test.step('VIEW — the row lists our code as the seller\'s id', async () => {
    await expect(page.getByTestId('prod-outcome-barcode')).toContainText('BAS-25');
  });

  await test.step('EDIT — add the buyer\'s id, saved at once', async () => {
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-barcode').click();
    await page.getByTestId('cat-field-xref-role').selectOption('buyer');
    await page.getByTestId('cat-field-xref-system').fill('Acme Ltd');
    await page.getByTestId('cat-field-xref-id').fill('A-778');
    await page.getByTestId('cat-field-xref-dir').selectOption('in');
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('cat-xref-add').click(); await saved;
    await expect(page.getByTestId('prod-xref')).toContainText('A-778', { timeout: 20000 });
    const stored = await page.evaluate(async (id) => { const r = await api('prodList', { query: { limit: 200 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === id); return p && p.item_data && p.item_data.xref; }, id);
    expect(Array.isArray(stored) && stored[0] && stored[0].id === 'A-778' && stored[0].role === 'buyer', 'xref stored on the product').toBeTruthy();
    await page.getByText('Cancel', { exact: true }).first().click();
    await settle(page);
    await expect(page.getByTestId('prod-outcome-barcode')).toContainText('Acme Ltd A-778');
  });

  await test.step('COMPOSE — a typed line quoting THEIR code resolves to our product and carries their id', async () => {
    await clickNav(page, 'compose');
    await page.locator('#cc_mname').fill('A-778');
    await page.locator('#cc_mprice').fill('1000');
    await page.getByTestId('chit-item-add').click();
    await page.waitForFunction(() => Array.isArray(CC.items) && CC.items[0] && CC.items[0].item_id, null, { timeout: 20000 });
    const line = await page.evaluate(() => ({ item_id: CC.items[0].item_id, particulars: CC.items[0].particulars, their_ref: CC.items[0].their_ref }));
    expect(line.item_id).toBe(id);
    expect(line.particulars).toBe('Basmati 25kg');
    expect(line.their_ref && line.their_ref.id).toBe('A-778');
  });
});
