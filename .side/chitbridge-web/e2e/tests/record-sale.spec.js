// record-sale.spec.js — [SB-01] RECORD A SALE FOLLOWS THE SAME CART. The seller's Grapes carry a 5% rate and a live 10% offer. In Record a sale the
// picker row shows the tax line and the offer badge, the foot shows the cart's money block (2 × ₹200 − 10% = ₹360 + 5% = ₹378),
// and the chit it records carries list price · discount · the offer's name · the rate — so its invoice says ₹378 too.
// Athi, 2026-09-05: "we created something called record a sale, that is also a billing application, does it follow the same?"
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[SB-01] Record a sale shows the same rows and money block and records the offer and the rate on the chit', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });
  /* a REGISTERED seller: GST is charged only by a seller with a GSTIN — the view, the send and the invoice all read that one fact */
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const itemId = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || '')));
    await api('prodEdit', { params: { id: g.item_id }, body: { item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) } });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    return g.item_id;
  });

  await test.step('THE PICKER — the same row: tax line + offer badge; the foot: the cart\'s money block', async () => {
    await page.evaluate(() => { if (typeof selfBillOpen === 'function') selfBillOpen(); }); await settle(page);
    const row = page.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
    await expect(page.getByTestId('cbcat-tax-' + itemId)).toContainText('5%');
    await expect(row.locator('.cbcat-off').first()).toContainText('10%');
    await row.locator('[data-testid="cart-add"]').first().click(); await page.waitForTimeout(200);
    await row.locator('[data-testid="cart-add"]').first().click(); await page.waitForTimeout(400);
    await expect(page.getByTestId('sb-total')).toContainText('378');
  });

  let chitId = null;
  await test.step('RECORD — the chit carries the discount, the offer name and the rate; the invoice says 378', async () => {
    /* the customer at the counter — carried on the chit, named on the invoice */
    await page.getByTestId('sb-customer').fill('Priya Stores');
    await page.getByTestId('sb-customer-contact').fill('9876543210');
    const sent = page.waitForResponse((r) => /\/api\/chits/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 45000 });
    await page.locator('[data-testid="sb-record"], button:has-text("Record")').last().click();
    const res = await sent; const j = await res.json().catch(() => ({})); chitId = j.chit_id || (j.chit && j.chit.chit_id) || null;
    expect(chitId, 'the recorded chit id').toBeTruthy();
    const c = await page.evaluate(async (id) => api('chit', { params: { id } }), chitId);
    const lines = (c.detail && c.detail.line_items) || c.line_items || [];
    const l = lines.find((x) => /grapes/i.test(String(x.particulars || x.name || '')));
    expect(l && Number(l.price)).toBe(200); expect(Number(l.discount)).toBe(40); expect(l.offer && l.offer.label).toBe('Flat 10%'); expect(Number(l.gst_rate)).toBe(5);
    const inv = await page.evaluate(async (id) => { const r = await fetch(CFG.API_BASE + '/api/invoice/' + id, { headers: { Authorization: 'Bearer ' + SESSION.token } }); return r.json(); }, chitId);
    expect(inv.heads && Number(inv.heads.total)).toBe(378);
    expect(inv.invoice && inv.invoice.BuyerDtls && inv.invoice.BuyerDtls.LglNm, 'the invoice names the customer, not the shop').toBe('Priya Stores');
    expect(inv.sells, 'the shop sells').toBe(true);
    const h = c.header || {}; expect(h.business_json && h.business_json.customer && h.business_json.customer.phone).toBe('9876543210');
  });
});
