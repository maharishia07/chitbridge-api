#!/usr/bin/env node
/**
 * e2e/walk-shop-my-orders.cjs — A RETURNING SHOPPER SEES THEIR ORDERS (T1-ORD · SH-MY1, 2026-10-14).
 * Black box: the real shop.html; the API is a stand-in answering the routes the way api routes/catalogue.js now does
 * (/login/verify → token · /my-orders → orders + total · page · limit, limit capped, Bearer required).
 *   R1  the page offers "My orders"; with no session it opens the sign-in gate, worded for orders, with a way back
 *   R2  phone → code → "See my orders": the token from /login/verify is KEPT and sent as the bearer (it was thrown away)
 *   R3  the list pages on the server's contract: 20 of 45 · Show more → 40 of 45 · Show more → 45 and the end marker
 *   R4  Done, then "My orders" again: the list opens straight away — no second sign-in in the same visit
 *   R5  a shop that states no money: prices carry no ₹ (CART-REG1 — the cart's money is the shop's, never INR by guess)
 *   R6  at 1366 and 390, light and dark: every text in the orders sheet reads at AA; no inner horizontal scroll; no app.html link
 *   NODE_PATH=e2e/node_modules node e2e/walk-shop-my-orders.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contrast.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const TOK = 'tok-returning-shopper';
const WHY = 'Set the shop’s money and the month its year starts (Country setup) — nothing is billed or booked on a guess.';

const view = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: 'CBSIMRET', display_name: 'Sim Returning', currency_code: null, money_why: { code: 'NO_MONEY', why: WHY }, gstn: null, country: null,
    is_verified: true, business_status: 'open', storefront_access: 'browse', unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: [{ item_id: 'i1', item_data: { name: 'Basmati rice 5 kg', unit: 'bag', price: 640 } }] };
const ALL = Array.from({ length: 45 }, (_, i) => ({ chit_id: ('0000000' + i).slice(-8) + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auto_subject: 'Order',
  summary_json: { total_value: 100 + i }, created_at: new Date(Date.UTC(2026, 9, 14) - i * 86400000).toISOString(), current_status: 'delivered', shop_status: i % 3 ? 'accepted' : 'delivered' }));
const seen = { bearer: [], pages: [] };

W.run('shop-my-orders', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/catalogue/CBSIMRET', (r) => r.fulfill(J(view)));
  await page.route('**/api/catalogue/CBSIMRET?*', (r) => r.fulfill(J(view)));
  await page.route('**/api/catalogue/CBSIMRET/order/start', (r) => r.fulfill(J({ message: 'Code sent', dev_otp: '123456' })));
  await page.route('**/api/catalogue/CBSIMRET/login/verify', (r) => r.fulfill(J({ message: 'Signed in', token: TOK, name: 'Ravi' })));
  await page.route('**/api/catalogue/CBSIMRET/my-orders*', (r) => {
    const u = new URL(r.request().url()), auth = r.request().headers().authorization || '';
    seen.bearer.push(auth);
    if (auth !== 'Bearer ' + TOK) return r.fulfill(J({ error: 'Unauthorized', message: 'Sign in again.' }, 401));
    const pg = Math.max(1, Number(u.searchParams.get('page')) || 1), lim = Math.min(50, Number(u.searchParams.get('limit')) || 20);
    seen.pages.push(pg);
    const rows = ALL.slice((pg - 1) * lim, pg * lim);
    return r.fulfill(J({ orders: rows, count: rows.length, total: ALL.length, page: pg, limit: lim }));
  });
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto(w.base + '/shop.html?s=CBSIMRET&api=' + encodeURIComponent(w.base));
  await page.waitForSelector('[data-testid="shop-head"]', { timeout: 15000 });

  await w.step('R1', 'My orders with no session opens the sign-in gate, worded for orders, with a way back', async () => {
    await page.click('[data-testid="shop-my-orders-link"]');
    const t = await page.evaluate(() => document.body.innerText);
    const back = await page.$('[data-testid="shop-login-back"]');
    return { ok: /Sign in to see your orders/.test(t) && !!back, saw: (t.match(/Sign in[^\n]*/) || ['no gate'])[0] + (back ? ' · Back to the shop' : ' · NO way back') };
  });
  await w.step('R2', 'phone → code → See my orders: the token is kept and sent as the bearer', async () => {
    await page.fill('#lg_contact', '9876543210');
    await page.click('button:has-text("Send code")');
    await page.waitForSelector('#lg_otp');
    await page.fill('#lg_otp', '123456');
    await page.click('button:has-text("See my orders")');
    await page.waitForSelector('[data-testid="shop-order-row"]', { timeout: 10000 });
    const ok = seen.bearer.length > 0 && seen.bearer.every((b) => b === 'Bearer ' + TOK);
    return { ok, saw: seen.bearer.length + ' my-orders call(s) · ' + (seen.bearer[0] || 'no bearer') };
  });
  const state = () => page.evaluate(() => ({ rows: document.querySelectorAll('[data-testid="shop-order-row"]').length,
    count: (document.querySelector('[data-testid="shop-orders-count"]') || {}).textContent || '',
    more: !!document.querySelector('[data-testid="shop-orders-more"]'), end: !!document.querySelector('[data-testid="shop-orders-end"]') }));
  await w.step('R3', 'the list pages on the server contract: 20 of 45 → 40 of 45 → 45 and the end marker', async () => {
    const a = await state();
    await page.click('[data-testid="shop-orders-more"]'); await page.waitForFunction(() => document.querySelectorAll('[data-testid="shop-order-row"]').length === 40);
    const b = await state();
    await page.click('[data-testid="shop-orders-more"]'); await page.waitForSelector('[data-testid="shop-orders-end"]');
    const c = await state();
    const ok = a.rows === 20 && a.count === '20 of 45' && a.more && b.rows === 40 && b.more && c.rows === 45 && c.end && !c.more && seen.pages.join(',') === '1,2,3';
    return { ok, saw: [a, b, c].map((x) => x.count + (x.more ? ' +more' : '') + (x.end ? ' end' : '')).join(' → ') + ' · pages ' + seen.pages.join(',') };
  });
  await w.step('R4', 'Done, then My orders again: the list opens with no second sign-in', async () => {
    const before = seen.bearer.length;
    await page.click('button:has-text("Done")');
    await page.click('[data-testid="shop-my-orders-link"]');
    await page.waitForSelector('[data-testid="shop-order-row"]', { timeout: 10000 });
    const gate = await page.evaluate(() => /Sign in to see your orders/.test(document.body.innerText));
    return { ok: !gate && seen.bearer.length === before + 1, saw: gate ? 'the gate asked again' : 'opened straight away' };
  });
  await w.step('R5', 'a shop that states no money: no rupee sign on its prices', async () => {
    await page.click('button:has-text("Done")');
    const t = await page.evaluate(() => document.body.innerText);
    return { ok: !/₹/.test(t) && /640/.test(t), saw: (t.match(/[^\n]*640[^\n]*/) || ['no price'])[0].trim().slice(0, 60) };
  });
  for (const vp of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) {
    for (const scheme of ['light', 'dark']) {
      await w.step('R6', vp.width + ' · ' + scheme + ' · the orders sheet: AA contrast · no inner scroll · no app.html link', async () => {
        await page.setViewportSize(vp); await page.emulateMedia({ colorScheme: scheme });
        await page.click('[data-testid="shop-my-orders-link"]');
        await page.waitForSelector('[data-testid="shop-order-row"]', { timeout: 10000 });
        const r = await page.evaluate(() => {
          const rgb = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = rgb(getComputedStyle(e).backgroundColor); if (b && b.a > 0.5) return b.c; } return [255, 255, 255]; };
          const sheet = document.querySelector('[data-testid="shop-orders"]').parentNode;
          const out = [];
          for (const el of sheet.querySelectorAll('*')) {
            if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
            const cs = getComputedStyle(el), fg = rgb(cs.color), bg = bgOf(el); if (!fg || !bg) continue;
            const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
            out.push({ t: el.textContent.trim().slice(0, 30), fg: fg.c, bg, large: size >= 24 || (bold && size >= 18.66) });
          }
          const scrollers = Array.from(sheet.querySelectorAll('*')).filter((e) => { const cs = getComputedStyle(e); return /auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0; }).length;
          const clipped = Array.from(sheet.querySelectorAll('*')).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'hidden').length;
          return { out, wide: document.documentElement.scrollWidth > window.innerWidth + 1, scrollers, clipped, appLinks: document.querySelectorAll('a[href*="app.html"]').length };
        });
        const hex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
        const low = r.out.filter((x) => C.ratio(hex(x.fg), hex(x.bg)) < (x.large ? 3 : 4.5));
        await page.click('button:has-text("Done")');
        const ok = !low.length && !r.wide && !r.scrollers && !r.clipped && !r.appLinks;
        return { ok, saw: r.out.length + ' texts' + (low.length ? ' · LOW: ' + low.slice(0, 3).map((x) => '"' + x.t + '" ' + C.ratio(hex(x.fg), hex(x.bg)).toFixed(2)).join(', ') : ' · all AA')
          + (r.wide ? ' · page wider than the window' : '') + (r.scrollers ? ' · inner scroll' : '') + (r.clipped ? ' · clipped text' : '') + (r.appLinks ? ' · app.html link' : '') };
      });
    }
  }
});
