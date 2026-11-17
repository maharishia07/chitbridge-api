// stock-guard.spec.js — [STK-02] The stamped stock reaches the ORDER. A fresh zero (under an hour old) refuses the line with the time of the count;
// a shortfall never refuses — it rides the line as `stock` and the seller's chit shows "short by N". Without a stamp
// nothing changes. Athi, 2026-09-05: "stock with stamp first".
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[STK-02] a fresh zero refuses the order line; a shortfall rides the line to the seller', async ({ page, request }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'stock guard spec', scopes: ['connector'], days: 1 } })).key; });
  const handle = await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });
  const cat = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(handle))).json();
  const item = (cat.items || []).find((x) => /BAS-25/i.test(String((x.item_data || {}).code || ''))); expect(item, 'the product on the storefront').toBeTruthy();
  const stamp = async (qty, as_of) => { const r = await request.post(API + '/api/products/availability/bulk', { headers: { 'X-Api-Key': key }, data: { items: [{ code: 'BAS-25', qty, source: 'erp', as_of: as_of || new Date().toISOString() }] } }); expect(r.status()).toBe(200); };
  const order = async (quantity) => {
    const ident = 'stk' + Date.now().toString().slice(-7) + '@example.com';
    const st = await (await request.post(API + '/api/catalogue/' + encodeURIComponent(handle) + '/order/start', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { identifier: ident, name: 'Stock Buyer' } })).json();
    const cf = await request.post(API + '/api/catalogue/' + encodeURIComponent(handle) + '/order/confirm', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { identifier: ident, name: 'Stock Buyer', otp: st.dev_otp || require('../fixtures').signinCode('customer'), location: 'Chennai', line_items: [{ kind: 'product', item_id: item.item_id, quantity }] } });
    return { status: cf.status(), j: await cf.json() };
  };

  await test.step('NO STAMP — the order goes through as before', async () => {
    const r = await order(2); expect(r.status).toBe(200); expect(r.j.chit_id).toBeTruthy();
  });
  await test.step('A FRESH ZERO — refused, with the time of the count', async () => {
    await stamp(0);
    const r = await order(1); expect(r.status).toBe(422); expect(String(r.j.message)).toMatch(/out of stock as of \d\d:\d\d/);
  });
  await test.step('A STALE ZERO — never refused (the shop may have restocked); the shortfall rides the line', async () => {
    await stamp(0, new Date(Date.now() - 3 * 3600e3).toISOString());
    const r = await order(1); expect(r.status).toBe(200);
  });
  let chitId = null;
  await test.step('A SHORTFALL — accepted; the line carries stock {qty, short, as_of}', async () => {
    await stamp(3);
    const r = await order(5); expect(r.status).toBe(200); chitId = r.j.chit_id;
    const c = await page.evaluate(async (id) => api('chit', { params: { id } }), chitId);
    const lines = (c.detail && c.detail.line_items) || c.line_items || (c.lines) || [];
    const l = lines.find((x) => /Basmati/.test(String(x.particulars || x.name || ''))); expect(l && l.stock, 'line.stock').toBeTruthy();
    expect(l.stock.qty).toBe(3); expect(l.stock.short).toBe(2); expect(l.stock.source).toBe('erp');
  });
  await test.step('THE SELLER — the chit line says short by 2 · stock 3', async () => {
    await clickNav(page, 'task'); await settle(page);
    await page.evaluate((id) => openChit(id, true), chitId); await settle(page);
    await expect(page.getByTestId('c2-stock-short').first()).toContainText('short by 2', { timeout: 30000 });
  });
});
