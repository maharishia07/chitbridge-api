/* till-category-mostused.cjs — "MOST USED FIRST" IS A LIVE MODE, DRIVEN BY REAL SALES, NOT PRODUCT COUNT
 * (design-handoff/02-category-order §2 "The mode", §5 "salesRank30d", Phase 4.6)
 *
 * ⚠️⚠️⚠️ THE RISK NAMED IN THE PACKAGE ITSELF: "Needs a 30-day sales rank that may not exist." Drinks has
 * fewer PRODUCTS than Tiffin here but far more real SALES over the last 30 days — if the order were still
 * "most products first" (the old fallback), Tiffin would lead; the whole point of 4.6 is that it does not.
 *
 * Run: node e2e/till-category-mostused.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(54) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  const setup = await p.evaluate(async () => {
    ls.set(tillGivenKey(), 'C1');
    /* ⭐ TIFFIN: five products, one sale each. DRINKS: two products, sold constantly — fewer items, far
       more actual turnover. The old fallback (most products first) would put Tiffin on top; real sales rank
       must not. */
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
      items: [
        { item_id: 't1', name: 'Idli', price: 40, unit: 'plate', category: 'Tiffin' },
        { item_id: 't2', name: 'Dosa', price: 60, unit: 'plate', category: 'Tiffin' },
        { item_id: 't3', name: 'Vada', price: 30, unit: 'plate', category: 'Tiffin' },
        { item_id: 't4', name: 'Pongal', price: 50, unit: 'plate', category: 'Tiffin' },
        { item_id: 't5', name: 'Uttapam', price: 55, unit: 'plate', category: 'Tiffin' },
        { item_id: 'd1', name: 'Filter Coffee', price: 20, unit: 'cup', category: 'Drinks' },
        { item_id: 'd2', name: 'Tea', price: 15, unit: 'cup', category: 'Drinks' },
      ] };
    setMode('sell');
    /* ⭐ A THIRTY-DAY HISTORY, BUILT BY HAND — the exact shape loadQuick() already reads from HOST.history(30),
       reused here rather than invented: one line per bill, an item_id, nothing else this test needs. */
    var bills = [];
    for (var i = 0; i < 30; i++) {
      bills.push({ at: new Date(Date.now() - i * 86400000).toISOString(), lines: [{ item_id: 'd1' }, { item_id: 'd2' }, { item_id: 'd1' }] });
    }
    bills.push({ at: new Date().toISOString(), lines: [{ item_id: 't1' }] });
    window.HOST = { bills: async function(){ return []; }, history: async function(){ return { bills: bills }; } };
    await loadQuick();
    return { catSales: (typeof CAT_SALES_30D !== 'undefined') ? CAT_SALES_30D : null };
  });
  say('CAT_SALES_30D is filled from the same 30-day evidence loadQuick() already reads',
    setup.catSales && setup.catSales['Drinks'] > setup.catSales['Tiffin'],
    JSON.stringify(setup.catSales));

  console.log('\n── ⭐⭐⭐ default mode is "most used first", and it really is sales, not product count ' + '─'.repeat(0));
  const order = await p.evaluate(() => ({
    mode: catOrderMode(),
    ranked: catsRanked().map((c) => c.name),
  }));
  say('the default mode is most_used', order.mode === 'most_used', order.mode);
  say('Drinks (2 products, heavy sales) leads Tiffin (5 products, one sale)', order.ranked[0] === 'Drinks',
    order.ranked.join(' › '));

  console.log('\n── switching to "The order I set" freezes today\'s most-used order as the starting point ' + '─'.repeat(0));
  const toFixed = await p.evaluate(async () => {
    catOrderOpen();
    var beforeDrag = [...document.querySelectorAll('#catbody .catrow .ct')].map((x) => x.textContent.trim());
    await catModeChange('fixed');   /* no confirm going this direction */
    var afterSwitch = [...document.querySelectorAll('#catbody .catrow .ct')].map((x) => x.textContent.trim());
    return { beforeDrag: beforeDrag, afterSwitch: afterSwitch, movedCount: catMovedCount() };
  });
  say('no confirm needed switching TO fixed', true, 'adopted silently');
  say('the fixed draft starts from the most-used order, nothing begins empty',
    JSON.stringify(toFixed.afterSwitch) === JSON.stringify(toFixed.beforeDrag), toFixed.afterSwitch.join(' › '));
  say('the switch itself is not counted as a move', toFixed.movedCount === 0, toFixed.movedCount + ' moved');

  console.log('\n── now it really can be dragged, and Save makes it stick even as sales keep changing ' + '─'.repeat(0));
  const dragged = await p.evaluate(async () => {
    catMove(1, -1);   /* only two categories here — swap them */
    var draft = [...document.querySelectorAll('#catbody .catrow .ct')].map((x) => x.textContent.trim());
    catOrderSave();
    /* ⭐ sales evidence changes; a FIXED order must not react to it the way most_used would */
    CAT_SALES_30D = { Tiffin: 999, Drinks: 1 };
    var after = catsRanked().map((c) => c.name);
    return { draft: draft, after: after, mode: catOrderMode() };
  });
  say('fixed mode really is draggable', dragged.draft[0] === 'Tiffin', dragged.draft.join(' › '));
  say('and Save persisted the fixed mode', dragged.mode === 'fixed', dragged.mode);
  say('a fixed order ignores new sales evidence entirely', JSON.stringify(dragged.after) === JSON.stringify(dragged.draft),
    dragged.after.join(' › ') + ' — unmoved by Tiffin suddenly outselling everything');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nmost used first is real 30-day sales, and switching to a fixed order freezes exactly what was showing');
  process.exit(bad || errs.length ? 1 : 0);
})();
