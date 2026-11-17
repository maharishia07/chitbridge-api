/* morning-shots.cjs — Photograph what shipped overnight (2026-09-03 → 04) for Athi's morning check: the rebuilt Edit-offer modal
 * (laptop + phone), the product's Offers tab with the cart preview, Catalogue setup › Tax, and the product's
 * Pricing & tax pane with the invoice split. Runs against the DEPLOYED app on a fresh entity, exactly the way the
 * specs do — a screenshot of prod is evidence; a screenshot of a mock is a drawing.
 *   CB_WEB_BASE=https://chitbridge-web.vercel.app node e2e/morning-shots.cjs */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { mintEntity, addProduct, clickNav, settle, dismissModal } = require('./fixtures');
const OUT = path.join(__dirname, 'morning-shots');
fs.mkdirSync(OUT, { recursive: true });

const isDefWrite = (r, m) => /\/api\/definitions/.test(r.url()) && r.request().method() === m && r.status() < 400;

(async () => {
  const browser = await chromium.launch();
  const base = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, baseURL: base });
  const page = await ctx.newPage();
  const shot = async (name, loc) => {
    await page.waitForTimeout(600);
    await (loc || page).screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  ✓ ' + name + '.png');
  };
  const openSec = async (sec) => { await clickNav(page, 'catsetup'); await page.getByTestId('catset-sec-' + sec).click(); await settle(page); };
  try {
    await mintEntity(page);
    const prod = 'Ponni Rice 10kg';
    await addProduct(page, { name: prod, price: 620 });

    /* ── OFFER: author 10% off, make live, attach ── */
    await openSec('offers');
    await page.getByTestId('catset-offer-new').click();
    await page.getByTestId('cbdef-name').waitFor();
    const sub = page.getByTestId('cbdef-sub'); if (await sub.count()) await sub.selectOption('percent_off');
    await page.getByTestId('cbdef-name').fill('Adi one day offer');
    await page.getByTestId('cbdef-rule-percent').fill('10');
    await shot('1-offer-form-laptop', page.locator('#modalhost .modal'));
    let w = page.waitForResponse((r) => isDefWrite(r, 'POST'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click(); await w; await settle(page);
    const row = page.locator('.catset-drow', { hasText: 'Adi one day' }).first();
    w = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await row.getByText('Make live', { exact: true }).click(); await w; await settle(page);
    await shot('2-setup-offers-list', page.locator('.catset-dlist').first());

    /* phone view of the same form: open Edit at a phone viewport */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await settle(page); await dismissModal(page);
    await openSec('offers');
    await page.locator('.catset-drow', { hasText: 'Adi one day' }).first().getByText('Edit', { exact: true }).click();
    await page.getByTestId('cbdef-name').waitFor({ timeout: 20000 });
    await shot('3-offer-form-phone');
    await page.getByText('Cancel', { exact: true }).first().click().catch(() => {});
    await page.setViewportSize({ width: 1366, height: 860 });
    await page.reload(); await settle(page); await dismissModal(page);

    /* attach on the product, photograph the cart preview */
    await clickNav(page, 'catalogue'); await settle(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-offers').click();
    const chip = page.getByTestId('prod-pane-offers').locator('[data-testid^="cat-offer-"]').first();
    await chip.waitFor({ timeout: 20000 });
    w = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await chip.click(); await w; await settle(page);
    await page.getByTestId('prod-offer-preview').waitFor({ timeout: 20000 });
    await shot('4-product-offers-cart-preview', page.locator('#detailpane'));

    /* ── TAX: a slab, live, catalogue default, then the product pane ── */
    await openSec('tax');
    await shot('5-setup-tax-before');
    await page.getByTestId('catset-tax-new').click();
    await page.getByTestId('cbdef-name').waitFor();
    const tsub = page.getByTestId('cbdef-sub'); if (await tsub.count()) await tsub.selectOption('gst_slab').catch(() => {});
    await page.getByTestId('cbdef-name').fill('GST 5%');
    const rate = page.getByTestId('cbdef-rule-rate'); if (await rate.count()) await rate.fill('5');
    w = page.waitForResponse((r) => isDefWrite(r, 'POST'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click(); await w; await settle(page);
    const trow = page.locator('.catset-drow', { hasText: 'GST 5%' }).first();
    w = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await trow.getByText('Make live', { exact: true }).click(); await w; await settle(page);
    await shot('6-setup-tax-slabs');

    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-pricing').click();
    const sel = page.getByTestId('prod-tax-slab'); await sel.waitFor({ timeout: 20000 });
    const opts = await sel.locator('option').allTextContents();
    const gst = opts.find((o) => /GST 5%/.test(o));
    if (gst) await sel.selectOption({ label: gst });
    await page.waitForTimeout(800);
    await shot('7-product-pricing-tax-edit', page.locator('#detailpane'));
    w = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH', { timeout: 45000 });
    await page.getByTestId('cat-save').click(); await w; await settle(page);
    await page.getByTestId('prod-tab-pricing').click();
    await page.getByTestId('prod-tax-resolved').waitFor({ timeout: 20000 });
    await shot('8-product-pricing-tax-view', page.locator('#detailpane'));
    console.log('\nShots in ' + OUT);
  } catch (e) { console.error('FAILED: ' + e.message); await shot('99-failed').catch(() => {}); process.exitCode = 1; }
  finally { await browser.close(); }
})();
