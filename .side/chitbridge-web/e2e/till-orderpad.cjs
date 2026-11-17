/* till-orderpad.cjs — AN ORDER HELD OPEN AGAINST A SUBJECT ([TILL-179] · [TILL-180])
 *
 * Athi: *"he has to feed table number for every order, and part order placement under the table number, so
 * multiple part orders will be there; on completion the bill to be prepared for that table number… the same
 * waiter can manage more than one table at any time."*
 *
 * ⚠️⚠️⚠️ THE FIRST THING ASSERTED IS THAT A BILLING SHOP NEVER MEETS ANY OF IT. *"Billing means the currently
 * application stays as it is"* is the requirement, not a courtesy — a veg store that reads one new word on
 * its screen means this was built wrong.
 *
 * Run: node e2e/till-orderpad.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(38) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  /* ⭐ a phone, because this screen is used walking */
  const p = await (await b.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await p.evaluate(() => {
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
                 items: [{ item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate' },
                         { item_id: 'i2', name: 'Filter Coffee', price: 25, unit: 'cup' }] };
    setMode('sell');
  });

  console.log('\n── a billing shop never meets any of it ' + '─'.repeat(19));
  const plain = await p.evaluate(() => {
    const pad = document.getElementById('orderpad');
    return { purpose: purposeNow(), open: purposeHas('open_orders'),
             size: Math.round(pad.getBoundingClientRect().height),
             word: /table|token/i.test(document.body.innerText) };
  });
  say('billing is the default', plain.purpose === 'billing' && !plain.open, 'purposeNow() is billing');
  /* ⚠️ [hidden] must win — the lesson of [TILL-148], applied before it could be repeated */
  say('the pad takes no space', plain.size === 0, 'orderpad measures ' + plain.size + 'px');
  say('and not one new word appears', plain.word === false, 'a veg store reads nothing about tables');

  console.log('\n── turned into an order pad ' + '─'.repeat(31));
  const on = await p.evaluate(() => {
    purposeSet('order');
    return { open: purposeHas('open_orders'), route: purposeHas('route_lines'),
             shown: document.getElementById('orderpad').hidden === false,
             ask: (document.querySelector('[data-testid="till-order-new"]') || {}).placeholder,
             none: (document.querySelector('[data-testid="till-order-none"]') || {}).innerText };
  });
  say('orders are held open', on.open && on.route, 'both facts are on');
  say('the pad appears', on.shown, 'it is on screen');
  say('and it asks for the subject', /Table number/i.test(on.ask || ''), '"' + on.ask + '"');
  say('with an empty state that says what to do', /Type a number/.test(on.none || ''), '"' + on.none + '"');

  /* ══ ⭐⭐ THE VOCABULARY IS A TRANSLATION, NOT A BRANCH ═══════════════════════════════════════════════ */
  console.log('\n── a sweet shop says token ' + '─'.repeat(32));
  const sweet = await p.evaluate(() => {
    tillOptSet({ words: { subject: 'token', subjects: 'tokens' } });
    paintPurpose(); paintOrders();
    return { ask: (document.querySelector('[data-testid="till-order-new"]') || {}).placeholder,
             none: (document.querySelector('[data-testid="till-order-none"]') || {}).innerText };
  });
  say('⭐ one word, no new code', /Token number/i.test(sweet.ask || ''), '"' + sweet.ask + '"');
  say('and it is the same word everywhere', /No tokens open/.test(sweet.none || ''), '"' + sweet.none + '"');
  await p.evaluate(() => { tillOptSet({ words: {} }); paintOrders(); });

  console.log('\n── many at once, which is the whole layout ' + '─'.repeat(16));
  const many = await p.evaluate(async () => {
    /* ⚠️ AWAITED SINCE [TILL-178b]. Opening a table is a round trip once a shop has a floor, so these
       return a promise now — and forEach over an async call opened three tables in an order nobody controls. */
    for (const t of ['7', '9', '12']) await orderStart(t);
    paintOrders();
    return { tiles: document.querySelectorAll('[data-testid="till-order-tile"]').length,
             open: orderOpen().length };
  });
  say('three tables open together', many.tiles === 3 && many.open === 3, many.tiles + ' tiles');
  /* ⚠️ the same subject twice is two bills for one table — the C1 failure again */
  const dupe = await p.evaluate(async () => { const a = await orderStart('7'), c = await orderStart('7');
    return { same: a.order.id === c.order.id, n: orderOpen().length }; });
  say('⚠️⚠️ the same table cannot open twice', dupe.same && dupe.n === 3, 'it returns the one already open');

  console.log('\n── part orders under one table ' + '─'.repeat(28));
  const rounds = await p.evaluate(async () => {
    const o = orderOpen().filter((x) => x.subject === '7')[0];
    await orderPick(o.id);
    addItem(S.items[0], 2); price();
    const r1 = (await orderAddRound(o)).round;
    addItem(S.items[1], 1); price();
    const r2 = (await orderAddRound(o)).round;
    const t = orderTotals(orderFind(o.id));
    return { r1, r2, lines: o.lines.length, cart: CART.length, total: t.total,
             stamped: o.lines.map((l) => l.round) };
  });
  say('a round is numbered', rounds.r1 === 1 && rounds.r2 === 2, 'round ' + rounds.r1 + ', then ' + rounds.r2);
  /* ⚠️ MY ARITHMETIC, NOT THE CODE'S: addItem(item, 2) makes ONE line of qty 2, not two lines — which the
     total of 165 already proves. The first draft expected [1,1,2] and was simply wrong. */
  say('and every line carries its round', JSON.stringify(rounds.stamped) === '[1,2]', JSON.stringify(rounds.stamped));
  /* ⚠️ a line on the cart AND the order is a line billed twice */
  say('⚠️ the cart is emptied into it', rounds.cart === 0, 'nothing is on both');
  say('the order adds up', rounds.total === 165, '2 dosa + 1 coffee = ' + rounds.total);

  /* ══ ⚠️⚠️ WALKING AWAY MID-ORDER MUST NOT PUT A DOSA ON ANOTHER TABLE'S BILL ═════════════════════════ */
  console.log('\n── walking to another table ' + '─'.repeat(31));
  const walk = await p.evaluate(async () => {
    const seven = orderOpen().filter((x) => x.subject === '7')[0];
    await orderPick(seven.id);
    addItem(S.items[0], 1); price();          /* typed, not sent */
    const nine = orderOpen().filter((x) => x.subject === '9')[0];
    await orderPick(nine.id);                  /* he walks away mid-order */
    /* ⚠️ RE-READ AFTER THE HOLD. The hub answers with the order, and the copy captured before the walk
       is by then a device's stale picture — which is the very fault this whole seam exists to prevent. */
    const s7 = orderFind(seven.id), n9 = orderFind(nine.id);
    return { cart: CART.length, sevenLines: s7.lines.length,
             held: s7.lines.filter((l) => l.round === 0).length,
             nineLines: n9.lines.length };
  });
  say('⚠️⚠️ the typed line stays with its own table', walk.held === 1 && walk.nineLines === 0,
      'held on 7, and table 9 has ' + walk.nineLines + ' lines');
  say('and the cart is clean for the new one', walk.cart === 0, 'nothing carried across');
  /* ⭐ held is not sent — it must not have gone to the kitchen */
  say('⭐ held is not fired', walk.held === 1 && walk.sevenLines === 3, 'round 0 means typed, never sent');

  fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
  /* ⭐ with tables open and one being served — the state a waiter actually sees */
  await p.evaluate(async () => { const o = orderOpen()[0]; if (o) await orderPick(o.id); paintOrders(); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(__dirname, '..', 'png', 'OrderPad.png') });

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe pad holds many orders open, and a billing shop never sees it');
  process.exit(bad ? 1 : 0);
})();
