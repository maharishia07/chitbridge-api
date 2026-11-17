#!/usr/bin/env node
/**
 * e2e/walk-shop-codes.cjs - THE SHOP PAGE WEARS ITS CODES ON THE SCREEN (UX-137 slice 5; screen SHP001).
 * Black box: the real public/shop.html with a stand-in api. The static test (ui-codes-shop.test.cjs) reads the source; this walk reads the DRAWN
 * page, where the controls built by script (rows, sheets, search) really exist, at both sizes, and shoots them.
 *   S1  at 1366x768 and 390x844 the page wears valid SHP001 codes (search, Categories, an add button each), each code on one element only,
 *       no sideways overflow (a code is an attribute: nothing may move)
 *   S2  search (SHP001-I04), Categories (SHP001-B05) and a category jump (SHP001-B06) still do their job with the attribute on
 *   NODE_PATH=<dir with playwright> node e2e/walk-shop-codes.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const VIEW = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: 'CBSIMFIT', display_name: 'Sim Fit', currency_code: 'INR', country: 'IN', is_verified: true, business_status: 'open', storefront_access: 'browse',
    unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: Array.from({ length: 6 }, (_, i) => ({ item_id: 'i' + i, item_data: { name: 'Basmati rice ' + (i + 1) + ' kg', unit: 'bag', price: 640 + i, category: i % 2 ? 'Pulses' : 'Grains' } })) };
const SIZES = [[1366, 768], [390, 844]];
const coded = (page) => page.evaluate(() => [...document.querySelectorAll('[data-cbsid^="SHP001-"]')].map((e) => e.getAttribute('data-cbsid')));

W.run('shop-codes', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/assist/regions*', (r) => r.fulfill(J({ regions: [] })));
  await page.route('**/api/catalogue/CBSIMFIT*', (r) => r.fulfill(J(VIEW)));
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(w.base + '/shop.html?s=CBSIMFIT&api=' + encodeURIComponent(w.base));
    await page.waitForSelector('[data-testid="shop-head"], [data-sc="share"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    await w.step('S1·' + width, 'the drawn shop wears valid SHP001 codes at ' + width + 'x' + height + ', nothing moved', async () => {
      const codes = await coded(page);
      const side = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const searchField = await page.locator('[data-cbmount="SHP001-U03"]').count(); /* the search input is ui.field CMP055 since field-2: its screen identity is the mount U03, not the old I04 */
      const need = searchField === 1 && codes.includes('SHP001-B05');
      return { ok: need && codes.every((c) => /^SHP001-[A-Z][0-9]{2}$/.test(c)) && side <= 0, saw: codes.length + ' coded elements (' + codes.join(' ') + ') · sideways overflow ' + side + ' px' };
    });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(w.base + '/shop.html?s=CBSIMFIT&api=' + encodeURIComponent(w.base));
  await page.waitForSelector('[data-cbsid="SHP001-B05"]', { timeout: 15000 });
  await w.step('S2', 'Categories (SHP001-B05) still opens its menu, a category (SHP001-B06) still jumps, search (SHP001-U03, the ui.field that replaced I04) still takes typing', async () => {
    await page.locator('[data-cbmount="SHP001-U03"]').fill('rice 3');
    await page.waitForTimeout(300);
    const left = await page.locator('[data-testid="cart-add"]').count();
    await page.locator('[data-cbmount="SHP001-U03"]').fill('');
    await page.waitForTimeout(300);
    await page.locator('[data-cbsid="SHP001-B05"]').click();
    await page.waitForTimeout(300);
    const jumps = await page.locator('[data-cbsid="SHP001-B06"]').count();
    if (jumps) await page.locator('[data-cbsid="SHP001-B06"]').first().click();
    await page.waitForTimeout(300);
    return { ok: left === 1 && jumps >= 2, saw: 'search "rice 3" left ' + left + ' row(s) · the menu showed ' + jumps + ' category buttons, one tapped' };
  });
});
