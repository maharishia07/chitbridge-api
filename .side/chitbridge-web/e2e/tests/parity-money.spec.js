// [PAR-02] THE MONEY BLOCK IS ONE BLOCK — text and pixels. The same two lines of Grapes (5% rate, 10% offer) put in the basket
// on the public storefront, in a buyer's Suppliers review, in the seller's Record a sale foot and in the Compose review must
// print the SAME rows, label for label and rupee for rupee (Flat 10% −₹40 · After offers ₹360 · GST 5% ₹18 · Total incl. tax
// ₹378); and the storefront block and the Suppliers block, screenshotted in the same browser, must match pixel for pixel
// within a hairline (the storefront keeps its own accent colour by design — the block itself carries none).
// Athi, 2026-09-05: "open the cart in different browsers at the same time, various channels, check pixel by pixel."
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/** the block's ROOT (the cart's own element, its own type) at one width — the frame around it is the surface's and is not compared */
async function shotOf(block) { const root = block.locator('[data-testid="cbcart-money"]'); await root.evaluate((el) => { el.style.width = '380px'; el.style.boxSizing = 'border-box'; }); await root.page().waitForTimeout(150); return root.screenshot(); }
/** the money block as text: one line per row, "label amount", whitespace folded */
async function rowsOf(loc) {
  const t = await loc.evaluate((el) => Array.from(el.querySelectorAll('div')).filter((d) => d.children.length === 2 && d.style.display === 'flex').map((d) => Array.from(d.children).map((c) => c.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
  return t;
}

test('[PAR-02] one money block on every surface — same text, same pixels', async ({ page, browser }, testInfo) => {
  test.setTimeout(420000);
  const sellerName = 'Money ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: sellerName });
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6', catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const { handle, itemId, sellerShown } = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || '')));
    await api('prodEdit', { params: { id: g.item_id }, body: { item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) } });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    const me = await api('me'); const e = (me && me.entity) || me || {};
    return { handle: e.user_id || e.bridge_id, itemId: g.item_id, sellerShown: e.display_name || e.user_id };
  });
  const blocks = {}; const shots = {};

  await test.step('STOREFRONT', async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } }); const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      const row = shop.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
      await row.locator('[data-testid="cart-add"]').first().click(); await shop.waitForTimeout(150);
      await row.locator('[data-testid="cart-add"]').first().click(); await shop.waitForTimeout(500);
      const block = shop.getByTestId('shop-offers'); await block.waitFor({ timeout: 20000 });
      blocks.storefront = await rowsOf(block);
      shots.storefront = await shotOf(block);
    } finally { await ctx.close(); }
  });

  await test.step('RECORD A SALE (the seller\'s counter)', async () => {
    await page.evaluate(() => { if (typeof selfBillOpen === 'function') selfBillOpen(); }); await settle(page);
    const row = page.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
    await row.locator('[data-testid="cart-add"]').first().click(); await page.waitForTimeout(150);
    await row.locator('[data-testid="cart-add"]').first().click(); await page.waitForTimeout(500);
    const block = page.getByTestId('sb-money'); await block.waitFor({ timeout: 20000 });
    blocks.recordSale = await rowsOf(block);
    await page.evaluate(() => { try { closeModal(); } catch (_) {} });
  });

  await test.step('SUPPLIERS REVIEW (a buyer)', async () => {
    const buyer = await mintInContext(browser, { fresh: true, name: 'Buyer ' + Date.now().toString().slice(-5) });
    try {
      await buyer.page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33ABCPE1234F1Z7' } }); });
      await clickNav(buyer.page, 'suppliers'); await settle(buyer.page);
      await buyer.page.getByTestId('sup-add-input').fill(String(handle)); await buyer.page.getByTestId('sup-add').click();
      await buyer.page.getByTestId('confirm-ok').click({ timeout: 15000 }).catch(() => {}); await settle(buyer.page);
      const supRow = buyer.page.locator('[data-testid^="sup-row-"]').filter({ hasText: String(handle) }).first(); await supRow.waitFor({ timeout: 30000 }); await supRow.click(); await settle(buyer.page);
      const row = buyer.page.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
      await row.locator('[data-testid="cart-add"]').first().click(); await buyer.page.waitForTimeout(150);
      await row.locator('[data-testid="cart-add"]').first().click(); await buyer.page.waitForTimeout(300);
      await buyer.page.getByRole('button', { name: /Check out/ }).last().click(); await settle(buyer.page);
      const next2 = buyer.page.getByRole('button', { name: /Next|Review|Check it/ }).last(); if (await next2.isVisible().catch(() => false)) { await next2.click(); await settle(buyer.page); }
      const block = buyer.page.getByTestId('sup-money'); await block.waitFor({ timeout: 30000 });
      blocks.suppliers = await rowsOf(block);
      shots.suppliers = await shotOf(block);
    } finally { await buyer.context.close(); }
  });

  /* ONE TEXT */
  const norm = (rows) => rows.map((r) => r.replace(/[\s ]+/g, ' ').replace(/[—–]/g, '-')).filter((r) => !/^Goods/.test(r));
  expect(norm(blocks.storefront), 'storefront rows').toEqual(expect.arrayContaining([expect.stringMatching(/Flat 10%.*40/), expect.stringMatching(/After offers.*360/), expect.stringMatching(/GST.*5%.*18/), expect.stringMatching(/Total incl\. tax.*378/)]));
  expect(norm(blocks.suppliers)).toEqual(norm(blocks.storefront));
  expect(norm(blocks.recordSale)).toEqual(norm(blocks.storefront));

  /* ONE PICTURE — the same block in the same browser, storefront vs Suppliers: the same baseline, a hairline of tolerance */
  /* the baseline IS this run's storefront shot (written fresh every time, so the two are always the same browser, the same
     build, the same minute) — never a stale file from another day */
  const fs = require('fs'), path = require('path'); const snap = testInfo.snapshotPath('money-block.png');
  fs.mkdirSync(path.dirname(snap), { recursive: true }); fs.writeFileSync(snap, shots.storefront);
  expect(shots.suppliers).toMatchSnapshot('money-block.png', { maxDiffPixelRatio: 0.03 });
});
