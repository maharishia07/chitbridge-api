// pricing-structure.spec.js — [PRC-01] A pricing structure the product cites: authored under Catalogue setup (kind 'pricing', tiered), attached on
// the product's Pricing row THROUGH THE CONTROL, the bands shown at once; the cart, the storefront basket and the
// order line all price the unit at the quantity — 10 bags at ₹950, not ₹1,000. Athi, 2026-09-05: "in catalogue setup
// I have fixed and tier pricing. how do I invoke the same in the catalogue while setting up the price?"
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const { mintEntity, addProduct, clickNav, settle, shopAdd } = require('../fixtures');

test('[PRC-01] a tiered structure cited by the product prices the unit at the quantity — page, storefront, order', async ({ page, browser }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });   /* this spec authors a shelf — its own entity */
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel); expect(pid).toBeTruthy();

  await test.step('AUTHOR — a tiered structure: from 10 → 950, from 50 → 900 (the definitions API, the same call the form makes)', async () => {
    const r = await page.evaluate(async () => api('defAdd', { body: { kind: 'pricing', name: 'Bulk bags', sub_kind: 'tiered', rules: { tiers: [{ qty: 10, price: 950 }, { qty: 50, price: 900 }] }, status: 'live' } }));
    expect(r && r.definition && r.definition.definition_id).toBeTruthy();
    await page.evaluate(async () => { await cbDefsLive('pricing', true); });
  });

  await test.step('ATTACH — through the Pricing row\'s own control; the bands appear at once', async () => {
    await page.evaluate(() => { UI.prodMode = 'view'; if (typeof prodRepaintSection === 'function') prodRepaintSection('pricing'); });
    await page.getByTestId('prod-tab-pricing').click().catch(() => {});
    await expect(page.getByTestId('prod-pricing-fix')).toBeVisible({ timeout: 25000 });
    const optVal = await page.getByTestId('prod-pricing-fix').evaluate((el) => { const o = [...el.options].find((x) => /Bulk bags/.test(x.textContent)); return o ? o.value : ''; });
    expect(optVal).toBeTruthy();
    await page.getByTestId('prod-pricing-fix').selectOption(optVal);
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
    await page.getByTestId('prod-pricing-fix-go').click(); await saved; await settle(page);
    await expect(page.getByTestId('prod-pricing-table')).toBeVisible({ timeout: 25000 });
    const rows = await page.getByTestId('prod-pricing-table').locator('tr').allTextContents();
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatch(/1–9/); expect(rows[1]).toMatch(/10–49/); expect(rows[2]).toMatch(/50 and above/);
    await expect(page.getByTestId('prod-pricing-resolved')).toContainText('Bulk bags');
  });

  await test.step('THE PRODUCT CARRIES THE COPY — kind, tiers, name travel on item_data', async () => {
    const d = await page.evaluate(async (id) => { const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === id); return p.item_data; }, pid);
    expect(d.pricing_kind).toBe('tiered');
    expect(Array.isArray(d.pricing_tiers) && d.pricing_tiers.length).toBe(2);
    expect(d.pricing_def_name).toBe('Bulk bags');
  });

  await test.step('THE CART — 10 in the basket prices at 950 each; 1 at the list price', async () => {
    const r = await page.evaluate(async (id) => {
      const rr = await api('prodList', { query: { limit: 50 } }); const p = (rr.items || rr || []).find((x) => (x.item_id || x.id) === id);
      const at = (q) => CBPricing.unitPrice(p.item_data, q, 1000);
      return { one: at(1).amount, ten: at(10).amount, sixty: at(60).amount, why: at(10).why };
    }, pid);
    expect(r.one).toBe(1000); expect(r.ten).toBe(950); expect(r.sixty).toBe(900);
  });

  await test.step('THE STOREFRONT — the public basket prices 10 bags at 950 and the order line carries 950 with the list price beside it', async () => {
    const handle = await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id || null; });
    expect(handle).toBeTruthy();
    const ctx = await browser.newContext({ viewport: { width: 480, height: 900 } }); const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await shopAdd(shop, 'Basmati 25kg', 10);   /* THIS product's "+", not the first one on the page */
      await expect(shop.getByTestId('shop-total')).toBeVisible({ timeout: 20000 });
      const total = await shop.getByTestId('shop-total').textContent();
      expect(total.replace(/[^\d.]/g, '')).toBe('9500.00');   /* 10 × 950, no slab, no offer */
      /* the order: the server prices the line by the same engine */
      await shop.locator('[data-testid^="cart-cbcart"]').first().click();
      await shop.getByTestId('cart-checkout').click({ timeout: 20000 });
      for (let i = 0; i < 5 && !(await shop.getByTestId('shop-contact').isVisible().catch(() => false)); i++) {
        if (await shop.getByTestId('shop-area').isVisible().catch(() => false)) { await shop.getByTestId('shop-area').fill('Chennai'); await shop.getByTestId('shop-date').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); await shop.getByTestId('shop-time').fill('10:00'); }
        const next = shop.getByRole('button', { name: /Next|Continue/i }).first(); if (await next.isVisible().catch(() => false)) { await next.click({ timeout: 10000 }); await shop.waitForTimeout(300); } else break;
      }
      const nm = shop.getByTestId('shop-name'); if (await nm.isVisible().catch(() => false)) await nm.fill('Priya');
      await shop.getByTestId('shop-contact').fill('prc' + Date.now().toString().slice(-6) + '@example.com');
      const started = shop.waitForResponse((r) => /\/order\/start$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-send-code"]').first().click(); const sj = await (await started).json().catch(() => ({}));
      const otpBox = shop.locator('[data-testid="shop-otp"], #o_otp, input[inputmode="numeric"]').first(); await otpBox.waitFor({ timeout: 20000 }); await otpBox.fill(sj.dev_otp || require('../fixtures').signinCode('customer'));
      const confirmed = shop.waitForResponse((r) => /\/order\/confirm$/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 });
      await shop.locator('[data-testid="shop-cart-submit"], [data-testid="shop-place-order"]').first().click({ timeout: 20000 });
      await shop.locator('[data-testid="confirm-ok"]').click({ timeout: 10000 }); /* UX-6: Place order asks first; the yes sends */
      const cj = await (await confirmed).json().catch(() => ({}));
      expect(cj.chit_id, JSON.stringify(cj).slice(0, 200)).toBeTruthy();
      const line = await page.evaluate(async (id) => { const c = await api('chit', { params: { id } }); const ls = (c.detail && c.detail.line_items) || c.lines || c.line_items || [];   /* GET chit: { header, detail:{ line_items }, lines? } */ return ls[0] || null; }, cj.chit_id);
      expect(line, 'the order line').toBeTruthy();
      expect(Number(line.price)).toBe(950);
      expect(Number(line.list_price)).toBe(1000);
      expect(Number(line.quantity)).toBe(10);
    } finally { await ctx.close(); }
  });
});
