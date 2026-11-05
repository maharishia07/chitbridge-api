'use strict';
/**
 * tests/books-confirm-replay-truth.realstack.cjs — FIN-63 step 2 on REAL Postgres: a repeated confirm posts ONCE (POST /api/books/payments/:id/confirm).
 *
 * owns: the concurrent proof that the stand-in cannot give (it has no locks of its own): the C3 advisory lock serialises two confirms of one payment,
 *       and the one that takes the lock second reads the first as the payment's latest batch and answers duplicate: true.
 * FLOW  fresh shop, books on, one buyer on the rail with a bill of 30000 open → a payment of 30000 on account → confirms through the route, each its own
 *       Idempotency-Key (the harness j()) → the rows read back from party_item (SELECT only).
 *   RP-1  two confirms at once with the same pairs and two keys → 200 + 200, exactly one carries duplicate: true, ONE batch of 2 rows on the ledger
 *   RP-2  start-earlier-waits: another transaction holds the party's lock, two confirms start and WAIT, the lock is released → the first to take it posts,
 *         the second answers duplicate: true with the same figures; still ONE batch of 2 rows
 *   RP-3  a different allocation is a further one: [A 3000] posts, and the first pair again is NOT the latest batch, so it posts too (6 rows in all)
 * CARD 16-finance/collections
 * Run: node tests/books-confirm-replay-truth.realstack.cjs   ⚠️ LOCAL ONLY (the harness refuses anything else); writes go through the routes, the database is only SELECTed
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const R = require('./lib/rail-buyer.cjs');
const { LOCK_SQL } = require('../lib/xact-lock');
const { DB, j, ok, kase, pause, expect, freshShop, finish } = H;

const RUN = 'rp' + (Date.now() % 1e10).toString(36);
const NOT_REGISTERED = { tax: { registered: false } };
const BILLED_AT = new Date(Date.parse('2026-10-29T06:00:00Z')).toISOString();
const ACK = ['same_again', 'just_settled', 'excess', 'nothing_owed'];

/** a fresh buyer with one 30000 bill open in the books, and a 30000 payment on account against it */
async function world(shop, pg, tag, product) {
  const { buyer, party } = await R.buyerOnRail(shop, RUN + tag, 'Replay Payer');
  await R.invoiceTo(shop, buyer, { no: 'RP-' + tag, billedAt: BILLED_AT, lines: [{ particulars: product.name, quantity: 5, unit: 'piece', price: 60, total: 300, item_id: product.id }] });
  const bills = await R.openBills(pg, shop.entity, party, 1);
  if (!bills) throw new Error('the invoice never opened in the books');
  const pay = ok(await j('/api/books/payments', { method: 'POST', token: shop.token, body: { party_id: party, direction: 'in', amount_minor: bills[0].minor, currency: 'INR', mode: 'cash', allocate: 'none', acknowledge: ACK } }), 'payment').b;
  return { party, bill: bills[0].ref, pid: pay.payment.payment_id };
}
const confirm = (shop, w, minor) => j('/api/books/payments/' + w.pid + '/confirm', { method: 'POST', token: shop.token, body: { allocations: [{ against_ref: w.bill, amount_minor: minor }] } });
/** the allocation rows the payment wrote, from the ledger */
async function rowsOf(pg, shop, w) {
  const r = await pg.query("SELECT item_id, amount_minor, created_at FROM party_item WHERE entity_id = $1 AND ref = $2 AND ref_kind = 'allocation' ORDER BY item_id", [shop.entity, 'pay:' + w.pid]);
  return r.rows;
}
const dupCount = (replies) => replies.filter((reply) => reply.b.duplicate === true).length;

(async () => {
  console.log('\n══ FIN-63 step 2 · confirm replay on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const lock = new Client({ connectionString: DB });
  await lock.connect();
  try {
    const shop = await freshShop(RUN, 'Replay Books', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const product = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b.item;
    const prod = { id: product.item_id, name: 'Rice' };
    const account = (await pg.query("SELECT account_id FROM ledger_account WHERE entity_id = $1 AND role = 'debtors'", [shop.entity])).rows[0].account_id;

    await kase('RP-1', 'two confirms at once with the same pairs and two keys → one posting, one duplicate:true, ONE batch on the ledger', async () => {
      const w = await world(shop, pg, 'a', prod);
      const replies = await Promise.all([confirm(shop, w, 10000), confirm(shop, w, 10000)]);
      expect(replies.every((r) => r.status === 200), 'statuses ' + replies.map((r) => r.status) + ' ' + JSON.stringify(replies.map((r) => r.b)));
      expect(dupCount(replies) === 1, 'duplicate on ' + dupCount(replies) + ' of 2: ' + JSON.stringify(replies.map((r) => r.b)));
      const rows = await rowsOf(pg, shop, w);
      expect(rows.length === 2 && rows.filter((r) => Number(r.amount_minor) < 0).reduce((t, r) => t - Number(r.amount_minor), 0) === 10000, 'ledger rows ' + JSON.stringify(rows));
      return replies.map((r) => JSON.stringify(r.b)).join(' | ');
    });

    await kase('RP-2', 'start-earlier-waits: two confirms wait on a held lock; the one that takes it second answers duplicate with the first as the latest batch', async () => {
      const w = await world(shop, pg, 'b', prod);
      await lock.query('BEGIN');
      await lock.query(LOCK_SQL, [shop.entity, w.party + '|' + account]);
      let released = false;
      const waiting = [confirm(shop, w, 10000), confirm(shop, w, 10000)].map((p) => p.then((r) => { expect(released, 'a confirm answered while the lock was held'); return r; }));
      await pause(800);
      expect((await rowsOf(pg, shop, w)).length === 0, 'rows written while the lock was held');
      released = true;
      await lock.query('COMMIT');
      const replies = await Promise.all(waiting);
      expect(replies.every((r) => r.status === 200) && dupCount(replies) === 1, JSON.stringify(replies.map((r) => [r.status, r.b])));
      const poster = replies.find((r) => !r.b.duplicate), dup = replies.find((r) => r.b.duplicate);
      expect(dup.b.items === poster.b.items && dup.b.allocated_minor === poster.b.allocated_minor, 'the duplicate carries other figures ' + JSON.stringify([poster.b, dup.b]));
      const rows = await rowsOf(pg, shop, w);
      expect(rows.length === 2, 'ledger rows ' + rows.length);
      return JSON.stringify(replies.map((r) => r.b));
    });

    await kase('RP-3', 'a different allocation is a further one; the first pair again is not the latest batch, so it posts too', async () => {
      const w = await world(shop, pg, 'c', prod);
      const one = await confirm(shop, w, 10000), two = await confirm(shop, w, 3000), again = await confirm(shop, w, 10000);
      expect([one, two, again].every((r) => r.status === 200 && r.b.duplicate === undefined), JSON.stringify([one.b, two.b, again.b]));
      expect((await rowsOf(pg, shop, w)).length === 6, 'ledger rows ' + (await rowsOf(pg, shop, w)).length);
      return 'three batches, six rows';
    });
  } finally {
    await lock.end();
    await pg.end();
  }
  finish('books-confirm-replay', process.env.TRUTH_JSON);
})().catch((e) => { console.error('books-confirm-replay could not run: ' + e.message); process.exit(1); });
