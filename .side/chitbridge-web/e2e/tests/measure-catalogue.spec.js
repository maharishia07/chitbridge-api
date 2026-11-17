// measure-catalogue.spec.js — MEASUREMENT (kept): per phase, every API call with its real duration (resource timings). Runs only with MEASURE=1 —
// it is a ruler, not a test. Baseline 2026-09-05 (Railway sfo ↔ Supabase Mumbai): every call 1.4–2.4 s. Re-run after a region move.
const { test } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal } = require('../fixtures');
test('measure catalogue round trips', async ({ page }) => {
  test.skip(!process.env.MEASURE, 'set MEASURE=1 to run the ruler');
  test.setTimeout(240000);
  await mintEntity(page);
  await addProduct(page, { name: 'Measure one ' + Date.now(), price: 100 });
  const phase = async (name, fn) => {
    await page.evaluate(() => performance.clearResourceTimings());
    const t0 = Date.now(); await fn(); await settle(page); const wall = Date.now() - t0;
    await page.waitForTimeout(800);
    const res = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/api\//.test(e.name)).map((e) => ({ u: e.name.replace(/^https?:\/\/[^/]+/, ''), ms: Math.round(e.duration), start: Math.round(e.startTime) })));
    console.log('PHASE ' + name + ' · ' + res.length + ' calls · ' + wall + 'ms until settled\n' + res.map((c) => '   ' + c.u + ' ' + c.ms + 'ms (t+' + c.start + ')').join('\n'));
  };
  await clickNav(page, 'mis'); await settle(page);
  await phase('open Catalogue', async () => { await clickNav(page, 'catalogue'); await dismissModal(page); });
  await phase('open the product', async () => { await page.locator('[data-testid^="cat-product-"]').first().click(); });
  await phase('Pricing & tax tab', async () => { await page.getByTestId('prod-tab-pricing').click(); });
  await phase('Edit', async () => { await page.getByTestId('cat-edit').click(); });
  await phase('idle 25s (the periodic refresh)', async () => { await page.waitForTimeout(25000); });
});
