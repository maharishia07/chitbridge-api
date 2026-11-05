'use strict';
/**
 * tests/supplies-truth.realstack.cjs — SUPPLIES TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/supplies.js).
 *
 * OWNS      one case per money write and per id route of routes/supplies.js, on real rows (the stand-in db of tests/api-problem-supplies.test.cjs answers what RLS never would):
 *   SUP-01  POST /purchase (a money write): a counted line writes ONE stock movement and a balance; the same bill sent again adds none (post() is idempotent on the ref); an expensed line moves no stock
 *   SUP-02  PATCH /:id: another shop's supply id answers exactly as an unknown one (404, same words) and changes nothing; the owner's own id saves
 *   SUP-03  POST /:id/issue: another shop's supply id answers exactly as an unknown one and writes no movement; the owner's own id lowers the balance by what was used
 *   SUP-04  an id named in a purchase line (another shop's supply) is not read: the line lands on the caller's own supply, found by name, and the other shop's row is untouched
 *   SUP-05  GET /: a shop's list never holds another shop's supply
 *   SUP-06  gap: a malformed id (not a uuid) is the database's own 22P02 and answers 500 where an unknown uuid answers 404 (listed for API-4c; the stand-in cannot show it)
 * CALLED BY the S41 job (it picks up every *-truth.realstack.cjs) · by hand on the local stack. NOT run on the laptop that wrote it (no Docker there): written, runs in S41.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/supplies-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 16-finance/supplies-routes
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, near, freshShop, finish } = H;
const RUN = 'sp' + (Date.now() % 1e10).toString(36);
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';
let pg = null;

const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty, ref FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const balanceOf = async (shop, item) => { const r = await pg.query(`SELECT qty::float AS qty FROM stock_balance WHERE entity_id = $1 AND item_id = $2`, [shop.entity, item]); return r.rows.length ? r.rows[0].qty : null; };
const supplyOf = async (shop, id) => (await pg.query(`SELECT name, keep_stock, last_cost::float AS last_cost, last_from FROM supply_item WHERE entity_id = $1 AND supply_item_id = $2`, [shop.entity, id])).rows[0] || null;
/** a counted supply for a shop, bought once: its id */
async function counted(shop, name, qty, ref) {
  const bought = ok(await j('/api/supplies/purchase', { method: 'POST', token: shop.token, body: { ref, from: 'Corner Hardware', lines: [{ name, qty, cost: 40, unit: 'bottle', keep_stock: true }] } }), 'purchase').b;
  return bought.recorded[0].supply_item_id;
}
/** an answer as it is compared: status and the words, the per-request id left out (it differs between any two answers) */
const same = (left, right) => left.status === right.status && JSON.stringify(Object.assign({}, left.b, { request_id: null })) === JSON.stringify(Object.assign({}, right.b, { request_id: null }));

(async () => {
  console.log('\n── supplies truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Supplies truth');
    const B = await freshShop(RUN + 'b', 'Supplies other');
    const nameA = 'Floor cleaner ' + RUN;

    await kase('SUP-01', 'a counted purchase writes one movement; the same bill sent again adds none; an expensed line moves no stock', async () => {
      const ref = RUN + '-B1';
      const id = await counted(A, nameA, 3, ref);
      expect((await movesOf(A, id)).length === 1 && near((await movesOf(A, id))[0].qty, 3), 'first send: ' + JSON.stringify(await movesOf(A, id)));
      const again = ok(await j('/api/supplies/purchase', { method: 'POST', token: A.token, body: { ref, from: 'Corner Hardware', lines: [{ name: nameA, qty: 3, cost: 40, unit: 'bottle', keep_stock: true }] } }), 'resend').b;
      expect((await movesOf(A, id)).length === 1 && near(await balanceOf(A, id), 3), 'resend added a movement or moved the balance: ' + JSON.stringify(await movesOf(A, id)) + ' balance ' + await balanceOf(A, id));
      expect(again.books_posted === false, 'the answer must say nothing reached the books: ' + JSON.stringify(again).slice(0, 200));
      const dusters = ok(await j('/api/supplies/purchase', { method: 'POST', token: A.token, body: { ref: RUN + '-B2', lines: [{ name: 'Dusters ' + RUN, qty: 6, cost: 12 }] } }), 'expensed').b;
      expect(dusters.expensed === 1 && dusters.stocked === 0 && (await movesOf(A, dusters.recorded[0].supply_item_id)).length === 0, 'an expensed line moved stock: ' + JSON.stringify(dusters).slice(0, 240));
    }); /* POST /purchase is a money write the register wants an Idempotency-Key on (listed for cb-operations + cb-api): today the ref is the key */

    await kase('SUP-02', 'PATCH /:id: another shop\'s supply id answers as an unknown one and changes nothing; the owner\'s own id saves', async () => {
      const id = (await pg.query(`SELECT supply_item_id FROM supply_item WHERE entity_id = $1 AND name = $2`, [A.entity, nameA])).rows[0].supply_item_id;
      const foreign = await j('/api/supplies/' + id, { method: 'PATCH', token: B.token, body: { name: 'Taken over' } });
      const unknown = await j('/api/supplies/' + UNKNOWN_UUID, { method: 'PATCH', token: B.token, body: { name: 'Taken over' } });
      expect(foreign.status === 404 && same(foreign, unknown), 'foreign ' + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 160) + ' vs unknown ' + unknown.status + ' ' + JSON.stringify(unknown.b).slice(0, 160));
      expect((await supplyOf(A, id)).name === nameA, 'the other shop\'s supply was renamed');
      ok(await j('/api/supplies/' + id, { method: 'PATCH', token: A.token, body: { note: 'checked' } }), 'own edit');
    });

    await kase('SUP-03', 'POST /:id/issue: another shop\'s supply id answers as an unknown one and writes no movement; the owner\'s own id lowers the balance', async () => {
      const id = (await pg.query(`SELECT supply_item_id FROM supply_item WHERE entity_id = $1 AND name = $2`, [A.entity, nameA])).rows[0].supply_item_id;
      const before = (await movesOf(A, id)).length;
      const foreign = await j('/api/supplies/' + id + '/issue', { method: 'POST', token: B.token, body: { qty: 1, ref: RUN + '-U0' } });
      const unknown = await j('/api/supplies/' + UNKNOWN_UUID + '/issue', { method: 'POST', token: B.token, body: { qty: 1, ref: RUN + '-U0' } });
      expect(same(foreign, unknown) && foreign.status === 400, 'foreign ' + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 160) + ' vs unknown ' + unknown.status + ' ' + JSON.stringify(unknown.b).slice(0, 160));
      expect((await movesOf(A, id)).length === before && (await movesOf(B, id)).length === 0, 'a movement was written for a foreign id');
      ok(await j('/api/supplies/' + id + '/issue', { method: 'POST', token: A.token, body: { qty: 1, ref: RUN + '-U1' } }), 'own issue');
      expect(near(await balanceOf(A, id), 2), 'balance after using 1 of 3: ' + await balanceOf(A, id));
    });

    await kase('SUP-04', 'an id named in a purchase line is not read: the line lands on the caller\'s own supply, and the other shop\'s row is untouched', async () => {
      const nameB = 'Mop heads ' + RUN;
      const idB = await counted(B, nameB, 5, RUN + '-BB1');
      const stamp = await supplyOf(B, idB);
      const sent = ok(await j('/api/supplies/purchase', { method: 'POST', token: A.token, body: { ref: RUN + '-B3', lines: [{ name: 'Brooms ' + RUN, supply_item_id: idB, item_id: idB, qty: 2, cost: 99, keep_stock: true }] } }), 'purchase naming a foreign id').b;
      const landed = sent.recorded[0].supply_item_id;
      expect(landed !== idB, 'the line landed on the other shop\'s supply');
      expect(JSON.stringify(await supplyOf(B, idB)) === JSON.stringify(stamp) && (await movesOf(B, idB)).length === 1 && (await movesOf(A, idB)).length === 0, 'the other shop\'s supply or stock moved');
    });

    await kase('SUP-05', 'GET /: a shop\'s list never holds another shop\'s supply', async () => {
      const listA = ok(await j('/api/supplies', { token: A.token }), 'list A').b.supplies.map((s) => s.name);
      const listB = ok(await j('/api/supplies', { token: B.token }), 'list B').b.supplies.map((s) => s.name);
      expect(listA.includes(nameA) && !listB.includes(nameA) && !listA.includes('Mop heads ' + RUN), 'lists crossed: A ' + JSON.stringify(listA) + ' B ' + JSON.stringify(listB));
    });

    await kase('SUP-06', 'a malformed id answers 404 as an unknown uuid does, not 500', async () => {
      const bad = await j('/api/supplies/nope', { method: 'PATCH', token: A.token, body: { name: 'x' } });
      const unknown = await j('/api/supplies/' + UNKNOWN_UUID, { method: 'PATCH', token: A.token, body: { name: 'x' } });
      expect(bad.status === unknown.status, 'a malformed id answered ' + bad.status + ' where an unknown uuid answered ' + unknown.status);
    }, 'a uuid column compared with "nope" raises 22P02 and the catch answers the generic 500 (API-4c: a 400/404 would be new behaviour, the owner decides)');
  } finally {
    await pg.end();
  }
  finish('supplies truth', process.env.SUPPLIES_TRUTH_JSON || null);
})().catch((failure) => { console.error(failure); process.exitCode = 1; });
