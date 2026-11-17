// payment.spec.js — [PAY-01] The payment loop, level 1 (UPI QR). The store's UPI id (from the profile map) reaches the storefront; "Order
// placed" shows a QR carrying the id, the amount and the chit reference; the seller's chit reads Unpaid with Mark paid
// and Show QR; Mark paid THROUGH THE CONTROL records the payment on the seller's copy and the cell reads Paid · UPI · ref.
// Athi, 2026-09-05: "or QR code and get the payment loop done" → level 1 autonomously.
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const { mintEntity, addProduct, clickNav, settle, shopAdd } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[PAY-01] a UPI QR on the order; the seller marks the chit paid through the control', async ({ page, browser, request }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'pay spec', scopes: ['connector', 'services'], days: 1 } })).key; });
  /* the UPI id comes in through the profile map, as a connector would send it */
  const pr = await request.post(API + '/api/integrations/profile', { headers: { 'X-Api-Key': key }, data: { source: 'csv', fields: { upi_id: 'kumartraders@upi', legal_name: 'Kumar Traders' } } });
  expect(pr.status()).toBe(200);
  const handle = await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });

  let chitId = null;
  await test.step('STOREFRONT — the payload carries the UPI id; Order placed shows the QR and the deep link', async () => {
    const cat = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(handle))).json();
    expect(cat.shop && cat.shop.upi_id).toBe('kumartraders@upi');
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await shopAdd(shop, 'Basmati 25kg', 2);
      await shop.locator('[data-testid^="cart-cbcart"]').first().click(); await shop.getByTestId('cart-checkout').click({ timeout: 20000 });
      for (let i = 0; i < 5 && !(await shop.getByTestId('shop-contact').isVisible().catch(() => false)); i++) {
        if (await shop.getByTestId('shop-area').isVisible().catch(() => false)) { await shop.getByTestId('shop-area').fill('Chennai'); await shop.getByTestId('shop-date').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); await shop.getByTestId('shop-time').fill('10:00'); }
        const next = shop.getByRole('button', { name: /Next|Continue/i }).first(); if (await next.isVisible().catch(() => false)) { await next.click({ timeout: 10000 }); await shop.waitForTimeout(300); } else break;
      }
      const nm = shop.getByTestId('shop-name'); if (await nm.isVisible().catch(() => false)) await nm.fill('Priya');
      await shop.getByTestId('shop-contact').fill('pay' + Date.now().toString().slice(-6) + '@example.com');
      const started = shop.waitForResponse((r) => /\/order\/start$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-send-code"]').first().click(); const sj = await (await started).json().catch(() => ({}));
      const otpBox = shop.locator('[data-testid="shop-otp"], #o_otp, input[inputmode="numeric"]').first(); await otpBox.waitFor({ timeout: 20000 }); await otpBox.fill(sj.dev_otp || require('../fixtures').signinCode('customer'));
      const confirmed = shop.waitForResponse((r) => /\/order\/confirm$/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-place-order"]').first().click({ timeout: 20000 });
      await shop.locator('[data-testid="confirm-ok"]').click({ timeout: 10000 }); /* UX-6: Place order asks first; the yes sends */
      const cj = await (await confirmed).json().catch(() => ({})); chitId = cj.chit_id; expect(chitId).toBeTruthy();
      await expect(shop.getByTestId('shop-upi')).toBeVisible({ timeout: 20000 });
      await expect(shop.getByTestId('shop-upi-qr')).toBeVisible();
      const href = await shop.getByTestId('shop-upi-link').getAttribute('href');
      expect(href).toContain('upi://pay?pa=kumartraders%40upi'); expect(href).toContain('am=2000'); expect(href).toContain('tn=CB-' + String(chitId).slice(0, 8));
    } finally { await ctx.close(); }
  });

  await test.step('THE SELLER — Unpaid · Mark paid through the control · Paid · UPI · ref; the copy carries it', async () => {
    await clickNav(page, 'task'); await settle(page);
    await page.evaluate((id) => openChit(id, true), chitId); await settle(page);
    await expect(page.getByTestId('chit-unpaid')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chit-show-qr').click();
    await expect(page.getByTestId('chit-upi-qr')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => closeModal());
    await page.getByTestId('chit-mark-paid').click();
    await page.getByTestId('pay-method').selectOption('upi');
    await page.getByTestId('pay-ref').fill('UPI-TXN-12345');
    const posted = page.waitForResponse((r) => /\/payment$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('pay-ok').click(); await posted; await settle(page);
    await expect(page.getByTestId('chit-paid')).toContainText('UPI', { timeout: 30000 });
    await expect(page.getByTestId('chit-paid')).toContainText('UPI-TXN-12345');
    const c = await page.evaluate(async (id) => api('chit', { params: { id } }), chitId);
    const bj = (c.header && c.header.business_json) || c.business_json || {};
    expect(bj.payment && bj.payment.method).toBe('upi'); expect(bj.payment.ref).toBe('UPI-TXN-12345');
  });
});
