'use strict';
/**
 * tests/orders-truth.realstack.cjs — ORDERS TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §8 "Orders / workflow").
 *
 * TB-SELL-7 / ORD-3. An order is a promise: OR-01 moves no stock · OR-02 an open order HOLDS its stock (committed / available) · OR-03 a cancelled order
 * releases it · OR-04 an open order is on the despatch list, and a despatched one is not · OR-08 the typed name is the party · OR-10 a despatch note
 * sent twice takes the stock out once · OR-04c an order a counter bill names (order.from) is not open · OR-05 Home's Orders card and the till list say one number. A `gap:` FAIL is a RECORDED finding (ORDERS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/orders-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 02-tasks-orders-and-workflow/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, CUSTOMER_OTP, j, ok, pause, kase, expect, near, line, receipt, bill, freshShop, finish } = H;
const RUN = 'or' + (Date.now() % 1e10).toString(36);
let pg = null;
const sendAs = async (shop, body, what) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), what).b;
const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const stmt = async (shop) => ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b;
const onHand = async (shop, item) => { const b = (await stmt(shop)).balances[item]; return b ? b.qty : null; };
async function settle(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await movesOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }
const despatch = (no, orderId, p, qty) => ({ recipients: [{ self: true, name: 'self' }], purpose: 'delivery_note', subject: 'Despatch ' + no, manual_subject: 'Despatch ' + no, client_ref: no,
  business_json: { doc: 'despatch', doc_no: no, doc_at: new Date().toISOString(), against: { chit_id: orderId } }, line_items: [Object.assign(line(p, qty, p.unit, p.price), { item_data: { item_id: p.id } })] });
const tasksJson = async (shop) => JSON.stringify(ok(await j('/api/till/tasks?kind=despatch', { token: shop.token }), 'tasks').b);

(async () => {
  console.log('\n── orders truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Orders truth');
    const r = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: r.item.item_id, name: 'Rice', unit: 'piece', price: 60 };
    await sendAs(A, receipt(RUN + '-G', [[P, 20, 40]]), 'receipt'); await settle(A, P.id, 1);
    const door = '/api/catalogue/' + A.bridge, email = RUN + '-c@local.test';
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Truth Typed Name' } }), 'order start');
    const order = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 2 }] } }), 'order confirm').b;
    const id = order.chit_id; await pause(800);
    await kase('OR-01', 'an online order for 2 moves no stock row and leaves the shelf unchanged', async () => {
      expect((await movesOf(A, P.id)).length === 1 && near(await onHand(A, P.id), 20), 'movements ' + (await movesOf(A, P.id)).length + ' · on hand ' + await onHand(A, P.id));
    });
    await kase('OR-02', 'the statement shows the open order as committed 2, available 18', async () => {
      const b = (await stmt(A)).balances[P.id] || {};
      expect(near(b.committed, 2) && near(b.available, 18), 'row ' + JSON.stringify(b));
    }, 'reservations not built (INVENTORY-LIFECYCLE 2.6; ST-09)');
    await kase('OR-04a', 'an open order is on the despatch list', async () => { expect((await tasksJson(A)).includes(id), 'order ' + id + ' not in the despatch list'); });
    await kase('OR-08', 'the order carries the name the shopper typed, not the e-mail', async () => {
      const c = ok(await j('/api/chits/' + id, { token: A.token }), 'read order').b;
      expect(JSON.stringify(c).includes('Truth Typed Name'), 'typed name missing from the order the shop reads');
    });
    await kase('OR-10', 'a despatch note for 2 sent twice takes the stock out once', async () => {
      const dn = despatch(RUN + '-DN', id, P, 2);
      await sendAs(A, dn, 'despatch'); await settle(A, P.id, 2);
      await j('/api/chits/send', { method: 'POST', token: A.token, body: dn }); await pause(1000);
      const m = await movesOf(A, P.id);
      expect(m.length === 2 && near(await onHand(A, P.id), 18), 'movements ' + m.map((x) => x.reason + ' ' + x.qty).join(', ') + ' · on hand ' + await onHand(A, P.id) + ' (expected 18)');
    });
    await kase('OR-04b', 'a despatched order is no longer on the despatch list', async () => { expect(!(await tasksJson(A)).includes(id), 'order ' + id + ' still listed after the despatch note'); });
    /* a second order, to cancel */
    const email2 = RUN + '-d@local.test';
    ok(await j(door + '/order/start', { method: 'POST', body: { email: email2, name: 'Cancel Me' } }), 'order 2 start');
    const o2 = ok(await j(door + '/order/confirm', { method: 'POST', body: { email: email2, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 3 }] } }), 'order 2 confirm').b;
    await pause(800);
    await kase('OR-03', 'cancelling an open order releases what it held (committed back to 0)', async () => {
      ok(await j('/api/chits/' + o2.chit_id + '/status', { method: 'PUT', token: A.token, body: { status: 'cancelled', note: 'orders truth' } }), 'cancel');
      await pause(800);
      const b = (await stmt(A)).balances[P.id] || {};
      expect(b.committed != null && near(b.committed, 0) && !(await tasksJson(A)).includes(o2.chit_id), 'row ' + JSON.stringify(b) + ' · still on the list: ' + (await tasksJson(A)).includes(o2.chit_id));
    }, 'reservations not built (INVENTORY-LIFECYCLE 2.6; ST-33)');
    /* a third order, left open: the Home card and the till list must agree on it (OR-05), then a bill against it closes it (OR-04c) */
    const email3 = RUN + '-e@local.test';
    ok(await j(door + '/order/start', { method: 'POST', body: { email: email3, name: 'Bill Me' } }), 'order 3 start');
    const o3 = ok(await j(door + '/order/confirm', { method: 'POST', body: { email: email3, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 1 }] } }), 'order 3 confirm').b;
    await pause(800);
    const homeOpen = async () => ok(await j('/api/facts/orders', { token: A.token }), 'home orders card').b.figures.open;
    const tillOpen = async () => ok(await j('/api/till/tasks?kind=despatch', { token: A.token }), 'till tasks').b.count;
    await kase('OR-05a', 'with one order open, the Home Orders card and the till list both say 1 (one helper)', async () => {
      const h = await homeOpen(), t = await tillOpen();
      expect(h === 1 && t === 1 && (await tasksJson(A)).includes(o3.chit_id), 'home ' + h + ' · till ' + t + ' (expected 1 and 1, the third order listed)');
    });
    await kase('OR-04c', 'an order a counter bill names (order.from) is not open', async () => {
      const b = bill(RUN + '-BO', [[P, 1]]); b.business_json.order = { from: o3.chit_id };
      await sendAs(A, b, 'bill against the order'); await settle(A, P.id, 3);
      expect(!(await tasksJson(A)).includes(o3.chit_id), 'order ' + o3.chit_id + ' still listed after a bill that names it');
    });
    await kase('OR-05b', 'once the bill closes it, the Home card and the till list both say 0', async () => {
      const h = await homeOpen(), t = await tillOpen();
      expect(h === 0 && t === 0, 'home ' + h + ' · till ' + t + ' (expected 0 and 0)');
    });
  } finally { await pg.end(); }
  finish('orders-truth', process.env.ORDERS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('orders truth could not run:', e && e.message); process.exit(2); });
