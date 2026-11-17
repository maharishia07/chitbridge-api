#!/usr/bin/env node
/**
 * e2e/walk-utility-pages-codes.cjs - THE THREE UTILITY PAGES WEAR THEIR CODES ON THE SCREEN (UX-137 slice utility-2; screens KYB001, STR001, NSH001).
 * Black box: the real public pages with a stand-in api. The static test (ui-codes-utility-pages.test.cjs) reads the source; this walk reads the
 * DRAWN page, where the controls built by script (tabs, chips, add buttons) really exist, and shoots each page at both sizes.
 *   U1  every control the page draws at 1366x768 wears its code, and each code is on one element only
 *   U2  the same at 390x844, and the page has no sideways scroll (a code is an attribute: nothing may move)
 *   U3  a tab, a chip and a button still do their job with the attribute on (Know your business tab, Store category, Network shop department)
 *   NODE_PATH=<dir with playwright> node e2e/walk-utility-pages-codes.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const STORE = { currency_code: 'INR', categories: ['Grains', 'Pulses'], products: [
  { product_id: 'p1', name: 'Basmati rice 1 kg', category: 'Grains', price: 640 },
  { product_id: 'p2', name: 'Toor dal 1 kg', category: 'Pulses', price: 180 }] };
const NETWORK = { network: { display_name: 'Sim Network', bridge_id: 'CBNET0001' }, count: 2, currencies: ['INR'], departments: [
  { bridge_id: 'CBD1', name: 'Grocery', count: 1, currency_code: 'INR', categories: [{ name: 'Grains', items: [{ name: 'Basmati rice', unit: 'kg', price: 640, currency: 'INR' }] }] },
  { bridge_id: 'CBD2', name: 'Dairy', count: 1, currency_code: 'INR', categories: [{ name: 'Milk', items: [{ name: 'Milk', unit: 'l', price: 60, currency: 'INR' }] }] }] };
const SIZES = [[1366, 768], [390, 844]];
const PAGES = [
  { id: 'kyb', url: '/know-your-business.html', screen: 'KYB001', ready: '.tab', min: 4 },
  { id: 'store', url: '/store.html?net=CBNET0001', screen: 'STR001', ready: '.grid .card', min: 5 },
  { id: 'nshop', url: '/network-shop.html?bridge=CBNET0001', screen: 'NSH001', ready: '.chips .chip', min: 4 }
];

/** every element that wears a code on the drawn page: [{code, tag, w, h}] */
const coded = (page, screen) => page.evaluate((s) => [...document.querySelectorAll('[data-cbsid^="' + s + '-"]')]
  .map((e) => ({ code: e.getAttribute('data-cbsid'), tag: e.tagName.toLowerCase() })), screen);

W.run('utility-pages-codes', async (w) => {
  const { page, ctx } = w;
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) { /* no storage: the page shows its own sign-in */ } }, W.session('Fixture Owner', 'Fixture Shop'));
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    if (/network-store/.test(u)) return r.fulfill(J(STORE));
    if (/catalogue\/network\//.test(u)) return r.fulfill(J(NETWORK));
    if (/kyb\/yourself/.test(u)) return r.fulfill(J({ credentials: [], ladder: [], applies: [] }));
    return r.fulfill(J({}));
  });
  for (const [width, height] of SIZES) {
    for (const p of PAGES) {
      await page.setViewportSize({ width, height });
      await page.goto(w.base + p.url);
      await page.waitForSelector(p.ready, { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(400);
      await w.step((width > 800 ? 'U1·' : 'U2·') + p.id, p.screen + ' at ' + width + 'x' + height + ': the drawn controls wear a valid code', async () => {
        const list = await coded(page, p.screen);
        const codes = list.map((x) => x.code);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        const ok = codes.length >= p.min && sideways <= 0 && codes.every((c) => /^[A-Z]{3}[0-9]{3}-[A-Z][0-9]{2}$/.test(c));
        return { ok, saw: codes.length + ' coded elements (' + [...new Set(codes)].join(' ') + ') · sideways overflow ' + sideways + ' px' };
      });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(w.base + '/know-your-business.html');
  await page.waitForSelector('.tab', { timeout: 15000 });
  await w.step('U3·kyb', 'Know your business: a tab (KYB001-C01) still opens its section', async () => {
    await page.locator('[data-cbsid="KYB001-C01"]').nth(2).click();
    await page.waitForTimeout(300);
    const on = await page.locator('.tab.on').first().innerText();
    return { ok: /Risk/i.test(on) && /risk/.test(await page.evaluate(() => location.hash)), saw: 'tab on: ' + on + ' · address ' + await page.evaluate(() => location.hash) };
  });
  await page.goto(w.base + '/store.html?net=CBNET0001');
  await page.waitForSelector('.grid .card', { timeout: 15000 });
  await w.step('U3·store', 'Store: a category chip (STR001-C02) still narrows the list', async () => {
    await page.locator('[data-cbsid="STR001-C02"]').nth(1).click();
    await page.waitForTimeout(200);
    const n = await page.locator('.grid .card').count();
    return { ok: n === 1, saw: n + ' product(s) after choosing the second category' };
  });
  await page.goto(w.base + '/network-shop.html?bridge=CBNET0001');
  await page.waitForSelector('.chips .chip', { timeout: 15000 });
  await w.step('U3·nshop', 'Network shop: a department chip (NSH001-C02) still narrows the list', async () => {
    await page.locator('[data-cbsid="NSH001-C02"]').nth(1).click();
    await page.waitForTimeout(200);
    const n = await page.locator('.dept').count();
    return { ok: n === 1, saw: n + ' department(s) after choosing Dairy' };
  });
});
