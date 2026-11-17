'use strict';
/**
 * tests/ord-94-96-confirm-null-line-truth.realstack.cjs — ORD-96: a storefront order whose line list holds a null line (SIT hunt night 7, n7o F4).
 *
 * Hand figures: POST /api/catalogue/:bridge/order/confirm with a valid code. A line list that is not a list of items is the buyer's mistake, so the
 * answer is a 4xx and NOTHING is written: [] / null / "abc" / {} answer 400 and [{}] 422 on main; [null] answered 500 INTERNAL (the pricing read
 * `.kind` of null). Expected: [null], [7], ["x"], [[1]] and a good line next to a null all answer 422 with the same ORDER_REJECTED code, the shop's
 * order count stays 0, and one good line (2 x 60 = 120) still places the order (200, a chit_id).
 * ORD-94 (sender sheet does not follow the receiver) and ORD-95 (withdraw after delivery) are decisions, not built here: PM/ATHI-DECISIONS.md.
 * LOCAL ONLY (api on 127.0.0.1, db the local container). Run: API_BASE=http://127.0.0.1:3207 node tests/ord-94-96-confirm-null-line-truth.realstack.cjs
 * CARD 10-online-shop-and-storefront-orders/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, CUSTOMER_OTP, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'o96' + (Date.now() % 1e10).toString(36);

(async () => {
  ok(await j('/health'), 'health');
  const pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Null line');
    const made = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const itemId = made.item.item_id, door = '/api/catalogue/' + A.bridge;
    const email = RUN + '-c@local.test';
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Null Line' } }), 'order start');
    const confirm = (line_items) => j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items } });
    const orders = async () => Number((await pg.query(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'order'`, [A.entity])).rows[0].n);
    const good = { item_id: itemId, quantity: 2 };
    const shapes = { '[null]': [null], '[7]': [7], '["x"]': ['x'], '[[1]]': [[1]], '[good, null]': [good, null], '[null, good]': [null, good] };
    for (const [name, body] of Object.entries(shapes)) {
      await kase('ORD-96 ' + name, 'a line that is not an item is refused 422 ORDER_REJECTED and writes nothing', async () => {
        const r = await confirm(body);
        expect(r.status === 422, name + ' answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 160) + ' (expected 422)');
        expect(r.b.code === 'ORDER_REJECTED', name + ' code ' + r.b.code + ' (expected ORDER_REJECTED)');
        expect(await orders() === 0, name + ' left an order behind');
      });
    }
    await kase('ORD-96 neighbours', '[] 400, [{}] 422 as before', async () => {
      const a = await confirm([]), b = await confirm([{}]);
      expect(a.status === 400 && b.status === 422, '[] ' + a.status + ' [{}] ' + b.status);
    });
    await kase('ORD-96 good order', 'one good line (2 x 60) still places the order', async () => {
      const r = await confirm([good]);
      expect(r.status === 200 && r.b.chit_id, 'good order answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 160));
      expect(await orders() === 1, 'orders ' + await orders() + ' (expected 1)');
    });
  } finally { await pg.end(); }
  finish('ord-94-96 confirm null line');
})().catch((e) => { console.error(e); process.exit(1); });
