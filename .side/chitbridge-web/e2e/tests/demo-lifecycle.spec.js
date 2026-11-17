// DEMO — THE FILE-BASED LIFECYCLE, END TO END, WITH SCREENS (Athi, 2026-09-05: "create a complex product list as csv from
// my system and test the life cycle: open the catalogue from another system, place an order, see how the system receives
// it … or you run it and show me the outcome").
//   1 · a business mints a connector key           2 · the CSV connector syncs 30 products from products.csv (samples/)
//   3 · the storefront, opened from "another system" (a phone-width window, no login)   4 · the customer orders 3 lines
//   5 · the seller's bell + Task list              6 · the connector's catch-up writes orders/<chit>.csv (once)
//   7 · Settings › Integrations › Running connectors shows it checked in (the co-assist connector actor)
// Screens land in e2e/demo-out/lifecycle-*.png; the order CSV content is printed.
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mintEntity, shopAdd, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const KIT = path.resolve(__dirname, '..', '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const OUT = path.resolve(__dirname, '..', 'demo-out');
const HEADED = !!process.env.DEMO_HEADED || process.argv.includes('--headed');
const PAUSE = Number(process.env.DEMO_PAUSE || 6000);
const hold = async (pg, ms) => { if (HEADED) await pg.waitForTimeout(ms || PAUSE); };

test('DEMO lifecycle: CSV products up → storefront order from another system → the order lands as a file', async ({ page, browser }) => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });
  const core = require(path.join(KIT, 'core.js'));
  const csvAdapter = require(path.join(KIT, 'adapters', 'csv.js'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-lifecycle-'));
  fs.copyFileSync(path.join(KIT, 'samples', 'products.csv'), path.join(work, 'products.csv'));

  await mintEntity(page, { fresh: true });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); const k = await api('keysMint', { body: { name: 'My system (CSV)', scopes: ['connector', 'services'], days: 1 } }); return k.key; });
  expect(key).toBeTruthy();
  const log = (m) => console.log('[lifecycle] ' + m);
  const cb = new core.CB({ api: API, key, log }); cb.name = 'My system (CSV)';
  const adapter = csvAdapter({ csv: { products: path.join(work, 'products.csv'), orders: path.join(work, 'orders') }, log });
  const receipts = new core.Receipts(path.join(work, 'receipts.jsonl'));

  await test.step('2 · products up from the CSV', async () => {
    await cb.heartbeat({ name: cb.name, adapter: 'csv', counters: core.counts(receipts), note: 'sync-products' });
    const r = await core.syncProducts({ cb, adapter, receipts, log });
    expect(r.read).toBe(30); expect(r.failed).toBe(0); expect(r.added + r.updated).toBe(30);
    await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public', gstn: '33ABCDE1234F1Z5', address: '16A-105 Perumbakkam Main Road, Chennai 600126' } }); await loadCatalogue('fresh'); });
    await clickNav(page, 'catalogue'); await settle(page); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'lifecycle-1-catalogue-from-csv.png'), fullPage: false, timeout: 60000, animations: "disabled" }); await hold(page);
  });

  const handle = await page.evaluate(async () => { const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const shop = await ctx.newPage();
  let chitId = null;
  try {
    await test.step('3 · the storefront from another system (a phone, no login)', async () => {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await shop.locator('text=Basmati Rice 25kg').first().waitFor({ timeout: 40000 });
      await shop.screenshot({ path: path.join(OUT, 'lifecycle-2-storefront-phone.png'), timeout: 60000, animations: "disabled" }); await hold(shop);
    });
    await test.step('4 · the customer orders three lines', async () => {
      await shopAdd(shop, 'Basmati Rice 25kg', 2); await shopAdd(shop, 'Groundnut Oil 1L', 3); await shopAdd(shop, 'Toor Dal 1kg', 5);
      await expect(shop.getByTestId('shop-total')).toBeVisible({ timeout: 20000 });
      await shop.screenshot({ path: path.join(OUT, 'lifecycle-3-basket.png'), timeout: 60000, animations: "disabled" }); await hold(shop);
      await shop.locator('[data-testid^="cart-cbcart"]').first().click(); await shop.getByTestId('cart-checkout').click({ timeout: 20000 });
      for (let i = 0; i < 5 && !(await shop.getByTestId('shop-contact').isVisible().catch(() => false)); i++) {
        if (await shop.getByTestId('shop-area').isVisible().catch(() => false)) { await shop.getByTestId('shop-area').fill('42 Anna Nagar, Chennai 600040'); await shop.getByTestId('shop-date').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); await shop.getByTestId('shop-time').fill('10:00'); }
        const next = shop.getByRole('button', { name: /Next|Continue/i }).first(); if (await next.isVisible().catch(() => false)) { if (/Continue/i.test(await next.textContent())) await shop.screenshot({ path: path.join(OUT, 'lifecycle-4-review.png'), timeout: 60000, animations: "disabled" }); await next.click({ timeout: 10000 }); await shop.waitForTimeout(300); } else break;
      }
      const nm = shop.getByTestId('shop-name'); if (await nm.isVisible().catch(() => false)) await nm.fill('Kumar Stores');
      await shop.getByTestId('shop-contact').fill('kumar' + Date.now().toString().slice(-6) + '@example.com');
      const started = shop.waitForResponse((r) => /\/order\/start$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-send-code"]').first().click(); const sj = await (await started).json().catch(() => ({}));
      const otpBox = shop.locator('[data-testid="shop-otp"], #o_otp, input[inputmode="numeric"]').first(); await otpBox.waitFor({ timeout: 20000 }); await otpBox.fill(sj.dev_otp || require('../fixtures').signinCode('customer'));
      const confirmed = shop.waitForResponse((r) => /\/order\/confirm$/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-place-order"]').first().click({ timeout: 20000 });
      await shop.locator('[data-testid="confirm-ok"]').click({ timeout: 10000 }); /* UX-6: Place order asks first; the yes sends */
      const cj = await (await confirmed).json().catch(() => ({})); chitId = cj.chit_id; expect(chitId, JSON.stringify(cj).slice(0, 200)).toBeTruthy();
      await shop.waitForTimeout(800); await shop.screenshot({ path: path.join(OUT, 'lifecycle-5-order-placed.png'), timeout: 60000, animations: "disabled" }); await hold(shop);
    });
  } finally { await ctx.close(); }

  await test.step('5 · the seller: the order on the Task list', async () => {
    await clickNav(page, 'task'); await settle(page);
    await expect(page.getByText('Basmati Rice 25kg').first()).toBeVisible({ timeout: 40000 });
    await page.screenshot({ path: path.join(OUT, 'lifecycle-6-seller-task-list.png'), timeout: 60000, animations: "disabled" }); await hold(page);
    await page.evaluate((id) => openChit(id, true), chitId); await settle(page); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'lifecycle-7-seller-order-chit.png'), timeout: 60000, animations: "disabled" }); await hold(page, PAUSE * 2);
  });

  await test.step('6 · the connector receives it as a file, once', async () => {
    const r1 = await core.catchUp({ cb, adapter, receipts, log });
    const mine = r1.find((x) => x.chit_id === chitId); expect(mine && mine.outcome).toBe('ok');
    const f = path.join(work, 'orders', chitId + '.csv'); expect(fs.existsSync(f)).toBe(true);
    const csv = fs.readFileSync(f, 'utf8'); console.log('[lifecycle] orders/' + chitId + '.csv\n' + csv);
    fs.writeFileSync(path.join(OUT, 'lifecycle-8-order.csv'), csv);
    expect(csv.split('\n').filter(Boolean).length).toBe(4);
    const r2 = await core.catchUp({ cb, adapter, receipts, log }); expect(r2.find((x) => x.chit_id === chitId).outcome).toBe('duplicate');
    await cb.heartbeat({ name: cb.name, adapter: 'csv', counters: core.counts(receipts), note: 'once' });
  });

  await test.step('7 · Integrations shows the connector checked in', async () => {
    await page.evaluate(() => navTo('settings')); await page.waitForTimeout(600);
    await page.getByTestId('set-sec-integrations').click({ timeout: 30000 });
    await expect(page.locator('[data-testid^="int-running-"]').first()).toContainText('My system', { timeout: 30000 });
    await page.screenshot({ path: path.join(OUT, 'lifecycle-9-integrations-running.png'), fullPage: true, timeout: 60000, animations: "disabled" }); await hold(page);
    /* the directory: the product list, last, and held — Athi: 'show the product list' */
    await clickNav(page, 'catalogue'); await settle(page); await hold(page, PAUSE * 3);
  });
  fs.rmSync(work, { recursive: true, force: true });
});
