// tax-categories.spec.js — MODULE: tax and offers at CATEGORY level, and the one-list-per-category view (Athi, 2026-09-05).
// LOCATORS: catset-tax-catgs · catset-tax-catg-<id> · catset-tax-register · catset-tax-conflict · catset-tax-clash · prod-tax-resolved
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal, openTab } = require('../fixtures');

test('[TAX-05] two categories with different slabs → first applies, conflict said; the register filters by category', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  const prod = 'Both Rice ' + Date.now();
  await addProduct(page, { name: prod, price: 500 });
  const ids = await page.evaluate(async (name) => {
    const mk = async (n, slab) => (await api('defAdd', { body: { kind: 'category', name: n, rules: { default_slab: slab }, status: 'live' } })).definition.definition_id;
    const grains = await mk('Grains ' + Date.now(), 'IN-GST-5');
    const rice = await mk('Rice ' + Date.now(), 'IN-GST-0');
    const rows = await api('prodList'); const p = rows.find((x) => ((x.item_data || x).name || '') === name);
    await api('prodEdit', { params: { id: p.item_id || p.id }, body: { item_data: Object.assign({}, p.item_data, { categories: [grains, rice] }) } });
    if (typeof _DEFS !== 'undefined') { delete _DEFS['category']; delete _DEFS['tax']; } UI._face = undefined;   /* created after the page cached them */
    return { grains, rice, pid: p.item_id || p.id };
  }, prod);

  await test.step('the product pane says the categories disagree, and the first (5%) applies', async () => {
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.getByTestId('cat-product-' + ids.pid).click();
    await openTab(page, 'pricing');
    const said = page.getByTestId('prod-tax-resolved');
    await expect(said).toContainText(/disagree/i, { timeout: 25000 });
    await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '5');
  });

  await test.step('Setup › Tax: the conflict is counted and flagged; the category chip narrows the list', async () => {
    await page.evaluate(() => goCatsetSec('tax')); await settle(page);
    const row = page.getByTestId('catset-sec-tax'); await expect(row).toBeVisible({ timeout: 25000 }); await row.click(); await settle(page);
    await expect(page.getByTestId('catset-tax-clash')).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId('catset-tax-conflict').first()).toContainText(/5%/);
    await page.getByTestId('catset-tax-catg-' + ids.rice).click();
    await expect(page.getByTestId('catset-tax-row-' + ids.pid)).toBeVisible({ timeout: 15000 });
    await page.getByTestId('catset-tax-catg-all').click();
  });

  await test.step("a CHILD category with no slab inherits its parent's; Categories shows it on the row and in the view", async () => {
    const kid = await page.evaluate(async (ids) => {
      const child = (await api('defAdd', { body: { kind: 'category', name: 'Dried ' + Date.now(), rules: { parent: ids.grains }, status: 'live' } })).definition.definition_id;
      const rows = await api('prodList'); const p = rows.find((x) => (x.item_id || x.id) === ids.pid);
      await api('prodEdit', { params: { id: ids.pid }, body: { item_data: Object.assign({}, p.item_data, { categories: [child] }) } });
      if (typeof _DEFS !== 'undefined') delete _DEFS['category'];
      return child;
    }, ids);
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.getByTestId('cat-product-' + ids.pid).click();
    await openTab(page, 'pricing');
    await expect(page.getByTestId('prod-tax-resolved')).toContainText(/inherits/i, { timeout: 25000 });
    await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '5');
    await clickNav(page, 'categories'); await settle(page);
    await expect(page.getByTestId('catg-tax-' + kid)).toContainText('5%', { timeout: 25000 });
    await page.getByTestId('catg-row-' + kid).click();
    await expect(page.getByTestId('catg-tax-applied')).toContainText(/inherited from/i, { timeout: 15000 });
  });
});
