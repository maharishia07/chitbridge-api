/**
 * e2e/till-phone.cjs — THE COUNTER ON A PHONE: it opens, sells a bill, fits the width, and keeps its data (2026-09-28).
 *
 * Athi: "can we use the counter app in mobile, do the mobile supports indexed db? and our application should run
 * without any issues?" till-fits.cjs deliberately excludes the phone ("it sells in three steps and is its own
 * contract"), and until this file nothing sold a bill at phone size end to end.
 * Local server, a phone viewport with touch; the API is a local stand-in. Run: node e2e/till-phone.cjs
 */
'use strict';
const { chromium, devices } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(56) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });           /* 390×844, touch, a phone user agent */
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.modOpen === 'function', null, { timeout: 30000 });

  console.log('\n── the phone has what the counter keeps its bills in');
  const store = await p.evaluate(async () => ({
    idb: typeof indexedDB !== 'undefined',
    persist: !!(navigator.storage && navigator.storage.persist),
    open: await new Promise((res) => { try { const rq = indexedDB.open('cb-phone-probe', 1); rq.onsuccess = () => { rq.result.close(); res(true); }; rq.onerror = () => res(false); } catch (_) { res(false); } }),
  }));
  say('IndexedDB is there and opens', store.idb && store.open, JSON.stringify(store));

  console.log('\n── it sells a bill');
  const sold = await p.evaluate(async (api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), offers: [],
      items: [{ item_id: 'a', name: 'Masala Dosa', price: 70, unit: 'plate', category: 'Tiffin' },
              { item_id: 'b', name: 'Filter Coffee', price: 30, unit: 'cup', category: 'Drinks' }] };
    window.ageAllow = async () => true;
    MODE = 'sell'; CART.length = 0;
    await modOpen(S.items[0], 2); await modOpen(S.items[1], 1);
    try { paintHits(); price(); } catch (_) {}
    return { lines: CART.length, total: CART.reduce((t, l) => t + l.price * l.qty, 0) };
  }, base);
  say('two products on the bill, the right total', sold.lines === 2 && sold.total === 170, sold.lines + ' lines · ₹' + sold.total);

  console.log('\n── it fits a phone');
  await p.waitForTimeout(400);
  const fit = await p.evaluate(() => ({ vw: innerWidth, sw: document.documentElement.scrollWidth,
    bodyW: document.body.scrollWidth }));
  say('nothing runs off the side (no sideways scroll)', fit.sw <= fit.vw + 1 && fit.bodyW <= fit.vw + 1, 'viewport ' + fit.vw + ' · page ' + fit.sw);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'till-phone.png') });

  /* Athi: "fix the search placeholder and the cart count mismatch" */
  console.log('\n── the search box and the counts read right on a phone');
  const ph = await p.evaluate(() => {
    const q = document.getElementById('q');
    const c = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(q);
    c.font = cs.fontSize + ' ' + cs.fontFamily;
    const room = q.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { text: q.placeholder, fits: c.measureText(q.placeholder).width <= room, room: Math.round(room), need: Math.round(c.measureText(q.placeholder).width) };
  });
  say('the placeholder is the short one, and it fits the box', ph.text === 'Item or barcode' && ph.fits, '"' + ph.text + '" · ' + ph.need + 'px in ' + ph.room + 'px');
  const counts = await p.evaluate(() => { try { paintQuick(); } catch (_) {} try { paintSteps(); } catch (_) {}
    const chip = document.querySelector('[data-testid="till-cart-chip"] b'); const step = document.querySelector('[data-testid="till-step-count"]');
    return { chip: chip && chip.textContent, step: step && step.textContent }; });
  say('the cart chip and the Bill button give ONE count', !!counts.chip && counts.chip === counts.step, 'chip ' + counts.chip + ' · Bill ' + counts.step);

  const d = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await d.goto(base + '/till.html'); await d.waitForFunction(() => typeof window.modOpen === 'function', null, { timeout: 30000 });
  const wide = await d.evaluate(() => { setMode('sell'); return document.getElementById('q').placeholder; });
  say('a desktop keeps the full hint (↓↑, Enter)', /↓↑ to choose, Enter to add/.test(wide), '"' + wide + '"');

  say('console/page errors', !errs.length, errs.length ? errs.join(' | ').slice(0, 240) : 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nthe counter runs on a phone');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
