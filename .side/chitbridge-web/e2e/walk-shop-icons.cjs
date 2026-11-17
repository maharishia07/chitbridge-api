#!/usr/bin/env node
/**
 * e2e/walk-shop-icons.cjs - THE SHOP'S FOUR SHEET CLOSERS ARE THE LIBRARY ICON (WEB-ICONS-1, 2026-11-13).
 * OWNS      the element test for shop.html's close icons SHP001-U01..U04 (support, basket, order, wall): library part, register code, size, name, contrast, keys.
 * CALLED BY a person / the cloud walks (named walk-* so run-shard picks it up).  FLOW  shop.html with a stand-in api -> open each sheet -> read the close icon.
 * CARD      qa/ui-identity
 *   I1  each closer is drawn by ui.action close: data-cbsid CMP005-B01, data-cbname close, its own data-cbmount SHP001-U0n, and no hand-written SHP001-B11/B15/B17/B26 is left
 *   I2  it has an accessible name (Close), a tooltip, a box of at least 44x44 at 1366 and at 390
 *   I3  its ink against the sheet is at least 4.5:1 in the cream theme and with data-theme=dark set on the page
 *   I4  keyboard: Tab reaches it; Enter closes; (Space closes, on the support sheet)
 *   I4b Tab leaves the sheet number box forward when its echo changes or an error shows (focus must not be pulled back)
 * It must FAIL on main: there the x is a 22 px hand-written glyph in #8a949c with no component code.
 *   NODE_PATH=<dir with playwright> node e2e/walk-shop-icons.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./lib/walk.cjs');
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
const SHOP = 'CBSIMICON';
const oi = { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: null };
const item = { name: 'Sky blue emulsion', unit: 'litre', commercials: { price: 500, unit: 'litre' }, order_input: oi, combinations: [{ name: 'Sky', colours: [{ name: 'Blue', hex: '#6fa8dc' }] }] };
const view = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: SHOP, display_name: 'Sim Icon Store', currency_code: 'INR', gstn: null, country: 'IN', is_verified: true, business_status: 'open', storefront_access: 'browse',
    unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null, order_input: oi, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: [{ item_id: 'i1', item_data: { name: 'Basmati rice 5 kg', unit: 'bag', price: 640 } }],
  finishes: [{ title: 'Paints', source: 'SRC1', items: [item] }] };
const SHEETS = [['SHP001-U01', 'support', 'shop-sheet-x-support'], ['SHP001-U02', 'basket', 'shop-sheet-x-order'], ['SHP001-U03', 'order', 'shop-sheet-x-order-item'], ['SHP001-U04', 'wall', 'shop-sheet-x-wall']];

/** inside the page: the closer's facts (library attributes, box, ink against the painted sheet) */
function readCloser(testid) {
  const el = document.querySelector('[data-testid="' + testid + '"]');
  if (!el) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  let bg = [255, 255, 255, 1];
  for (let n = el.parentElement; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] >= 1) { bg = c; break; } }
  const fg = rgba(getComputedStyle(el).color), a = lum(fg), b = lum(bg), r = el.getBoundingClientRect();
  return { sid: el.getAttribute('data-cbsid'), name: el.getAttribute('data-cbname'), mount: el.getAttribute('data-cbmount'), label: el.getAttribute('aria-label'),
    title: el.getAttribute('title'), w: Math.round(r.width), h: Math.round(r.height), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
    tag: el.tagName, onclick: el.getAttribute('onclick') };
}

W.run('shop-icons', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/catalogue/' + SHOP + '*', (r) => (/support\/preview/.test(r.request().url()) ? r.fulfill(J({ to: 'the shop', can_send: true })) : r.fulfill(J(view))));
  const open = {
    support: async () => { await page.locator('[data-testid="shop-support"]').focus(); await page.keyboard.press('Enter'); },
    order: async () => { await page.locator('[data-testid="shop-order-0"]').focus(); await page.keyboard.press('Enter'); },
    wall: async () => { await page.evaluate(() => vizOpen(0)); },
    basket: async () => {
      await page.locator('[data-testid="cart-add"]').first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      if (!(await page.locator('[data-testid="cart-checkout"]').isVisible().catch(() => false))) await page.locator('[data-testid="shop-dock"] .cbcart-bar').first().click();
      await page.locator('[data-testid="cart-checkout"]').focus(); await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="shop-mode-delivery"]', { timeout: 8000 });
    }
  };
  const load = async (vp) => {
    await page.setViewportSize(vp);
    await page.goto(w.base + '/shop.html?s=' + SHOP + '&api=' + encodeURIComponent(w.base));
    await page.waitForSelector('[data-testid="shop-head"]', { timeout: 15000 });
  };
  const facts = {};
  for (const [vp, tag] of [[{ width: 1366, height: 768 }, '1366'], [{ width: 390, height: 844 }, '390']]) {
    for (const [mount, key, testid] of SHEETS) {
      await load(vp);
      await open[key]();
      await page.waitForSelector('[data-testid="' + testid + '"]', { timeout: 8000 });
      facts[key + tag] = await page.evaluate(readCloser, testid);
      facts[key + tag].mountWant = mount;
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      facts[key + tag + 'dark'] = await page.evaluate(readCloser, testid);
    }
  }
  const all = Object.entries(facts);
  await w.step('I1', 'each closer is the library close: CMP005-B01, data-cbname close, its own SHP001 mount, a button with no inline onclick', async () => {
    const bad = all.filter(([k, f]) => !f || f.sid !== 'CMP005-B01' || f.name !== 'close' || f.tag !== 'BUTTON' || f.onclick || (f.mountWant && f.mount !== f.mountWant));
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8');
    const left = ['B11', 'B15', 'B17', 'B26'].filter((b) => src.includes('data-cbsid="SHP001-' + b + '"'));
    return { ok: !bad.length && !left.length, saw: all.length + ' reads · bad ' + bad.map((b) => b[0]).join(',') + ' · hand-written left ' + left.join(',') };
  });
  await w.step('I2', 'name Close, a tooltip, a 44 px box at 1366 and 390', async () => {
    const bad = all.filter(([k, f]) => !f || f.label !== 'Close' || f.title !== 'Close' || f.w < 44 || f.h < 44);
    return { ok: !bad.length, saw: 'bad ' + bad.map(([k, f]) => k + ':' + (f && f.w + 'x' + f.h)).join(',') + ' · smallest ' + Math.min(...all.map(([, f]) => f.w)) };
  });
  await w.step('I3', 'ink against the sheet at least 4.5:1, cream and data-theme=dark', async () => {
    const bad = all.filter(([k, f]) => !f || f.ratio < 4.5);
    return { ok: !bad.length, saw: 'lowest ' + Math.min(...all.map(([, f]) => f.ratio)) + ' · bad ' + bad.map(([k, f]) => k + ':' + f.ratio).join(',') };
  });
  await w.step('I4', 'keyboard: Tab reaches each closer, Enter closes it (Space too, on the support sheet)', async () => {
    const out = [];
    for (const [mount, key, testid] of SHEETS) {
      await load({ width: 1366, height: 768 });
      await open[key]();
      await page.waitForSelector('[data-testid="' + testid + '"]');
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((t) => !!document.activeElement && document.activeElement.getAttribute('data-testid') === t, testid);
      }
      await page.keyboard.press(key === 'support' ? 'Space' : 'Enter');
      await page.waitForTimeout(350);
      const gone = (await page.locator('[data-testid="' + testid + '"]').count()) === 0;
      out.push(mount + ' ' + key + ' reached ' + reached + ' closed ' + gone);
      if (!(reached && gone)) return { ok: false, saw: out.join(' · ') };
    }
    return { ok: true, saw: out.join(' · ') };
  });
  await w.step('I4b', 'keyboard: Tab leaves the quantity box forward when its echo changes (1234.5) and when it shows an error (abc)', async () => {
    const out = [];
    await load({ width: 1366, height: 768 });
    await open.order();
    await page.waitForSelector('[data-testid="shop-qty"]', { timeout: 8000 });
    for (const typed of ['1234.5', 'abc']) {
      const box = page.locator('[data-testid="shop-qty"]');
      await box.focus();
      await box.fill(typed);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      const where = await page.evaluate(() => { const a = document.activeElement; return { id: a && a.id, tag: a && a.tagName, inSheet: !!(a && a.closest('[role=dialog]')) }; });
      const moved = where.id !== 'o_qty' && where.tag !== 'BODY' && where.inSheet;
      out.push(typed + ' -> ' + where.tag + '#' + where.id + (moved ? ' moved' : ' STUCK'));
      if (!moved) return { ok: false, saw: out.join(' · ') };
    }
    return { ok: true, saw: out.join(' · ') };
  });
});
