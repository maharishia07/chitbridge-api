// parity.spec.js — [PAR-01] ONE PRODUCT, TWO SURFACES, ONE ANSWER. The seller's Grapes carry a 5% rate and a 10% offer. Seen from the public
// storefront and from a buyer's Suppliers screen, the row must show the same listed price, the same tax line and the same
// offer promise — because both read the same catalogue view and render through the same picker. Athi, 2026-09-05: "either
// storefront or from supplier or through API all should have the same principle … single source of truth".
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, settle, dismissModal } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[PAR-01] the storefront and the Suppliers screen show the same price, tax and offer for one product', async ({ page, browser, request }) => {
  test.setTimeout(360000);
  const sellerName = 'Parity ' + Date.now().toString().slice(-6);
  const sellerEmail = await mintEntity(page, { fresh: true, name: sellerName });
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6', catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  /* the rate straight on the product (a bare rate resolves like a slab), and a live 10% offer on the whole catalogue */
  const { handle, itemId, email } = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || ''))); const id = g.item_id || g.id;
    await api('prodEdit', { params: { id }, body: { item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) } }).catch(async () => { await fetch(CFG.API_BASE + '/api/products/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) }) }); });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    const me = await api('me'); const e = (me && me.entity) || me || {};
    return { handle: e.user_id || e.bridge_id, itemId: id, email: e.email };
  });
  const cat = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(handle))).json();
  const g = (cat.items || []).find((x) => x.item_id === itemId);
  expect(g && g.tax && Number(g.tax.rate), 'the catalogue view attaches the 5%').toBe(5);
  expect((cat.offers || []).some((o) => o.kind === 'percent_off' && Number(o.percent) === 10), 'the live 10% rides the same payload').toBeTruthy();

  /* SURFACE 1 — the public storefront: the row, then TWO in the basket and the basket's total incl. tax */
  const shopCtx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const shop = await shopCtx.newPage();
  let shopTax = '', shopOffer = '', shopPrice = '', shopTotal = '';
  try {
    await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
    const row = shop.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
    shopTax = (await shop.getByTestId('cbcat-tax-' + itemId).textContent()).trim();
    shopOffer = (await row.locator('.cbcat-off').first().textContent().catch(() => '')).trim();
    shopPrice = (await row.locator('.cbcat-pr').textContent()).trim();
    await row.locator('[data-testid="cart-add"]').first().click(); await shop.waitForTimeout(200);
    await row.locator('[data-testid="cart-add"]').first().click(); await shop.waitForTimeout(400);
    shopTotal = (await shop.getByTestId('shop-total').first().textContent()).trim();   /* 2 × 200 − 10% = 360 + 5% = 378 */
  } finally { await shopCtx.close(); }

  /* SURFACE 2 — a buyer's Suppliers screen, the seller added by email */
  const buyer = await mintInContext(browser, { fresh: true, name: 'Buyer ' + Date.now().toString().slice(-5) });
  let supTax = '', supOffer = '', supPrice = '', supTotal = '';
  try {
    await clickNav(buyer.page, 'suppliers'); await settle(buyer.page);
    /* the add box takes a name, a User ID or an email — the handle is the one we surely have */
    await buyer.page.getByTestId('sup-add-input').fill(String(handle));
    await buyer.page.getByTestId('sup-add').click();
    /* the add asks for a confirmation — the suppliers spec's own step: confirm-ok, never a dismiss (that cancels the add) */
    await buyer.page.getByTestId('confirm-ok').click({ timeout: 15000 }).catch(() => {}); await settle(buyer.page);
    /* a fresh entity is shown by its handle, not the name asked for */
    const supRow = buyer.page.locator('[data-testid^="sup-row-"]').filter({ hasText: String(handle) }).first();
    await supRow.waitFor({ timeout: 30000 }); await supRow.click(); await settle(buyer.page);
    const row = buyer.page.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
    supTax = (await buyer.page.getByTestId('cbcat-tax-' + itemId).textContent()).trim();
    supOffer = (await row.locator('.cbcat-off').first().textContent().catch(() => '')).trim();
    supPrice = (await row.locator('.cbcat-pr').textContent()).trim();
    /* TWO in the cart, then the Review step: the SAME money block the storefront basket showed */
    await row.locator('[data-testid="cart-add"]').first().click(); await buyer.page.waitForTimeout(200);
    await row.locator('[data-testid="cart-add"]').first().click(); await buyer.page.waitForTimeout(300);
    const next = buyer.page.getByRole('button', { name: /Check out/ }).last(); await next.click(); await settle(buyer.page);
    const next2 = buyer.page.getByRole('button', { name: /Next|Review|Check it/ }).last(); if (await next2.isVisible().catch(() => false)) { await next2.click(); await settle(buyer.page); }
    await buyer.page.getByTestId('sup-total').waitFor({ timeout: 30000 });
    supTotal = (await buyer.page.getByTestId('sup-total').textContent()).trim();
  } finally { await buyer.context.close(); }

  /* ONE ANSWER */
  /* the incl. figure rides the OFFERED price (the deal is the price — 2026-09-06): 200 − 10% = 180, + 5% = 189 */
  expect(shopTax, 'tax line on the storefront').toMatch(/5%.*189/);
  expect(supTax, 'tax line on the Suppliers screen').toMatch(/5%.*189/);
  expect(shopTax.replace(/\s+/g, ' ')).toBe(supTax.replace(/\s+/g, ' '));
  expect(shopOffer, 'offer promise on the storefront').toMatch(/10%/);
  expect(shopOffer).toBe(supOffer);
  expect(shopPrice.replace(/\s+/g, ' ')).toBe(supPrice.replace(/\s+/g, ' '));
  /* the money block: 2 × ₹200 − 10% = ₹360, + 5% GST = ₹378 — on both, to the rupee */
  expect(shopTotal, 'storefront total incl. tax').toMatch(/378/);
  expect(supTotal, 'Suppliers review total incl. tax').toMatch(/378/);
});
