'use strict';
/**
 * tests/stock-sweep-truth.realstack.cjs — CTR-178 · THE SWEEP'S SQL RUN ON A REAL POSTGRES (T2; the S41 job runs every tests/*-truth.realstack.cjs).
 *
 * OWNS      the proof that lib/stock-sweep GAPS_SQL and OPEN_SQL are valid Postgres (parameter types, jsonb, ordinality) and say what the unit test's
 *           stand-in says: a posted bill is not a gap; a product the shop marked not stocked is not a stock line; a movement armed away (owner DELETE,
 *           on this throwaway database only) makes its bill a gap; ONE line armed away on a 2-line bill makes it a gap; the page is newest first and
 *           keyset-paged; and the real healShop posts the missing line once. A regex over the SQL text is not this proof.
 * CALLED BY .github/workflows/ci.yml › integration (the T2 truth loop) · by hand against the local stack
 * FLOW      fresh shop -> receipt + bills through the doors -> owner pg reads/deletes -> GAPS_SQL / OPEN_SQL with real parameters -> healShop (cb_app, RLS on)
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * ⚠️ LOCAL ONLY (the harness refuses any other api or database). Needs DEV_OTP armed. The ONE write outside the doors is the owner's DELETE of a
 * sale movement of THIS run's shop, to arm the precondition. healShop runs as cb_app (STOCK_SWEEP_APP_DB, default: the TRUTH_DB host with cb_app/cbapp).
 * Run: node tests/stock-sweep-truth.realstack.cjs
 */
const { Client } = require('pg');
const { DB, results, j, ok, pause, kase, expect, receipt, bill, freshShop, finish } = require('./lib/truth-harness.cjs');
const RUN = 'ssw' + (Date.now() % 1e9).toString(36);

let pg = null,
  SHOP = null;
const send = async (body, what) => ok(await j('/api/chits/send', { method: 'POST', token: SHOP.token, body }), what).b;
async function product(name, unit, price, extra) {
  const r = ok(await j('/api/products', { method: 'POST', token: SHOP.token, body: { item_data: Object.assign({ name, unit, price }, extra || {}) } }), 'product ' + name).b;
  return { id: r.item.item_id, name, unit, price };
}
const sales = async (ref) => (await pg.query(`SELECT movement_id, line_ref, qty::float AS qty FROM stock_movement WHERE entity_id = $1 AND ref = $2 AND reason = 'sale' ORDER BY at, line_ref`, [SHOP.entity, ref])).rows;
/** stock posts AFTER the send answers (sendStock, not awaited): wait until the ref holds n sale rows */
async function settle(ref, n) {
  const end = Date.now() + 5000;
  for (;;) {
    const rows = await sales(ref);
    if (rows.length >= n || Date.now() > end) return rows;
    await pause(150);
  }
}
const SWEEP = require('../lib/stock-sweep');
const page = async (before) => (await pg.query(SWEEP.GAPS_SQL, [SHOP.entity, 3, 0, 50, before || null])).rows;
const open = async () => (await pg.query(SWEEP.OPEN_SQL, [SHOP.entity, 30, 0])).rows;
const seen = (label, value) => label + ': seen ' + JSON.stringify(value);
const refs = (rows) => rows.map((row) => row.business_json && row.business_json.client_ref);

async function cases() {
  SHOP = await freshShop(RUN, 'Sweep Traders');
  const TEA = await product('Tea 250 g', 'piece', 100, { stocked: true });
  const DOSA = await product('Masala Dosa', 'plate', 90, { stocked: false });
  await send(receipt(RUN + '-GR', [[TEA, 20, 60]]), 'receipt tea');
  const B1 = RUN + '-B1',
    B2 = RUN + '-B2',
    B3 = RUN + '-B3';
  await send(bill(B1, [[TEA, 2], [DOSA, 1]]), 'bill 1');
  await settle(B1, 1);
  await pause(200);

  await kase('SSW-01', 'a posted bill is not a gap, and the dosa (marked not stocked) is not a stock line: the page and the count are empty', async () => {
    const rows = await page();
    expect(rows.length === 0, seen('page', refs(rows)));
    const o = await open();
    expect(o.length === 0, seen('open', o));
  });
  await kase('SSW-02', 'a sale movement armed away makes its bill the one gap (page and count), and the bill comes back whole', async () => {
    const moved = await sales(B1);
    expect(moved.length === 1, seen('the tea sale', moved));
    await pg.query(`DELETE FROM stock_movement WHERE entity_id = $1 AND movement_id = $2`, [SHOP.entity, moved[0].movement_id]);
    const rows = await page();
    expect(rows.length === 1 && refs(rows)[0] === B1 && Array.isArray(rows[0].line_items), seen('page', refs(rows)));
    expect((await open()).length === 1, 'the count sees it');
  });
  await kase('SSW-03', 'the real healShop (cb_app, RLS on) posts it once; the gap closes; a second pass moves nothing', async () => {
    process.env.DATABASE_URL = process.env.STOCK_SWEEP_APP_DB || DB.replace(/\/\/[^@]*@/, '//cb_app:cbapp@');
    const { withEntity } = require('../db');
    const first = await SWEEP.healShop(SHOP.entity, withEntity, { grace: 0, say: true });
    expect(first.found === 1 && first.moved === 1 && first.still.length === 0, seen('first pass', first));
    expect((await sales(B1)).length === 1, 'one sale row again');
    const second = await SWEEP.healShop(SHOP.entity, withEntity, { grace: 0, say: true });
    expect(second.found === 0 && second.moved === 0 && second.open === 0, seen('second pass', second));
  });
  await kase('SSW-04', 'HALF-POSTED: a 2-line bill with only its second line armed away is a gap, and healShop posts that line only', async () => {
    await send(bill(B2, [[TEA, 1], [TEA, 2]]), 'bill 2');
    const both = await settle(B2, 2);
    expect(both.length === 2, seen('both lines posted', both));
    await pg.query(`DELETE FROM stock_movement WHERE entity_id = $1 AND movement_id = $2`, [SHOP.entity, both[1].movement_id]);
    const rows = await page();
    expect(rows.length === 1 && refs(rows)[0] === B2, seen('page', refs(rows)));
    const { withEntity } = require('../db');
    const healed = await SWEEP.healShop(SHOP.entity, withEntity, { grace: 0 });
    expect(healed.moved === 1 && (await sales(B2)).length === 2, seen('healed', healed));
  });
  await kase('SSW-05', 'the page is newest first and keyset-paged: with two gaps, before = the first one’s moment returns only the older', async () => {
    await send(bill(B3, [[TEA, 1]]), 'bill 3');
    const b3 = await settle(B3, 1);
    const b2 = await sales(B2);
    await pg.query(`DELETE FROM stock_movement WHERE entity_id = $1 AND movement_id = ANY($2::uuid[])`, [SHOP.entity, [b3[0].movement_id, b2[0].movement_id]]);
    const all = await page();
    expect(all.length === 2 && refs(all)[0] === B3 && refs(all)[1] === B2, seen('newest first', refs(all)));
    const older = await page(all[0].created_at);
    expect(older.length === 1 && refs(older)[0] === B2, seen('older than the first', refs(older)));
  });
}

(async () => {
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    await cases();
  } catch (e) {
    results.push({ id: 'SSW-RUN', pass: false, seen: String(e && e.stack) });
    console.error(e);
  }
  await pg.end();
  finish('stock-sweep-truth', process.env.SSW_TRUTH_JSON, { shop: SHOP && SHOP.name });
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
})();
