/* scale-probe.cjs — WHERE DOES A TEN-THOUSAND ITEM SHOP HANG? (Athi, 2026-09-08: "I tried opening tallytest on another PC, completely hanged, both in
 * web and in till.")
 *
 * Guessing at performance is how you optimise the wrong loop. This drives the REAL deployed pages with a synthetic shop of 10,000
 * items and times each step separately — building the list, searching it, painting it, and the offer filter — so the fix lands where
 * the milliseconds actually are.
 *
 * Run: node e2e/scale-probe.cjs [count]
 */
'use strict';
const path = require('path');
const { chromium } = require('@playwright/test');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const SESSION = process.env.CB_SESSION || path.join(__dirname, '.auth', 'user.json');
const N = Number(process.argv[2]) || 10000;

const CATS = ['Spices', 'Edible oil', 'Dairy', 'Biscuits & snacks', 'Rice & grains', 'Cleaning', 'Personal care', 'Beverages'];
const BRANDS = ['Aachi', 'Anil', 'Aavin', 'Britannia', 'Tata', 'Nirma', 'Amul', 'Parle'];

const say = (label, ms, note) => console.log('  ' + String(Math.round(ms)).padStart(6) + ' ms  ' + label + (note ? '   ' + note : ''));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ baseURL: WEB, storageState: SESSION });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  THREW: ' + e.message));

  /* ── THE COUNTER ─────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── the counter, ' + N + ' items ──');
  await p.goto('/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function' && !!window.CBSearch, null, { timeout: 30000 });

  const till = await p.evaluate(({ n, cats, brands }) => {
    const t = () => performance.now();
    const out = {};
    let a = t();
    const items = [];
    for (let i = 0; i < n; i++) {
      items.push({ item_id: 'i' + i, name: brands[i % brands.length] + ' product ' + i + ' 100 g',
        code: 'BULK-' + String(i).padStart(6, '0'), unit: 'piece', price: 10 + (i % 400),
        category: cats[i % cats.length], barcode: '89010' + String(i).padStart(8, '0'),
        tax_slab: (i % 3 === 0) ? 'gst-5' : null });
    }
    out.build = t() - a;

    a = t();
    window.S = { shop: { name: 'Scale test', reg_type: 'unregistered' }, items, offers: [], slabs: [], categories: [],
                 customers: [], staff: [], policy: {}, version: 'scale', at: new Date().toISOString() };
    out.assign = t() - a;

    a = t(); paintChips(); out.chips = t() - a;
    a = t(); document.getElementById('q').value = ''; paintHits(); out.paintAll = t() - a;
    a = t(); document.getElementById('q').value = 'product 9999'; const h1 = hits().length; paintHits(); out.searchCold = t() - a;
    a = t(); document.getElementById('q').value = 'product 9998'; hits(); paintHits(); out.searchWarm = t() - a;
    a = t(); document.getElementById('q').value = 'zzzqqq'; hits(); paintHits(); out.searchMiss = t() - a;
    a = t(); document.getElementById('q').value = 'BULK-009999'; hits(); paintHits(); out.searchCode = t() - a;
    /* the offer chip asks the offers engine about EVERY item */
    a = t(); try { setFilter('offer'); } catch (_) {} out.offerFilter = t() - a;
    try { setFilter('all'); } catch (_) {}
    out.hits = h1;
    return out;
  }, { n: N, cats: CATS, brands: BRANDS });

  say('build the fake shop (the test\'s own cost)', till.build);
  say('hand it to the page', till.assign);
  say('paint the department chips', till.chips);
  say('paint with an EMPTY box (60 rows)', till.paintAll);
  say('first search — cold, every text built', till.searchCold, till.hits + ' hits');
  say('second search — warm', till.searchWarm);
  say('a search that matches nothing', till.searchMiss, '(the letters pass runs over everything)');
  say('a product code', till.searchCode);
  say('⚠️ the ON OFFER chip', till.offerFilter, '(asks the offers engine about every item)');

  /* ── THE CATALOGUE SCREEN ────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── the app\'s Catalogue, ' + N + ' products ──');
  await p.goto('/app.html');
  await p.waitForFunction(() => typeof window.prodVisible === 'function', null, { timeout: 45000 });

  const app = await p.evaluate(({ n, cats, brands }) => {
    const t = () => performance.now();
    const out = {};
    let a = t();
    const prods = [];
    for (let i = 0; i < n; i++) {
      prods.push({ id: 'p' + i, item_id: 'p' + i, item_data: { name: brands[i % brands.length] + ' product ' + i + ' 100 g',
        code: 'BULK-' + String(i).padStart(6, '0'), unit: 'piece', price: 10 + (i % 400),
        category: cats[i % cats.length], status: 'available' } });
    }
    out.build = t() - a;
    UI.prods = prods; UI.prodQ = ''; UI._prodCatg = ''; UI._prodAvail = '';
    UI.nav = 'catalogue';

    a = t(); const all = prodVisible(); out.visibleEmpty = t() - a; out.count = all.length;
    a = t(); const html = prodRowsHTML(); out.rowsHTML = t() - a; out.htmlBytes = html.length;
    a = t(); UI.prodQ = 'product 9999'; const some = prodVisible(); out.searchCold = t() - a; out.searchHits = some.length;
    a = t(); UI.prodQ = 'product 9998'; prodVisible(); out.searchWarm = t() - a;
    a = t(); UI.prodQ = 'zzzqqq'; prodVisible(); out.searchMiss = t() - a;
    UI.prodQ = '';
    return out;
  }, { n: N, cats: CATS, brands: BRANDS });

  say('build the fake catalogue (the test\'s own cost)', app.build);
  say('prodVisible() with an empty box', app.visibleEmpty, app.count + ' products');
  say('⚠️ prodRowsHTML() — the HTML for the list', app.rowsHTML, Math.round(app.htmlBytes / 1024) + ' KB of HTML');
  say('first search — cold (offers + tax per product)', app.searchCold, app.searchHits + ' hits');
  say('second search — warm', app.searchWarm);
  say('a search that matches nothing', app.searchMiss);

  console.log('');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
