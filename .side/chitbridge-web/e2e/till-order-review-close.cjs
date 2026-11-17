/* till-order-review-close.cjs — ADD WORKED, REVIEW AND CLOSE DID NOT ([TILL-187])
 *
 * Athi: *"in the table option, i could add item to the tables, but not able to review or close the table."*
 *
 * ⚠️⚠️⚠️ THE BUG WAS TWO SYSTEMS THAT NEVER MET. orderPick + the product grid put items in CART, which is
 * real — but "Kitchen · F3" only stamped the cart line and printed a slip; it never told the ORDER object
 * (the thing orderTotals/canSettle/orderSettle/the floor all read). And no button anywhere called
 * orderSettle. A waiter could add all evening and there was never a way to see the running total or bill it.
 *
 * This drives the real controls a waiter would press — the tile, the round button, the review sheet, the
 * bill button — not the engine functions directly, because the engine was already proven correct in
 * till-orderpad.cjs and the thing that was actually missing was the wiring between it and the screen.
 *
 * Run: node e2e/till-order-review-close.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(40) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  /* ⚠️ NOT PHONE WIDTH — on the "pay as a card" layout #obar (and everything on it) is deliberately hidden
     until the pay card is open ([TILL-60]/[TILL-127], a separate and correct rule about the payment step,
     not something this test is about). A desktop-width counter is the ordinary case where the bar is always
     on screen, which is what this test needs to drive it. */
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
                 items: [{ item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate' },
                         { item_id: 'i2', name: 'Filter Coffee', price: 25, unit: 'cup' }],
                 suppliers: [] };   /* a CURRENT snapshot carries suppliers (FX-F10W SNAP_NEEDS) — without it the counter re-reads the shop mid-walk */
    setMode('sell');
    purposeSet('order');
  }, base);

  console.log('\n── the round button appears without turning on "send a KOT" ' + '─'.repeat(2));
  await p.fill('[data-testid="till-order-new"]', '7');
  await p.click('[data-testid="till-order-go"]');
  /* wait for the bar to paint (a slow runner is not a 150 ms one): the round button and "=" are drawn by the same repaint */
  await p.waitForSelector('[data-testid="till-kot"][aria-label]', { timeout: 10000 });
  await p.waitForSelector('[data-testid="till-order-bring"]', { timeout: 10000 });
  const bar = await p.evaluate(() => ({
    kotText: ((document.querySelector('[data-testid="till-kot"]') || {}).getAttribute && document.querySelector('[data-testid="till-kot"]').getAttribute('aria-label')) || '',   // I1: the word is the aria-label now
    kotOn: kotOn(),
    bring: !!document.querySelector('[data-testid="till-order-bring"]'),
  }));
  say('⭐ an order pad needs it on its own', /Send round/i.test(bar.kotText) && bar.kotOn === false,
      '"' + bar.kotText.trim() + '", kotOn=' + bar.kotOn);
  /* ⭐⭐⭐ Athi: "+ for adding, = for summarising and bring it to the cart… in the same table number" —
     both icons live in the SAME order bar as the table being worked on, not only on the tile in the pad list. */
  say('⭐⭐⭐ and "=" sits right beside it, on this same table', bar.bring, 'till-order-bring is on the bar');

  console.log('\n── adding to the table (this half already worked) ' + '─'.repeat(11));
  await p.evaluate(() => { addItem(S.items[0], 2); price(); });
  const added = await p.evaluate(() => ({ cart: CART.length, orderLines: (orderFind(ORDER_ID) || { lines: [] }).lines.length }));
  say('the cart takes it', added.cart === 1, added.cart + ' line in the cart');
  say('⚠️ but the ORDER never heard of it yet — the actual fault', added.orderLines === 0, added.orderLines + ' lines on the order so far');

  console.log('\n── ⭐⭐⭐ pressing the button that used to only print a slip ' + '─'.repeat(3));
  await p.click('[data-testid="till-kot"]');
  await p.waitForTimeout(150);
  const sent = await p.evaluate(() => {
    const o = orderOpen().filter((x) => x.subject === '7')[0];
    return { cart: CART.length, lines: o.lines.length, round: o.lines[0] && o.lines[0].round,
             slipOpen: document.getElementById('slipdlg').open };
  });
  say('the round reaches the order this time', sent.lines === 1 && sent.round === 1, sent.lines + ' line, round ' + sent.round);
  say('the cart is emptied into it, same as before', sent.cart === 0, 'nothing left on both');
  say('and the kitchen still gets its slip', sent.slipOpen === true, 'the KOT dialog opened');
  await p.evaluate(() => document.getElementById('slipdlg').close());

  console.log('\n── ⭐⭐ REVIEW — the half that did not exist at all ' + '─'.repeat(9));
  /* ⭐ pressed from the SAME table's own bar ("=" — Athi's own words), not the tile back in the pad list */
  await p.click('[data-testid="till-order-bring"]');
  await p.waitForTimeout(100);
  const review = await p.evaluate(() => ({
    open: document.getElementById('orderdlg').open,
    title: document.getElementById('orderdlgtitle').textContent,
    lines: document.querySelectorAll('#orderdlgbody .ordline').length,
    total: document.querySelector('#orderdlgbody .ordtotal i').textContent,
    settleDisabled: document.querySelector('[data-testid="till-order-settle"]').disabled,
    settleText: document.querySelector('[data-testid="till-order-settle"]').textContent,
  }));
  say('the sheet opens', review.open === true, 'orderdlg is open');
  say('naming the table', /7/.test(review.title), '"' + review.title + '"');
  say('showing what is actually on it', review.lines === 1, review.lines + ' line shown');
  say('with the same total the order engine computes', review.total.replace(/\s/g, '') === '140' || /140/.test(review.total),
      '"' + review.total + '" for 2 × 70');
  say('and the bill button is live', review.settleDisabled === false && /Bill this/.test(review.settleText),
      '"' + review.settleText + '"');

  console.log('\n── ⭐ AND WHAT IS STILL TYPED, NOT YET SENT, SHOWS TOO ' + '─'.repeat(6));
  await p.evaluate(() => { document.getElementById('orderdlg').close(); addItem(S.items[1], 1); price(); });
  await p.click('[data-testid="till-order-bring"]');
  await p.waitForTimeout(100);
  const withHeld = await p.evaluate(() => ({
    lines: document.querySelectorAll('#orderdlgbody .ordline').length,
    heldWord: /typed, not sent/.test(document.querySelector('#orderdlgbody .ordline.held').textContent),
    total: document.querySelector('#orderdlgbody .ordtotal i').textContent,
  }));
  say('⚠️ a typed line that was never sent still appears', withHeld.lines === 2, withHeld.lines + ' lines (1 sent + 1 typed)');
  say('and is labelled honestly', withHeld.heldWord, 'marked "typed, not sent"');
  say('the total counts it before it is even held', /165/.test(withHeld.total), '"' + withHeld.total + '" for 140 + 25');

  console.log('\n── ⭐⭐⭐ CLOSE — the other half that did not exist ' + '─'.repeat(8));
  await p.click('[data-testid="till-order-settle"]');
  await p.waitForTimeout(300);
  const closed = await p.evaluate(async () => {
    const bills = (await DB.all('bills')) || [];
    return {
      dlgOpen: document.getElementById('orderdlg').open,
      openTiles: document.querySelectorAll('[data-testid="till-order-tile"]').length,
      state: (ORDERS.filter((x) => x.subject === '7')[0] || {}).state,
      billLines: bills.length ? bills[bills.length - 1].lines.length : -1,
      billTotal: bills.length ? bills[bills.length - 1].total : -1,
      cart: CART.length,
    };
  });
  say('the sheet closes', closed.dlgOpen === false, 'orderdlg closed itself');
  say('the table leaves the open list', closed.openTiles === 0, closed.openTiles + ' tiles left');
  say('the order is settled', closed.state === 'settled', 'state is ' + closed.state);
  say('⭐ the typed-not-sent line was held and billed too, not dropped', closed.billLines === 2, closed.billLines + ' lines on the bill');
  say('for the sum the sheet promised', closed.billTotal === 165, '₹' + closed.billTotal);
  say('and the cart is clean', closed.cart === 0, 'nothing left on screen');

  console.log('\n── ⚠️⚠️ closing one table must not eat what is typed on another ' + '─'.repeat(1));
  const guard = await p.evaluate(async () => {
    await orderStart('9'); await orderStart('11');
    const nine = orderOpen().filter((x) => x.subject === '9')[0];
    const eleven = orderOpen().filter((x) => x.subject === '11')[0];
    await orderPick(eleven.id);
    addItem(S.items[1], 1); price();
    await orderAddRound(eleven);                     /* table 11 has something sent, so it CAN be settled */
    await orderPick(nine.id);
    addItem(S.items[0], 1); price();               /* typed on 9, never sent — the table now on screen */
    await orderReview(eleven.id);                    /* looking at 11 instead */
    await orderReviewSettle();                        /* and billing 11 while 9 sits typed in the cart */
    await new Promise((res) => setTimeout(res, 250));
    const nineNow = orderFind(nine.id);
    return { nineHeld: nineNow.lines.filter((l) => l.round === 0).length, nineState: nineNow.state,
             elevenGone: orderOpen().filter((x) => x.subject === '11').length === 0 };
  });
  say('table 9, untouched, is billed', guard.elevenGone, 'table 11 left the open list');
  say('⭐⭐ table 9\'s typed line survived, held rather than lost', guard.nineHeld === 1 && guard.nineState === 'open',
      'table 9 still open with ' + guard.nineHeld + ' line held');

  fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
  await p.evaluate(() => { const o = orderOpen()[0]; if (o) orderReview(o.id); });
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(__dirname, '..', 'png', 'OrderReview.png') });

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\na table can be added to, reviewed, and closed — all from the screen');
  process.exit(bad ? 1 : 0);
})();
