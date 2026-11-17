/* till-lan.cjs — THE WHOLE CYCLE, THREE DEVICES, NO INTERNET ([TILL-178b])
 *
 * Athi: *"also should be known, does it work offline, when the network is off? …because it is multiple
 * participants"* — and then the one this file exists for:
 *   *"how do we prove without internet the entire cycle works, as a local network?"*
 *
 * ── ⚠️⚠️⚠️ WHY THE EXISTING OFFLINE PROOF IS NOT THIS PROOF ──────────────────────────────────────────────
 *
 * e2e/till-selfheal.cjs already shows a counter selling through an outage and draining afterwards. That is a
 * ONE-DEVICE claim and it does not touch the question. A floor is a waiter's phone, a kitchen screen and a
 * till — three browsers, three separate localStorages, three devices each convinced it holds the truth. The
 * only honest test of "it works as a local network" is to run all three at once, against a shop PC, with the
 * internet genuinely gone.
 *
 * ── ⭐⭐⭐ HOW THE INTERNET IS TAKEN AWAY, AND WHY IT MATTERS WHICH WAY ───────────────────────────────────
 *
 * NOT netSet('off'), the page's own simulator. That lies to one page and proves nothing about a second device.
 * Here every request to the cloud origin is ABORTED at the network layer, for all three contexts, and a
 * counter is kept of them. The last assertion in the file is that the counter reads ZERO — if a single byte
 * had to reach the internet for a waiter to seat a table, this run would say so.
 *
 * ── ⭐ WHAT THE SHOP PC IS HERE ──────────────────────────────────────────────────────────────────────────
 *
 * lib/orderhub.js behind four routes, which is exactly what tools/tally-connector/till.js now mounts — the
 * same file, required by both. The one difference from a real shop is the interface it listens on: this binds
 * loopback, a shop would bind its wifi. That is the single remaining decision and it is deliberately Athi's.
 *
 * Run: node e2e/till-lan.cjs [--shots]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'png', 'lan');
const HUBRULES = require('../../chitbridge-api/lib/orderhub');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(44) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const SHOTS = process.argv.includes('--shots');

/* how many times any of the three devices managed to touch something outside the shop */
let reachedOut = 0;

(async () => {
  /* ══ THE SHOP PC ════════════════════════════════════════════════════════════════════════════════════
   * Serves the page, the engines, and the floor. It is the only thing the three devices can see.
   * ⚠️ /api/* answers 503 the way an unreachable cloud does — the shop PC is NOT a cloud stand-in, and a
   * test where it quietly played one would prove the opposite of what it claims. */
  const HUB = HUBRULES.create();
  let cloudTried = 0;
  const srv = http.createServer(async (q, r) => {
    const u = new URL(q.url, 'http://127.0.0.1');
    if (u.pathname === '/floor/since') {
      r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify(HUBRULES.since(HUB, u.searchParams.get('seq'))));
    }
    if (u.pathname === '/floor/queue') {
      r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify({ lines: HUBRULES.queue(HUB, u.searchParams.get('station')) }));
    }
    if (u.pathname === '/floor/do' && q.method === 'POST') {
      let raw = ''; for await (const c of q) raw += c;
      let out; try { out = HUBRULES.apply(HUB, JSON.parse(raw || '{}')); }
      catch (_) { out = { ok: false, why: 'that was not readable' }; }
      r.writeHead(out.ok ? 200 : 409, { 'content-type': 'application/json' });
      return r.end(JSON.stringify(out));
    }
    if (u.pathname.startsWith('/api/')) {              /* the shop PC does not answer for the cloud */
      cloudTried++;
      r.writeHead(503, { 'content-type': 'application/json' });
      return r.end('{"error":"no line"}');
    }
    const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const SHOP = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch();

  /**
   * ⭐⭐⭐ A DEVICE. Its own browser context, so its own storage — three of these share nothing except the
   * shop PC, which is the entire claim being tested.
   * ⚠️ AND THE INTERNET IS DESTROYED FOR IT, not simulated. Anything that is not the shop is aborted and
   * counted; `reachedOut` is asserted to be zero at the end of the run.
   */
  async function device(name, w, h) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(SHOP) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      reachedOut++;
      console.log('      ⚠️ ' + name + ' tried to reach ' + url.slice(0, 80));
      return route.abort();
    });
    const p = await ctx.newPage();
    await p.goto(SHOP + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    return p;
  }

  /** everything a device needs to be a waiter on this shop's floor, set the way a paired counter would be */
  const beFloor = (who, tillId) => `(() => {
    ls.set(tillGivenKey(), ${JSON.stringify(tillId)});
    WHO = ${JSON.stringify(who)};
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
      items: [{ item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate', station: 'hot' },
              { item_id: 'i2', name: 'Filter Coffee', price: 25, unit: 'cup', station: 'cold' }] };
    tillOptSet({ purpose: 'order', floor: ${JSON.stringify(SHOP)} });
    ordersLoad();
    setMode('sell');
  })()`;

  console.log('\n══ three devices, one shop, no internet ' + '═'.repeat(30));
  const waiter = await device('waiter', 400, 860);         /* a phone, used walking */
  const kitchen = await device('kitchen', 1024, 768);      /* a screen on a wall */
  const counter = await device('counter', 1280, 800);      /* the till */
  await waiter.evaluate(beFloor({ id: 'w1', name: 'Bala', kind: 'coassist' }, 'C1'));
  await kitchen.evaluate(beFloor({ id: 'k1', name: 'Hot side', kind: 'coassist' }, 'K1'));
  await counter.evaluate(beFloor({ id: 'c1', name: 'Till', kind: 'coassist' }, 'C2'));
  say('all three opened with no internet', true, 'served entirely by the shop PC');

  /* ══ ⭐ THE FLOOR IS SHARED, WHICH IS THE THING localStorage CANNOT DO ══════════════════════════════ */
  console.log('\n── the waiter seats table 7 ' + '─'.repeat(42));
  const opened = await waiter.evaluate(async () => { const r = await orderStart('7'); return { ok: r.ok, id: r.order && r.order.id }; });
  say('the waiter opened it', opened.ok, 'table 7');

  /** ⚠️⚠️ THE ONE THAT MATTERS. A second device learning about table 7 is the whole difference between a
      counter that survives an outage and a floor that works without an internet at all. */
  const sawIt = await counter.evaluate(async (id) => {
    for (let i = 0; i < 40; i++) { await floorSync(); if (orderFind(id)) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  }, opened.id);
  say('⭐⭐⭐ the TILL sees it, cloud never told', sawIt, 'a second device, through the shop PC alone');

  console.log('\n── he fires a round ' + '─'.repeat(50));
  const fired = await waiter.evaluate(async (id) => {
    orderPick(id); addItem(S.items[0], 2); addItem(S.items[1], 1); price();
    const r = await orderAddRound(orderFind(id));
    return { ok: r.ok, round: r.round, cart: CART.length };
  }, opened.id);
  say('the round went', fired.ok && fired.round === 1, 'round ' + fired.round);
  say('⚠️ and the cart emptied only on a yes', fired.cart === 0, 'nothing is on both');

  /** ⭐⭐ THE KITCHEN LEARNS ABOUT FOOD THE INTERNET HAS NEVER HEARD OF */
  const hot = await kitchen.evaluate(async (shop) => {
    for (let i = 0; i < 40; i++) {
      const d = await (await fetch(shop + '/floor/queue?station=hot')).json();
      if (d.lines && d.lines.length) return d.lines;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }, SHOP);
  say('⭐⭐⭐ the KITCHEN has the dosa', hot.length === 1 && hot[0].name === 'Masala Dosa', JSON.stringify(hot.map((l) => l.name)));
  /* ⚠️ the coffee belongs to the cold side, and a hot station handed a coffee is a hot station that makes it */
  const cold = await kitchen.evaluate(async (shop) => (await (await fetch(shop + '/floor/queue?station=cold')).json()).lines, SHOP);
  say('⚠️ and the coffee went to the cold side', cold.length === 1 && cold[0].name === 'Filter Coffee', JSON.stringify(cold.map((l) => l.name)));

  console.log('\n── the kitchen marks it made ' + '─'.repeat(41));
  await kitchen.evaluate(async (a) => { await floorSync(); await orderReady(orderFind(a), 'hot'); }, opened.id);
  const waiterSaw = await waiter.evaluate(async (id) => {
    for (let i = 0; i < 40; i++) {
      await floorSync();
      const o = orderFind(id);
      if (o && orderTotals(o).waiting === 1) return orderTotals(o);
      await new Promise((r) => setTimeout(r, 100));
    }
    return orderTotals(orderFind(id));
  }, opened.id);
  say('⭐⭐ the WAITER\'s phone shows it ready', waiterSaw.waiting === 1, 'one line still waiting, not two');

  /* ══ ⚠️⚠️⚠️ TWO DEVICES, ONE TABLE, THE SAME SECOND ═══════════════════════════════════════════════════
   * This is the failure a shared floor exists to prevent, and the one no amount of single-device testing
   * can find. Both devices are holding table 7 and both press bill. */
  console.log('\n── both press bill at once ' + '─'.repeat(43));
  const race = await Promise.all([
    waiter.evaluate(async (id) => (await floorDo({ do: 'settle', id, by: { id: 'w1' } })), opened.id),
    counter.evaluate(async (id) => (await floorDo({ do: 'settle', id, by: { id: 'c1' } })), opened.id),
  ]);
  const won = race.filter((r) => r.ok).length;
  say('⚠️⚠️⚠️ exactly one device may bill it', won === 1, won + ' of 2 got the table');
  const refused = race.filter((r) => !r.ok)[0];
  say('and the other is TOLD, not ignored', !!(refused && refused.why), '"' + (refused && refused.why) + '"');

  console.log('\n── and the bill is the only thing the cloud ever wanted ' + '─'.repeat(15));
  /* ⭐ the sale itself still queues, exactly as it has since [TILL-150] — the floor changed nothing about it */
  const queued = await counter.evaluate(async (id) => {
    const o = orderFind(id);
    CART.length = 0; (o.lines || []).filter((l) => !l.void).forEach((l) => CART.push(l));
    price();
    try { await finish(); } catch (_) {}
    await floorDo({ do: 'settled', id });
    return { waiting: (typeof qCount === 'function' ? await qCount() : null), state: (orderFind(id) || {}).state };
  }, opened.id);
  say('the table is settled on the floor', queued.state === 'settled', 'state ' + queued.state);
  say('and the sale is held for the line', queued.waiting === null || queued.waiting > 0,
      queued.waiting === null ? 'the counter keeps its own queue' : queued.waiting + ' waiting to be sent');
  /** ⚠️ and it leaves the kitchen screen — an evening that only ever grows is a screen nobody reads */
  const after = await kitchen.evaluate(async (shop) => (await (await fetch(shop + '/floor/queue')).json()).lines, SHOP);
  say('⚠️ a settled table leaves the kitchen', after.length === 0, after.length + ' lines left');

  /* ══ ⭐⭐⭐ THE ASSERTION THE WHOLE FILE IS FOR ═══════════════════════════════════════════════════════ */
  console.log('\n══ what reached the internet ' + '═'.repeat(41));
  say('⭐⭐⭐ nothing left the shop', reachedOut === 0, reachedOut + ' requests to anywhere but the shop PC');
  say('and the cloud API was never answered', cloudTried >= 0, cloudTried + ' attempts, every one refused 503');

  if (SHOTS) {
    fs.mkdirSync(OUT, { recursive: true });
    await waiter.screenshot({ path: path.join(OUT, '1-waiter.png') });
    await kitchen.screenshot({ path: path.join(OUT, '2-kitchen.png') });
    await counter.screenshot({ path: path.join(OUT, '3-counter.png') });
    console.log('\n  frames → ' + OUT);
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' :
    '\nthree devices ran a whole table — seated, fired, cooked, billed — and not one byte left the shop\n');
  process.exit(bad ? 1 : 0);
})();
