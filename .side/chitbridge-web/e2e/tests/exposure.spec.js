// exposure.spec.js — [EXP-01] SHOWN TO CUSTOMERS, per item. The seller switches the tax line and the offers off for one product; the public
// catalogue view — the one projection every surface reads — carries no tax for it and marks every offer excluded; the
// storefront row shows no tax line and no offer badge, while another product keeps both. The business default (stock off)
// removes the stamp from every item; the item's own switch wins over the default. Athi, 2026-09-05.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[EXP-01] per-item exposure is enforced in the projection and obeyed by the storefront', async ({ page, browser, request }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });
  await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public', gstn: '33AABCK1234F1Z6' } });   /* a REGISTERED seller: only a seller with a GSTIN carries tax (tax-shelf) */ });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  await addProduct(page, { name: 'Oil', unit: 'litre', price: 250, code: 'OIL-1' });
  const { handle, grapes, oil } = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || ''))), o = items.find((x) => /^oil$/i.test(((x.item_data || {}).name || '')));
    for (const p of [g, o]) await api('prodEdit', { params: { id: p.item_id }, body: { item_data: Object.assign({}, p.item_data, { gst_rate: 5, hsn: '0806' }) } });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    const me = await api('me'); const e = (me && me.entity) || me || {};
    return { handle: e.user_id || e.bridge_id, grapes: g.item_id, oil: o.item_id };
  });
  const view = async () => (await request.get(API + '/api/catalogue/' + encodeURIComponent(handle))).json();

  await test.step('BEFORE — both items carry the tax and no exclusion', async () => {
    const v = await view(); const g = v.items.find((x) => x.item_id === grapes), o = v.items.find((x) => x.item_id === oil);
    expect(g.tax && g.tax.rate).toBe(5); expect(o.tax && o.tax.rate).toBe(5); expect(g.item_data.offers_excluded).toBeUndefined();
    expect(g.item_data.exposure && g.item_data.exposure.tax, 'the public copy says what was applied').toBe(true);
  });

  await test.step('SWITCH — Grapes: tax off, offers off, through the product page pane', async () => {
    await page.evaluate((id) => { selectProduct(id); }, grapes); await settle(page);
    const tab = page.getByTestId('prod-tab-exposure'); if (await tab.count()) { await tab.first().click(); await settle(page); }
    const tick = page.getByTestId('prod-expose-tick-tax'); await tick.waitFor({ timeout: 30000 });
    let saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await tick.uncheck(); await saved; await settle(page);
    saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-expose-tick-offers').uncheck(); await saved; await settle(page);
    const v = await view(); const g = v.items.find((x) => x.item_id === grapes), o = v.items.find((x) => x.item_id === oil);
    expect(g.tax, 'no tax on the public copy of Grapes').toBeUndefined();
    expect(g.item_data.offers_excluded).toEqual(['*']);
    expect(o.tax && o.tax.rate, 'Oil untouched').toBe(5);
  });

  await test.step('STOREFRONT — Grapes shows neither the tax line nor the badge; Oil shows both', async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await shop.getByTestId('cbcat-row-' + oil).waitFor({ timeout: 40000 });
      await expect(shop.getByTestId('cbcat-tax-' + oil)).toBeVisible();
      await expect(shop.getByTestId('cbcat-row-' + oil).locator('.cbcat-off').first()).toContainText('10%');
      await expect(shop.getByTestId('cbcat-tax-' + grapes)).toHaveCount(0);
      await expect(shop.getByTestId('cbcat-row-' + grapes).locator('.cbcat-off')).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  await test.step('DEFAULTS — the business switches availability off; the item switch still wins for its own keys', async () => {
    const r = await page.evaluate(async () => api('exposureDefaults', { body: { stock: false } }));
    expect(r && r.exposure && r.exposure.stock).toBe(false);
    const v = await view(); const o = v.items.find((x) => x.item_id === oil);
    expect(o.item_data.exposure.stock).toBe(false); expect(o.item_data.exposure.tax).toBe(true);
  });

  await test.step('RESET — Grapes back to the defaults', async () => {
    await page.evaluate((id) => { selectProduct(id); }, grapes); await settle(page);
    const tab = page.getByTestId('prod-tab-exposure'); if (await tab.count()) { await tab.first().click(); await settle(page); }
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('prod-expose-reset').click(); await saved;
    const v = await view(); const g = v.items.find((x) => x.item_id === grapes);
    expect(g.tax && g.tax.rate).toBe(5); expect(g.item_data.offers_excluded).toBeUndefined();
  });
});
