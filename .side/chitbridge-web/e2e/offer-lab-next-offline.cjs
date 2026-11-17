/* offer-lab-next-offline.cjs — MUST WORK OFFLINE TOO (Athi's own words)
 *
 * Offer Lab reads a shopkeeper's own catalogue and cost figures when signed in — this proves the offline half
 * of that: a successful read is cached (its own IndexedDB, offerlab — NOT till.html's, which is keyed per
 * paired counter, a different identity), a later read with no line falls back to that cache and says so, a
 * cost edit made with no line queues rather than silently failing or throwing, and the queue drains once the
 * line returns.
 *
 * Run: node e2e/offer-lab-next-offline.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(48) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const PRODUCTS = [
  { item_id: 'p1', item_data: { name: 'Masala Dosa', price: 70, categories: ['tiffin'], cost: { value: 38, source: 'manual' } } },
  { item_id: 'p2', item_data: { name: 'Filter Coffee', price: 20, categories: ['drinks'] } },   /* no cost — unknown, never zero */
];

(async () => {
  let reachable = true, patchedCost = null;
  const srv = http.createServer((q, r) => {
    const url = new URL(q.url, 'http://x');
    if (url.pathname === '/api/products' && q.method === 'GET') {
      if (!reachable) { r.destroy(); return; }
      r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify({ items: PRODUCTS }));
    }
    if (url.pathname.startsWith('/api/products/') && q.method === 'PATCH') {
      if (!reachable) { r.destroy(); return; }
      let body = ''; q.on('data', (c) => (body += c));
      q.on('end', () => { patchedCost = JSON.parse(body); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"message":"Product updated"}'); });
      return;
    }
    if (url.pathname === '/api/definitions') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"definitions":[],"count":0}'); }
    const f = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext();   /* one context throughout — IndexedDB is the point */
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  console.log('\n── signed in, online: reads the real catalogue and caches it ' + '─'.repeat(1));
  await p.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
  await p.evaluate(() => localStorage.setItem('cb_sess', JSON.stringify({ token: 'demo-token', entity: 'Mayur Bhavan' })));
  const first = await p.evaluate(async () => {
    const ok = await labUseMine();
    await new Promise((r) => setTimeout(r, 100));
    return { ok, biz: S.biz, items: P.length, cost0: P[0].cost, cost1: P[1].cost, cached: !!(await LabDB.get('catalogue')) };
  });
  say('the real catalogue loads', first.ok && first.biz === 'mine' && first.items === 2, JSON.stringify(first));
  say('cost rides in from item_data.cost (lib/item-cost.js\'s shape)', first.cost0 === 38, 'Masala Dosa cost=' + first.cost0);
  say('⚠️ no cost is unknown, never zero', first.cost1 === null, 'Filter Coffee cost=' + first.cost1);
  say('and it was cached for later', first.cached, 'IndexedDB now holds a copy');

  console.log('\n── the line goes: a fresh load falls back to the cache, and says so ' + '─'.repeat(0));
  reachable = false;
  await p.reload();
  await p.waitForTimeout(300);
  const cached = await p.evaluate(() => ({ biz: S.biz, items: P.length, toast: (document.getElementById('labtoast') || {}).textContent }));
  say('still shows the real numbers, not the samples', cached.biz === 'mine' && cached.items === 2, JSON.stringify(cached));
  say('and says plainly that it is behind', /offline|cached/i.test(cached.toast || ''), '"' + cached.toast + '"');

  console.log('\n── ⭐⭐⭐ editing a cost with no line queues it, rather than failing silently ' + '─'.repeat(0));
  const queued = await p.evaluate(async () => {
    setCost('p1', '41');
    await new Promise((r) => setTimeout(r, 150));
    const rows = await LabDB.queueAll();
    return { costOnScreen: byId('p1').cost, queueLen: rows.length, queueKind: rows[0] && rows[0].kind };
  });
  say('the screen updates immediately regardless of the line', queued.costOnScreen === 41, 'shows 41 right away');
  say('and the write is held, not lost', queued.queueLen === 1 && queued.queueKind === 'cost', JSON.stringify(queued));

  console.log('\n── the line returns: the queued cost actually reaches the server ' + '─'.repeat(0));
  reachable = true;
  await p.evaluate(async () => { await labDrainOutbox(); await new Promise((r) => setTimeout(r, 150)); });
  const drained = await p.evaluate(async () => ({ queueLen: (await LabDB.queueAll()).length }));
  say('the outbox empties', drained.queueLen === 0, drained.queueLen + ' left');
  say('and the server actually received it', patchedCost && patchedCost.merge === true && patchedCost.item_data.cost.value === 41,
      JSON.stringify(patchedCost));

  console.log('\n── not signed in at all: no network call is even attempted ' + '─'.repeat(3));
  await p.evaluate(() => localStorage.removeItem('cb_sess'));
  await p.reload();
  const anon = await p.evaluate(async () => {
    const ok = await labUseMine(true);
    return { ok, biz: S.biz };
  });
  say('refuses politely, stays on the samples', anon.ok === false && anon.biz === 'hotel', JSON.stringify(anon));

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nthe line can go down and Offer Lab keeps its own numbers, not a blank screen');
  process.exit(bad || errs.length ? 1 : 0);
})();
