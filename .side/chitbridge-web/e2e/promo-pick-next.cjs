/**
 * e2e/promo-pick-next.cjs — A PRODUCT JUST SWITCHED ONTO THE SHOP SCREEN IS THE NEXT SLIDE (2026-09-27).
 *
 * Athi: "i switched one item to be shared on the screen and it is not appearing in the tv?" The pick had reached
 * ChitBridge; the TV put it first in the run but carried on rotating from wherever it was, so it waited for the loop.
 * This drives the real promo.html: rotate a few slides in, mark one product, re-read the shop, and the very next
 * slide must be that product. Run: node e2e/promo-pick-next.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const items = [];
for (let i = 0; i < 30; i++) items.push({ item_id: 'i' + i, name: 'Dish ' + i, price: 50 + i, mrp: i % 2 ? 90 + i : null, category: 'Food', unit: 'plate' });
let snap = () => ({ shop: { name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), items, offers: [], version: 'v' + Date.now() });

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/snapshot') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(snap())); }
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/promo.html#key=demo-key');
  await p.waitForFunction(() => typeof window.showNewPickNext === 'function' && typeof window.build === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => { API = api; KEY = 'demo-key'; }, base);

  /* a TV that has been running a while */
  /* ⚠️ PIN THE CAMPAIGN (2026-09-28). The TV picks a campaign by the HOUR ('Morning' 5–11, 'Fresh today' 6–20 …), so this
     passed at 10:00 and failed at 11:12 with one slide — the harness was testing the clock, not the pick. 'all' is what
     the television runs when nobody has chosen; the pick logic is the same under every campaign. */
  const start = await p.evaluate(async () => { CAMP = 'all'; await readShop(); SLIDES = build(); AT = 6; paint(false);
    return { n: shown().length, at: AT, kind: shown()[AT].kind }; });
  say('the TV is part-way through its run', start.at === 6 && start.n >= 7, start.n + ' slides, on ' + (start.at + 1) + ' (' + start.kind + ')');

  /* the shopkeeper switches Dish 17 onto the screen; the TV hears the bell and re-reads — the same steps its handler runs */
  items[17].screen = true;
  const after = await p.evaluate(async () => {
    var before = pickedIds(); await readShop(); SLIDES = build(); paintBar();
    var fresh = showNewPickNext(before);
    AT++; paint(false);                       /* the next 7-second tick */
    var sl = shown()[AT];
    return { fresh: fresh, kind: sl.kind, name: sl.item && sl.item.name, count: document.getElementById('count').textContent };
  });
  say('showNewPickNext names the new pick', after.fresh === 'Dish 17', String(after.fresh));
  say('⭐ the very next slide IS that product', after.kind === 'picked' && after.name === 'Dish 17', after.kind + ' · ' + after.name + ' · ' + after.count);

  /* nothing new picked: the run carries on where it was, it does not jump */
  const quiet = await p.evaluate(async () => { var was = AT; var before = pickedIds(); await readShop(); SLIDES = build();
    return { fresh: showNewPickNext(before), same: AT === was }; });
  say('a re-read with no new pick leaves the rotation alone', quiet.fresh === false && quiet.same, JSON.stringify(quiet));

  /* and REMOVING a pick takes it out of the run on the same re-read — "remove and add item as i like" */
  items[17].screen = false;
  const gone = await p.evaluate(async () => { await readShop(); SLIDES = build();
    return shown().some((s) => s.kind === 'picked' && s.item && s.item.name === 'Dish 17'); });
  say('an un-picked product leaves the screen on the next re-read', gone === false, gone ? 'still there' : 'gone');

  /* ↻ says what it read — Athi, on his phone: "it is not doing anything" */
  console.log('\n── ↻ says what it read');
  items[3].screen = true;
  await p.click('#refresh');
  await p.waitForTimeout(400);
  const msg = await p.evaluate(() => document.getElementById('hint').textContent);
  say('↻ answers in digits, and names the new pick', /^↻ \d+ on sale · 📌 1 · next: Dish 3$/.test(msg), msg);
  await p.evaluate(() => { API = 'http://127.0.0.1:1'; });            /* ChitBridge unreachable */
  await p.click('#refresh');
  await p.waitForTimeout(600);
  const off = await p.evaluate(() => document.getElementById('hint').textContent);
  say('a read that failed says so, not "done"', /Could not reach ChitBridge/.test(off), off);

  say('console/page errors', !errs.length, errs.length ? errs.join(' | ').slice(0, 200) : 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\na product switched onto the screen is shown next');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
