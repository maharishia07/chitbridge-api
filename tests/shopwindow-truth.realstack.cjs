'use strict';
/**
 * tests/shopwindow-truth.realstack.cjs — SHOP WINDOW TRUTH (API part), on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §11 "Shop window").
 *
 * MKT-12, API part only (the screen walk e2e/walk-shopwindow.cjs stays open: SW-01 gallery shows · SW-10 placeholders are W cases).
 * Principles: the window shows what the shop holds (price, stock equal to the counter) · public doors obey visibility · the look is a template choice
 * the shop saves · nothing goes public until the essentials are ready · an order from the window moves no stock.
 * SW-02 price on the window = the catalogue's, after a change · SW-03 stock on the window = the Stock statement · SW-04 a connector's stamped figure vs the ledger
 * is ONE figure · SW-05 a private catalogue is refused at the public doors (browse AND order) · SW-08 the look picker refuses with what is missing ·
 * SW-09 look and ordering face are both saved, the product override wins · SW-11 an order from the window reaches the shop and moves no stock.
 * Not here: SW-06 member-store offers (✓ network-storefront.test.cjs) · SW-07 one registry flag (✓ showcase-policy.test.cjs) · SW-01/SW-10 screens.
 * A `gap:` FAIL is a RECORDED finding (MARKETING-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one and went red.
 * Run: node tests/shopwindow-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 11-crm-and-marketing/showcase
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, CUSTOMER_OTP, j, ok, pause, kase, expect, near, receipt, bill, freshShop, finish } = H;
const RUN = 'sw' + (Date.now() % 1e10).toString(36);
let pg = null;
const view = async (shop) => ok(await j('/api/catalogue/' + shop.bridge), 'public view').b;
const shown = (v, id) => (v.items || []).find((i) => i.item_id === id);
const stmtQty = async (shop, id) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[id]; return b ? b.qty : null; };
const moves = async (shop, id) => (await pg.query('SELECT COUNT(*)::int AS n FROM stock_movement WHERE entity_id = $1 AND item_id = $2', [shop.entity, id])).rows[0].n;
const policy = async (shop, body) => j('/api/entities/policy', { method: 'PATCH', token: shop.token, body });

(async () => {
  console.log('\n── shop window truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    /* SW-08 first: a shop with nothing priced yet */
    const E = await freshShop(RUN + 'e', 'Window empty');
    await kase('SW-08', 'with no priced item the look picker refuses and names what is missing (not a silent 200)', async () => {
      const r = await policy(E, { showcase_template: 'showcase.designer.gallery@1.0' });
      expect(r.status >= 400 && /item|price|product/i.test(r.b.message || ''), 'picker answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 160) + ' for a shop with 0 products');
    }, 'W26: the picker is not gated; a shop with no priced item can choose a look (no ✓/✗ checklist from the server)');

    const A = await freshShop(RUN + 'a', 'Window shop');
    const made = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: made.item.item_id, name: 'Rice', unit: 'piece', price: 60 };
    ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: receipt(RUN + '-G', [[P, 20, 40]]) }), 'receipt'); await pause(1500);
    ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-b', [[P, 2]]) }), 'sale'); await pause(1500);

    await kase('SW-02', 'the window shows the catalogue price, and follows a price change (60 → 75)', async () => {
      const before = shown(await view(A), P.id), was = before && before.item_data.price && before.item_data.price.amount;
      ok(await j('/api/products/' + P.id, { method: 'PATCH', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 75 } } }), 'change price');
      const now = shown(await view(A), P.id), got = now && now.item_data.price && now.item_data.price.amount;
      expect(was === 60 && got === 75, 'window price before ' + was + ' · after the change ' + got);
    });
    await kase('SW-03', 'the stock on the window is the Stock statement\'s figure (20 received − 2 sold = 18)', async () => {
      const s = shown(await view(A), P.id), qty = s && s.item_data.avail && s.item_data.avail.qty, st = await stmtQty(A, P.id);
      expect(near(qty, 18) && near(st, 18) && s.item_data.avail.source === 'ledger', 'window ' + JSON.stringify(s && s.item_data.avail) + ' · statement ' + st);
    });

    /* SW-11 an order from the window reaches the shop and moves no stock */
    const door = '/api/catalogue/' + A.bridge, email = RUN + '-c@local.test', movesBefore = await moves(A, P.id);
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Window Shopper' } }), 'order start');
    const order = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 3 }] } }), 'order confirm').b;
    await pause(1200);
    await kase('SW-11', 'an order from the window is a chit the shop can read, and moves no stock', async () => {
      const c = await j('/api/chits/' + order.chit_id, { token: A.token });
      expect(c.status === 200 && JSON.stringify(c.b).includes('Window Shopper') && await moves(A, P.id) === movesBefore && near(await stmtQty(A, P.id), 18), 'read ' + c.status + ' · movements ' + movesBefore + ' → ' + await moves(A, P.id) + ' · on hand ' + await stmtQty(A, P.id));
    });

    await kase('SW-09a', 'the chosen look is saved (a registered template), and a junk look is refused with a sentence', async () => {
      const good = await policy(A, { showcase_template: 'showcase.designer.gallery@1.0' }), junk = await policy(A, { showcase_template: 'showcase.x.y@1.0' });
      const v = await view(A);
      expect(good.status === 200 && v.shop.showcase.template === 'showcase.designer.gallery@1.0' && junk.status === 400 && /invalid|unknown/i.test(junk.b.message || ''), 'good ' + good.status + ' · window template ' + JSON.stringify(v.shop.showcase) + ' · junk ' + junk.status + ' ' + JSON.stringify(junk.b).slice(0, 100));
    });
    await kase('SW-09b', 'the ordering face is its own saved choice, separate from the look (a policy flag for it exists)', async () => {
      const flags = Object.keys(ok(await j('/api/entities/policy', { token: A.token }), 'policy').b.flags);
      expect(flags.some((f) => /order.*(face|look|template|design)|(face|look).*order/i.test(f)), 'policy flags with showcase/order in the name: ' + flags.filter((f) => /showcase|order/i.test(f)).join(', '));
    }, 'W23/W25: the look is a flag; the ordering face is not saved by the server yet');

    /* SW-04: a connector owns stock → its stamped figure vs the ledger */
    const C = await freshShop(RUN + 'c', 'Window connector');
    const cm = ok(await j('/api/products', { method: 'POST', token: C.token, body: { item_data: { name: 'Dal', unit: 'piece', price: 80 } } }), 'product').b, D = { id: cm.item.item_id, name: 'Dal', unit: 'piece', price: 80 };
    ok(await j('/api/chits/send', { method: 'POST', token: C.token, body: receipt(RUN + '-CG', [[D, 20, 50]]) }), 'receipt'); await pause(1500);
    const own = await policy(C, { stream_owner: { stock: 'connector:truth' } });
    ok(await j('/api/products/' + D.id + '/availability', { method: 'PUT', token: C.token, body: { qty: 50, source: 'connector' } }), 'stamp');
    ok(await j('/api/chits/send', { method: 'POST', token: C.token, body: bill(RUN + '-cb', [[D, 2]]) }), 'sale'); await pause(1500);
    await kase('SW-04', 'a connector stamps 50 and the counter sells 2: the window and the Stock screen show ONE figure', async () => {
      const s = shown(await view(C), D.id), win = s && s.item_data.avail && s.item_data.avail.qty, st = await stmtQty(C, D.id);
      expect(own.status === 200 && near(win, st), 'stream_owner ' + own.status + ' · window ' + win + ' (' + (s && s.item_data.avail && s.item_data.avail.source) + ') · statement ' + st);
    }, 'ST-28 (availability.js:62): the connector figure wins on the window and the sale does not move it; the statement moves');

    /* SW-05: a private catalogue at the public doors */
    const Q = await freshShop(RUN + 'q', 'Window private');
    const qm = ok(await j('/api/products', { method: 'POST', token: Q.token, body: { item_data: { name: 'Oil', unit: 'piece', price: 90 } } }), 'product').b;
    ok(await j('/api/entities/profile', { method: 'PATCH', token: Q.token, body: { catalogue_visibility: 'private' } }), 'private');
    const qdoor = '/api/catalogue/' + Q.bridge, qmail = RUN + '-q@local.test';
    await kase('SW-05a', 'a private catalogue is refused at the browse door (404 "Shop not found")', async () => {
      const r = await j(qdoor); expect(r.status === 404 && !JSON.stringify(r.b).includes('Oil'), 'browse ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 100));
    });
    await kase('SW-05b', 'and at the ORDER door: a stranger cannot place an order with a private shop', async () => {
      await j(qdoor + '/order/start', { method: 'POST', body: { email: qmail, name: 'Stranger' } });
      const r = await j(qdoor + '/order/confirm', { method: 'POST', body: { email: qmail, otp: CUSTOMER_OTP, line_items: [{ item_id: qm.item.item_id, quantity: 1 }] } });
      expect(r.status >= 400, 'order/confirm on a private shop answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 80) + ' — the order was placed');
    }, 'the order doors (start, confirm, capture-fields, support/preview) do not check catalogue_visibility; only the browse door does');
  } finally { await pg.end(); }
  finish('shopwindow-truth', process.env.SHOPWINDOW_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('shop window truth could not run:', e && e.message); process.exit(2); });
