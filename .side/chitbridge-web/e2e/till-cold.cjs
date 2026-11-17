/* till-cold.cjs — THE COUNTER OPENS AND BILLS WITH NO SERVER AT ALL ([TILL-106])
 *
 * Athi, 2026-09-19: *"we can see how independantly this application can run"* — and, asked what to do first:
 * *"do the cold offline harness first."*
 *
 * ⚠️⚠️⚠️ THIS IS THE TEST THAT DID NOT EXIST, AND IT IS THE ONE THE WHOLE PITCH RESTS ON. Twenty-one harnesses
 * measure the counter and every one of them serves the page from a running HTTP server. "Works offline" has
 * therefore been an ASSERTION for as long as the counter has existed: the service worker's KEEP list is
 * maintained carefully by scripts/vendor-till.cjs and nothing has ever checked that it is sufficient.
 *
 * ⭐ SO THE SERVER IS ACTUALLY STOPPED. Not throttled, not `setOffline` alone — `srv.close()`, the port dead,
 * and then a NEW page opened at the same URL. If the service worker has not really cached the shell, nothing
 * loads and this fails. That is the point: a test that leaves the server running proves nothing about a shop
 * whose line is down.
 *
 * ⚠️ WHAT "COLD" MEANS HERE: a new document, not a reload of a page already in memory. Same browser context, so
 * the cache and IndexedDB survive exactly as they would on a shop PC reopened the next morning — which is the
 * real scenario. A fresh context would be a first-ever visit, which genuinely cannot work offline and is not
 * what anybody is claiming.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(28) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const ITEMS = [
  { item_id: 'v1', name: 'Tomato',  code: 'V1', category: 'Vegetables', unit: 'kg', price: 40 },
  { item_id: 'v2', name: 'Coconut', code: 'V2', category: 'Vegetables', unit: 'pc', price: 25 },
];
const SHOP = { name: 'Anbu Vegetables', currency: 'INR', country: 'IN' };

(async () => {
  let served = 0;
  const srv = http.createServer((q, r) => {
    served++;
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const URL = 'http://127.0.0.1:' + port + '/till.html';

  const b = await chromium.launch();
  /* ⚠️ ONE CONTEXT THROUGHOUT — the cache and IndexedDB are the shop PC's own disk, and they must survive */
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });

  /* ══ PHASE 1 · with the line, as a shop is set up on its first day ════════════════════════════════════ */
  console.log('\n── with the line ' + '─'.repeat(44));
  const p1 = await ctx.newPage();
  await p1.goto(URL);
  await p1.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  /* the service worker has to INSTALL and finish caching, or phase 2 is testing nothing */
  const sw = await p1.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { ok: false, why: 'no serviceWorker in this browser' };
    const reg = await navigator.serviceWorker.ready;
    /* ⚠️ `ready` resolves on ACTIVE, but addAll may still be running — wait for the shelf to hold the page */
    /* ⚠️ the shelf is named per release (till-sw.js SHELF: cb-till-v4 today) — read the name, never pin it (round W1) */
    const shelf = async () => (await caches.keys()).filter((k) => /^cb-till-v/.test(k)).sort().pop() || 'cb-till-v?';
    for (let i = 0; i < 60; i++) {
      const c = await caches.open(await shelf());
      if (await c.match('/till.html')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const c = await caches.open(await shelf());
    const keys = (await c.keys()).map((k) => new URL(k.url).pathname).sort();
    return { ok: !!reg.active, controller: !!navigator.serviceWorker.controller, cached: keys };
  });
  say('the service worker is live', sw.ok, sw.ok ? 'active, holding ' + sw.cached.length + ' files' : sw.why);
  say('the page itself is cached', (sw.cached || []).indexOf('/till.html') >= 0, '/till.html is on the shelf');

  /**
   * ⚠️⚠️ EVERY ENGINE THE PAGE LOADS MUST BE ON THE SHELF. This is the check that would have caught units.js,
   * profilemap.js, jurisdiction.js and govcontext.js had they been added to the page and not to KEEP — four
   * chances to break the counter offline, in one day, with nothing to say so.
   */
  const want = await p1.evaluate(() => [...new Set([...document.querySelectorAll('script[src^="/engine/"]')]
    .map((s) => new URL(s.src).pathname))].sort());
  const missing = want.filter((w) => (sw.cached || []).indexOf(w) < 0);
  say('every engine is cached', missing.length === 0,
    missing.length ? want.length + ' loaded, MISSING from the shelf: ' + missing.join(' ') : 'all ' + want.length + ' on the shelf');

  /* what a paired counter has on its disk: the shop and its products */
  await p1.evaluate(async ({ shop, items }) => {
    window.S = { shop, items, offers: [], at: new Date().toISOString() };
    await DB.set('snapshot', window.S);
  }, { shop: SHOP, items: ITEMS });
  /**
   * ⚠️⚠️ AND THE COUNTER'S OWN NUMBER, WHICH IS GIVEN ONLINE AND ONLY ONLINE. The first run of this harness
   * skipped it and finish() refused the sale — correctly: tillStopped() says *'A new counter needs the internet
   * once, so ChitBridge can give it a number no other counter uses.'* That is the guard from the two-PCs-both-C1
   * incident and it must NOT be weakened to make an offline test pass. It is seeded HERE, in the with-the-line
   * phase, because that is exactly when a real counter receives it. [[project-till-series-prefix]]
   */
  await p1.evaluate(() => { ls.set(tillGivenKey(), 'C1'); });
  const given = await p1.evaluate(async () => ({ ok: await tillGivenOK(), id: ls.get(tillGivenKey(), '') }));
  say('it was given its number', given.ok, 'this counter numbers as ' + given.id + ', given while online');
  say('the shop is on its disk', true, 'snapshot written to IndexedDB, as pairing would');

  await p1.close();

  /* ══ PHASE 2 · the line is gone, and so is the server ═════════════════════════════════════════════════ */
  console.log('\n── no server, no line ' + '─'.repeat(39));
  await new Promise((r) => srv.close(r));         /* ⚠️ THE PORT IS DEAD. Nothing can be fetched. */
  const servedBefore = served;
  await ctx.setOffline(true);                     /* and the browser believes it is offline too */
  say('the server is stopped', true, 'port ' + port + ' closed after ' + served + ' requests');

  const p2 = await ctx.newPage();
  let loadErr = null;
  try { await p2.goto(URL, { timeout: 20000 }); } catch (e) { loadErr = String(e && e.message).split('\n')[0]; }
  say('the counter opens anyway', !loadErr, loadErr || 'served by the service worker, from cache');

  if (loadErr) {
    console.log('\n' + (bad || 1) + ' failed — nothing further can be measured with the page unopened');
    await b.close(); process.exit(1);
  }

  await p2.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 20000 });

  const cold = await p2.evaluate(async () => {
    const snap = await DB.get('snapshot');
    return {
      controlled: !!navigator.serviceWorker.controller,
      online: navigator.onLine,
      /* every engine the page depends on, by its global — an engine that 404'd is undefined here */
      engines: { money: !!window.CBMoney, tax: !!window.CBTax, offers: !!window.CBOffers,
                 pricing: !!window.CBPricing, screen: !!window.CBScreen, units: !!window.CBUnits,
                 doc: !!window.CBDoc, search: !!window.CBSearch, qr: typeof window.qrcode === 'function',
                 locale: !!window.CBLocale, rewards: !!window.CBRewards, variant: !!window.CBVariant,
                 gs1: !!window.CBGS1, lots: !!window.CBLots, nums: !!window.CBNums,
                 profilemap: !!window.CBProfileMap, jurisdiction: !!window.CBJurisdiction, gov: !!window.CBGov },
      snapItems: (snap && snap.items && snap.items.length) || 0,
      snapShop: (snap && snap.shop && snap.shop.name) || null,
    };
  });
  say('the browser knows it is off', cold.online === false, 'navigator.onLine is false');
  say('a service worker served it', cold.controlled, 'the page is controlled');
  const dead = Object.keys(cold.engines).filter((k) => !cold.engines[k]);
  say('every engine loaded', dead.length === 0,
    dead.length ? 'MISSING: ' + dead.join(', ') : Object.keys(cold.engines).length + ' engines present');
  say('its shop came back', cold.snapShop === SHOP.name && cold.snapItems === ITEMS.length,
    '"' + cold.snapShop + '" with ' + cold.snapItems + ' products, out of IndexedDB');

  /* ══ and now the only thing that actually matters: can it take money? ════════════════════════════════ */
  const sale = await p2.evaluate(async () => {
    const snap = await DB.get('snapshot');
    window.S = snap;
    setMode('sell'); applyLook(); paintChips();
    addItem(snap.items[0], 0.5);     /* half a kilo of tomato */
    addItem(snap.items[1], 3);       /* three coconuts */
    price();
    const el = document.querySelector('[data-testid="till-total"]');
    return {
      total: el ? el.innerText : '',
      words: typeof countWords === 'function' ? countWords() : '',
      /* ⭐ a bill number, NUMBERED OFFLINE — the counter must not need a server to name a sale */
      num: (typeof nextNo === 'function') ? String(nextNo() || '') : (typeof billNo === 'function' ? String(billNo() || '') : '(no numberer)'),
    };
  });
  /* 0.5×40 + 3×25 = 95 */
  const n = Number((sale.total.match(/[\d.,]+/) || ['0'])[0].replace(/,/g, ''));
  say('it prices the bill', Math.abs(n - 95) < 0.01, 'TOTAL reads "' + sale.total + '", expected 95');
  say('and counts it correctly', /0.5 kg/.test(sale.words) && /3 items/.test(sale.words), '"' + sale.words + '"');

  /**
   * ⚠️⚠️ THE SALE IS COMPLETED, not merely priced. finish() is what F9 does; with no line the bill must be
   * written to the counter's own store and QUEUED, never lost. A till that prices offline and cannot take the
   * money is not an offline till.
   */
  const done = await p2.evaluate(async () => {
    const before = ((await DB.all('bills')) || []).length;
    let err = null;
    try { await finish(); } catch (e) { err = String(e && e.message); }
    await new Promise((r) => setTimeout(r, 400));
    const bills = (await DB.all('bills')) || [], queue = (await DB.all('queue')) || [];
    return { err, before, bills: bills.length, queued: queue.length,
             last: bills.length ? { no: bills[bills.length - 1].no, total: bills[bills.length - 1].total } : null };
  });
  say('the sale completes', !done.err && done.bills > done.before,
    done.err ? 'finish() threw: ' + done.err : 'bill ' + (done.last && done.last.no) + ' for ' + (done.last && done.last.total) + ' written to its own store');
  say('and it is queued to send', done.queued > 0, done.queued + ' waiting for the line');

  /* ⚠️ and the server really was never touched — proof the whole phase came off the shelf */
  say('the server was never reached', served === servedBefore, served - servedBefore + ' requests hit the (closed) server');

  if (SHOTS) {
    const out = path.join(__dirname, '..', 'png', 'ColdOffline.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p2.screenshot({ path: out });
    console.log('  shot                        · png/ColdOffline.png');
  }

  await b.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe counter opened, billed and banked a sale with no server at all');
  process.exit(bad ? 1 : 0);
})();
