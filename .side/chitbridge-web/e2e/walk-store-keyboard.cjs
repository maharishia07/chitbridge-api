#!/usr/bin/env node
/**
 * e2e/walk-store-keyboard.cjs - STORE, KNOW YOUR BUSINESS AND NETWORK SHOP BY KEYBOARD, AND NO ORDER WITHOUT A CONFIRM (UX-5, 2026-11-12).
 * Black box: the real public pages with a stand-in api; every action here is a key (Tab, Shift+Tab, Enter, Space, arrows, Home, End, Escape).
 *   K1  Know your business: Tab reaches the tab strip; ArrowRight / ArrowLeft / End / Home move the tab and the address; the focus stays on the tab
 *   K2  Know your business: a tab is a real button (role tab, selected state), Enter on a focused tab opens it
 *   S1  Store: a category chip is reached by Tab and chosen by Space; the list narrows; the focus stays on the chip
 *   S2  Store: Place order (Enter) opens the library confirm that says what is promised, to whom, the total; NO order has been sent yet, no browser prompt()
 *   S3  Store: Escape on the confirm sends nothing; Place order in the confirm sends exactly one order with the typed name
 *   N1  Network shop: a department chip is reached by Tab and chosen by Space; the focus stays on it
 *   N2  Network shop at 390x844: the search placeholder is not cut, and the page has no sideways scroll
 * It must FAIL on main: there the tabs and chips are div/span (no Tab stop), Place order asks with prompt() and sends at once.
 *   NODE_PATH=<dir with playwright> node e2e/walk-store-keyboard.cjs
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

/** press Tab until the focused element satisfies test (run in the page); false after max presses */
async function tabTo(page, test, arg, max) {
  for (let i = 0; i < (max || 40); i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(([src, a]) => { const e = document.activeElement; return !!e && new Function('e', 'a', 'return ' + src)(e, a); }, [test, arg || null])) return true;
  }
  return false;
}
const focused = (page) => page.evaluate(() => { const e = document.activeElement; return e ? (e.tagName.toLowerCase() + '|' + (e.getAttribute('role') || '') + '|' + (e.textContent || '').trim().slice(0, 24)) : 'none'; });

W.run('store-keyboard', async (w) => {
  const { page, ctx } = w;
  const posts = [];
  const prompts = [];
  page.on('dialog', async (d) => { prompts.push(d.type() + ':' + d.message().slice(0, 30)); await d.dismiss(); });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) { /* no storage: the page shows its own sign-in */ } }, W.session('Fixture Owner', 'Fixture Shop'));
  await page.route('**/api/**', (r) => {
    const req = r.request(), u = req.url();
    if (req.method() === 'POST' && /network-store\/.*\/order/.test(u)) { posts.push(req.postDataJSON()); return r.fulfill(J({ ok: true, order_id: 'abcdef1234567890', item_count: 1, total: 180 })); }
    if (/network-store/.test(u)) return r.fulfill(J(STORE));
    if (/catalogue\/network\//.test(u)) return r.fulfill(J(NETWORK));
    if (/kyb\/yourself/.test(u)) return r.fulfill(J({ credentials: [], ladder: [], applies: [] }));
    return r.fulfill(J({}));
  });

  /* K1 · K2 · Know your business */
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(w.base + '/know-your-business.html');
  await page.waitForSelector('.tab', { timeout: 15000 });
  await page.waitForTimeout(300);
  await w.step('K1', 'Know your business: Tab reaches the tab strip, arrows and Home/End change the tab and the address, the focus stays on the tab', async () => {
    const reached = await tabTo(page, "e.classList.contains('tab')");
    const seen = [];
    for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      seen.push(key + '->' + (await page.evaluate(() => location.hash)) + ' on ' + (await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('tab') ? document.activeElement.textContent.trim() : 'NOT A TAB')));
    }
    const ok = reached && /position/.test(seen[0]) && /Position/.test(seen[0]) && /yourself/.test(seen[1]) && /field/.test(seen[2]) && /Field/.test(seen[2]) && /yourself/.test(seen[3]) && /Yourself/.test(seen[3]);
    return { ok, saw: (reached ? 'a tab took the Tab key' : 'NO TAB STOP') + ' · ' + seen.join(' · ') };
  });
  await w.step('K2', 'Know your business: a tab is a real button with a selected state, and Enter opens a focused tab', async () => {
    const shape = await page.evaluate(() => { const t = document.querySelector('.tab.on'); return t ? t.tagName.toLowerCase() + '|' + t.getAttribute('role') + '|' + t.getAttribute('aria-selected') : 'none'; });
    await page.evaluate(() => document.querySelector('.tab[id$="risk"]') && document.querySelector('.tab[id$="risk"]').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const on = await page.locator('.tab.on').first().innerText();
    return { ok: shape === 'button|tab|true' && /Risk/i.test(on), saw: 'selected tab is ' + shape + ' · Enter on Risk opened: ' + on };
  });

  /* S1 · S2 · S3 · Store */
  await page.goto(w.base + '/store.html?net=CBNET0001');
  await page.waitForSelector('.grid .card', { timeout: 15000 });
  await w.step('S1', 'Store: a category chip is reached by Tab and chosen by Space; the list narrows and the focus stays on the chip', async () => {
    const reached = await tabTo(page, "e.classList.contains('chip') && e.getAttribute('data-cat') === a", 'Pulses');
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    const n = await page.locator('.grid .card').count();
    const keep = await page.evaluate(() => { const e = document.activeElement; return e && e.classList.contains('chip') ? e.textContent.trim() + ' pressed=' + e.getAttribute('aria-pressed') : 'LOST'; });
    return { ok: reached && n === 1 && keep === 'Pulses pressed=true', saw: (reached ? 'chip reached by Tab' : 'NO TAB STOP') + ' · ' + n + ' product(s) · focus ' + keep };
  });
  await w.step('S2', 'Store: Place order opens the confirm (what, to whom, total) and sends nothing yet; no prompt() box', async () => {
    await page.locator('.card button').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cartbar.show button', { timeout: 5000 });
    await page.locator('.cartbar button').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const dlg = await page.evaluate(() => { const d = document.querySelector('[data-testid="confirm"]'); return d && d.open ? d.innerText : ''; });
    const ok = /Place this order/.test(dlg) && /CBNET0001/.test(dlg) && /Toor dal/.test(dlg) && /180/.test(dlg) && /Your name/.test(dlg) && posts.length === 0 && prompts.length === 0;
    return { ok, saw: 'confirm: "' + dlg.replace(/\s+/g, ' ').slice(0, 150) + '" · orders sent so far ' + posts.length + ' · browser prompts ' + prompts.length };
  });
  await page.screenshot({ path: process.env.WALK_SHOTS ? process.env.WALK_SHOTS + '/store-confirm-1366.png' : 'e2e/shots/store-confirm-1366.png' }).catch(() => null);
  await w.step('S3', 'Store: Escape sends nothing; Place order in the confirm sends exactly one order with the typed name', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => !document.querySelector('[data-testid="confirm"]'));
    const after = posts.length;
    await page.locator('.cartbar button').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="confirm"]', { timeout: 5000 });
    await page.keyboard.type('Asha');
    await page.locator('[data-testid="confirm-ok"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const body = posts[0] || {};
    return { ok: gone && after === 0 && posts.length === 1 && body.customer && body.customer.name === 'Asha' && body.items && body.items.length === 1, saw: 'Escape left ' + after + ' orders · then ' + posts.length + ' order(s), name ' + JSON.stringify(body.customer) };
  });

  /* N1 · N2 · Network shop */
  await page.goto(w.base + '/network-shop.html?bridge=CBNET0001');
  await page.waitForSelector('.chips .chip', { timeout: 15000 });
  await w.step('N1', 'Network shop: a department chip is reached by Tab and chosen by Space; the focus stays on it', async () => {
    const reached = await tabTo(page, "e.classList.contains('chip') && e.textContent.trim() === a", 'Dairy');
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    const n = await page.locator('.dept').count();
    const keep = await page.evaluate(() => { const e = document.activeElement; return e && e.classList.contains('chip') ? e.textContent.trim() + ' pressed=' + e.getAttribute('aria-pressed') : 'LOST'; });
    return { ok: reached && n === 1 && keep === 'Dairy pressed=true', saw: (reached ? 'chip reached by Tab' : 'NO TAB STOP') + ' · ' + n + ' department(s) · focus ' + keep };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(w.base + '/network-shop.html?bridge=CBNET0001');
  await page.waitForSelector('.srch input', { timeout: 15000 });
  await page.screenshot({ path: process.env.WALK_SHOTS ? process.env.WALK_SHOTS + '/nshop-390.png' : 'e2e/shots/nshop-390.png' }).catch(() => null);
  await w.step('N2', 'Network shop at 390x844: the search placeholder is shown whole, and nothing scrolls sideways', async () => {
    const m = await page.evaluate(() => {
      const i = document.getElementById('q'), cs = getComputedStyle(i);
      const c = document.createElement('canvas').getContext('2d');
      c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { need: Math.ceil(c.measureText(i.placeholder).width), room: Math.floor(room), side: document.documentElement.scrollWidth - innerWidth };
    });
    return { ok: m.need <= m.room && m.side <= 0, saw: 'placeholder needs ' + m.need + ' px, the box has ' + m.room + ' px · sideways overflow ' + m.side + ' px' };
  });
});
