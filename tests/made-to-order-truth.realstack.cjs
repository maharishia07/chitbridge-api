'use strict';
/**
 * tests/made-to-order-truth.realstack.cjs — R104 · A MADE-TO-ORDER DISH IS NOT STOCK, on the LOCAL stack (T2; the case: OPS001 row R104).
 *
 * Kaveri Tiffins cooks Masala Dosa when it is ordered and stocks Ghee. Before R104 every dosa sold went to −n on Operations › Stock, the
 * Home card said "N below zero", and closing stock "from the stock ledger" was refused with STOCK_BELOW_ZERO naming every dish, so the
 * month could never be closed from the ledger. This drives the api's own doors on a FRESH shop made for this run:
 *   register → country → trade declared as `tiffin` (PUT /api/governance/profile sectors — never "food-service", the batch-pack hazard)
 *   products: Masala Dosa (says nothing: the trade decides) · Ghee 500 g (item_data.stocked: true) · Filter Coffee (sold BEFORE the trade
 *   was declared, so it holds an old −2 balance the way every real tiffin shop does today)
 *   receipt Ghee 10 @ 200 · bill 2 Masala Dosa + 1 Ghee + 1 Filter Coffee
 * and checks: the ghee is down 1, the dosa never moved (no row at all), the coffee's old −2 row STAYS but is marked counted:false and
 * not_counted says so; the Home card agrees with Stock (none below zero); POST /api/books/closing-stock 'automatic' closes the month
 * with the ghee's value and no STOCK_BELOW_ZERO. Existing negatives: no deletion, no SQL — the log is only ever SELECTed.
 *
 * ⚠️ LOCAL ONLY (the harness refuses any other api or database). Needs DEV_OTP armed. CI: the S41 job runs every tests/*-truth.realstack.cjs.
 * Run: node tests/made-to-order-truth.realstack.cjs        (API_BASE / TRUTH_DB override the defaults)
 * CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 */
const { Client } = require('pg');
const { DB, results, j, ok, pause, kase, expect, receipt, bill, freshShop, finish } = require('./lib/truth-harness.cjs'); /* K-TRUTH-1: the one shared harness */
const RUN = 'mto' + (Date.now() % 1e9).toString(36); /* a User ID is at most 20 characters */

let pg = null,
  SHOP = null;
/** the log, read-only — the proof that nothing was deleted */
async function moves(item_id) {
  const r = await pg.query(`SELECT reason, qty::float AS qty FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [SHOP.entity, item_id]);
  return r.rows;
}
/** stock moves AFTER the send answers (routes/chits.js sendStock, not awaited) — wait until the log holds `n` rows for the item */
async function settle(item_id, n, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = await moves(item_id);
    if (m.length >= n || Date.now() > end) return m;
    await pause(150);
  }
}
const statement = async () => ok(await j('/api/till/stock?detail=1', { token: SHOP.token }), 'stock read').b;
const send = async (body, what) => ok(await j('/api/chits/send', { method: 'POST', token: SHOP.token, body }), what).b;
const seen = (label, value) => label + ': seen ' + JSON.stringify(value);
async function product(name, unit, price, extra) {
  const r = ok(await j('/api/products', { method: 'POST', token: SHOP.token, body: { item_data: Object.assign({ name, unit, price }, extra || {}) } }), 'product ' + name).b;
  return { id: r.item.item_id, name, unit, price };
}
/** the item's own word, both ways — merge:true so the one key moves and nothing else (routes/products PATCH) */
const mark = async (p, stocked) => ok(await j('/api/products/' + p.id, { method: 'PATCH', token: SHOP.token, body: { merge: true, item_data: { stocked } } }), 'mark ' + p.name);

async function cases() {
  SHOP = await freshShop(RUN, 'Kaveri Tiffins');
  const DOSA = await product('Masala Dosa', 'plate', 90);
  const GHEE = await product('Ghee 500 g', 'piece', 320, { stocked: true });
  const COFFEE = await product('Filter Coffee', 'cup', 25);

  /* the shop as it is today: no trade declared, two coffees sold → −2 on the shelf (the old figure every tiffin shop holds) */
  await send(bill(RUN + '-B0', [[COFFEE, 2]]), 'bill before the trade');
  await settle(COFFEE.id, 1);
  await kase('MTO-00', 'with NO trade declared every item is counted: the coffee went to −2 (as before R104)', async () => {
    const s = await statement();
    const c = s.balances[COFFEE.id];
    expect(c && c.qty === -2 && c.counted === true, seen('coffee', c));
  });

  /* pass test 0: the trade is "tiffin" — never "food-service" */
  ok(await j('/api/governance/profile', { method: 'PUT', token: SHOP.token, body: { trade_mode: 'domestic', markets: ['IN'], sectors: ['tiffin'], adopted: [] } }), 'trade = tiffin');
  await send(receipt(RUN + '-GR1', [[GHEE, 10, 200]]), 'receipt ghee');
  await settle(GHEE.id, 1);
  await send(bill(RUN + '-B1', [[DOSA, 2], [GHEE, 1], [COFFEE, 1]]), 'bill 2 dosa + 1 ghee + 1 coffee');
  await settle(GHEE.id, 2);

  await kase('MTO-01', 'the counter bill: ghee 10 → 9; the dosa NEVER moved (no balance row, no movement) — a named skip, not a −2', async () => {
    const s = await statement();
    expect(s.balances[GHEE.id] && s.balances[GHEE.id].qty === 9, seen('ghee', s.balances[GHEE.id]));
    expect(s.balances[DOSA.id] === undefined, seen('dosa on Stock', s.balances[DOSA.id]));
    const m = await moves(DOSA.id);
    expect(m.length === 0, seen('dosa movements', m));
  });
  await kase('MTO-02', "the coffee's old −2 STAYS (no deletion, no SQL) but is marked counted:false, and not_counted says 1", async () => {
    const s = await statement();
    const c = s.balances[COFFEE.id];
    expect(c && c.qty === -2 && c.counted === false, seen('coffee', c));
    expect(s.not_counted === 1, seen('not_counted', s.not_counted));
    const m = await moves(COFFEE.id);
    expect(m.length === 1, seen('coffee movements (the sale after the trade moved nothing)', m));
  });
  await kase('MTO-03', 'the Home card agrees with Stock: 1 on the shelf (ghee), none below zero', async () => {
    const f = ok(await j('/api/facts/operations', { token: SHOP.token }), 'facts').b;
    expect(f.figures && f.figures.items === 1 && f.figures.below_zero === 0, seen('operations card', f));
  });
  await kase('MTO-04', "closing stock from the ledger: the month closes with the ghee's value (9 × 200 = 1,800), no STOCK_BELOW_ZERO", async () => {
    ok(await j('/api/books/enable', { method: 'POST', token: SHOP.token, body: { walkin_grain: 'day' } }), 'books on'); /* as scripts/seed-local.cjs switches the ledger on */
    const today = new Date().toISOString().slice(0, 10);
    const r = await j('/api/books/closing-stock', { method: 'POST', token: SHOP.token, body: { date: today, method: 'automatic', client_ref: RUN + '-cs' } });
    const led = r.b && r.b.from_ledger;
    expect(r.status === 200 && led && led.value_minor === 180000 && led.lines === 1, seen('closing stock ' + r.status, r.b));
  });
  await kase('MTO-05', 'the item overrides the trade both ways: marked counted, a sale shows −1 counted; marked back, the figure stays, greyed', async () => {
    await mark(DOSA, true);
    await send(bill(RUN + '-B2', [[DOSA, 1]]), 'bill 1 dosa (counted)');
    await settle(DOSA.id, 1);
    let d = (await statement()).balances[DOSA.id];
    expect(d && d.qty === -1 && d.counted === true, seen('dosa counted', d));
    await mark(DOSA, false);
    d = (await statement()).balances[DOSA.id];
    expect(d && d.qty === -1 && d.counted === false, seen('dosa not counted', d));
  });
}

(async () => {
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    await cases();
  } catch (e) {
    results.push({ id: 'MTO-RUN', pass: false, seen: String(e && e.stack) });
    console.error(e);
  }
  await pg.end();
  finish('made-to-order-truth', process.env.MTO_TRUTH_JSON, { shop: SHOP && SHOP.name });
})();
