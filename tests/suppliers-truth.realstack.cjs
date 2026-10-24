'use strict';
/**
 * tests/suppliers-truth.realstack.cjs — SUPPLIERS / P2P TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §7; OPS-14 / TB-STOCK-7).
 *
 * The six uncovered rows (SU-14 is a new row for the replay door): SU-01 short delivery is flagged · SU-02 a rail invoice counted in raises stock · SU-06 a rejected bill moves no stock ·
 * SU-08 an issue sent twice (no ref) is one row · SU-12 a rail supplier must be on my list to be billed through (a stranger's bill waits, it does not post) ·
 * SU-13 an off-list invoice is SAID to me, not silent. A `gap:` FAIL is a RECORDED finding (OPERATIONS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here.
 * Box-truth round 24 Oct (written, not run): SU-03 a batch-tracked product received with no batch posts nothing (lib/stock-store.js:112) · SU-04 two batches of one product are two movements, two lots ·
 * SU-05 a delivery is judged by the fields it needs, not the trade key (VB7: a gap) · SU-05b an undeclared buyer is told what a pharma delivery needs · SU-09 a local supplier is a row on the same list as a rail one
 * (the bill-to-voucher half is the books area: listed, not written) · SU-11 a repeat run is one chit and both parties hold the agreement · SU-R58 a goods receipt to self takes none of the shop sales offers.
 * Not here: SU-07 (a code scan: supplier-list-scope.test.cjs) · SU-10 (a till walk: till-receive-bill.cjs).
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/suppliers-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 13-inventory-stock-and-traceability/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, ENTITY_OTP, j, ok, pause, kase, expect, near, freshShop, finish } = H;
const RUN = 'su' + (Date.now() % 1e10).toString(36);
let pg = null;
const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty, ref FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const onHand = async (shop, item) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[item]; return b ? b.qty : null; };
async function settle(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await movesOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }

async function supplierShop(tag) {
  const email = tag + '@local.test';
  ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Truth Supplier ' + tag, user_id: tag } }), 'supplier register');
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP } }), 'supplier verify').b;
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: v.token, body: { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } } }), 'supplier country');
  return { token: v.token, bridge: v.entity.bridge_id, entity: (v.entity && (v.entity.identity_id || v.entity.entity_id)) || (v.identity && v.identity.identity_id) };
}
const invoiceFrom = async (S, buyerBridge, buyerName, ref, name, qty) => ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ display_name: buyerName, bridge_id: buyerBridge, kind: 'to' }],
  purpose: 'invoice', subject: 'Invoice ' + ref, manual_subject: 'Invoice ' + ref, client_ref: ref, business_json: { bill_no: ref, billed_at: new Date().toISOString() },
  line_items: [{ particulars: name, quantity: qty, unit: 'piece', price: 20, total: qty * 20 }] } }), 'supplier sends ' + ref).b;
/* ── the SU-03 / SU-04 / SU-05 / SU-11 round (24 Oct): every id is its own constant, every write is a route ── */
const BATCH_A = 'AC2431', BATCH_B = 'AC2432', EXPIRY_A = '2028-03-31', EXPIRY_B = '2027-01-31', BATCH_ONLY = 'B1-' + RUN.slice(-4);
const PHARMA_NEEDS = ['batch', 'expiry'];                       /* lib/lotfields PACKS pharma.required */
const IST_OFFSET_MS = 330 * 60e3;                               /* a shop's first day is its own zone's: try the UTC day, then India's (lib/repeat-supply schedule) */
const dayAt = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
const lotsOf = async (shop, item) => (await pg.query(`SELECT lot, qty::float AS qty, expires_at::text AS expires_at, ref FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY line_ref`, [shop.entity, item])).rows;
async function settleLots(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await lotsOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }
/** a product that says it is kept per batch (item_data.batch_tracked wins over the trade: lib/lotfields tracksBatch) */
async function trackedProduct(shop, name) {
  const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price: 30, batch_tracked: true } } }), 'tracked product').b.item;
  return { id: made.item_id, name, unit: 'piece', price: 30 };
}
/** a goods receipt to self whose lines each carry their own lot (the goods-in door's shape: item_data.lot = { batch, expiry }) */
function lotReceipt(no, product, lots) {
  const body = H.receipt(no, lots.map((l) => [product, l.qty, 10]));
  body.line_items.forEach((item, index) => { if (lots[index].lot) item.item_data.lot = lots[index].lot; });
  return body;
}
const sendSelf = async (shop, body, what) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), what).b;
/** a supplier's goods note to a buyer: purpose delivery_note, a purpose that carries the sender's trade (routes/chits.js stamps business_json.source) */
const deliveryFrom = async (S, buyer, ref, name, lot) => ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ display_name: buyer.name, bridge_id: buyer.bridge, kind: 'to' }],
  purpose: 'delivery_note', subject: 'Delivery ' + ref, manual_subject: 'Delivery ' + ref, client_ref: ref, business_json: { doc: 'despatch', doc_no: ref },
  line_items: [{ particulars: name, quantity: 4, unit: 'piece', price: 20, total: 80, item_data: { lot } }] } }), 'supplier sends delivery ' + ref).b;
const declareSectors = async (shop, sectors) => ok(await j('/api/governance/profile', { method: 'PUT', token: shop.token, body: { sectors, trade_mode: 'domestic' } }), 'declare sectors ' + sectors.join(','));
const adoptRow = async (buyer, chit) => (ok(await j('/api/adopt/' + chit, { token: buyer.token }), 'adopt read').b.rows || [])[0] || {};
const mineLines = async (A, chit) => ((ok(await j('/api/chits/' + chit, { token: A.token }), 'read bill').b.detail || {}).line_items || []);

(async () => {
  console.log('\n── suppliers truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Suppliers truth');
    const g = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Goods ' + RUN, unit: 'piece', price: 30 } } }), 'product').b.item;
    const G = { id: g.item_id, name: 'Goods ' + RUN, unit: 'piece' };
    const S = await supplierShop(RUN + 's');
    const listed = await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { supplier_bridge_id: S.bridge, supply_kind: 'resale' } });
    if (listed.status !== 409) ok(listed, 'supplier on the list');

    await kase('SU-02', 'a rail supplier invoice for 6, marked resale and counted in, raises stock by 6', async () => {
      const inv = await invoiceFrom(S, A.bridge, A.name, RUN + '-I2', G.name, 6), lines = await mineLines(A, inv.chit_id);
      ok(await j('/api/chits/' + inv.chit_id + '/use', { method: 'PUT', token: A.token, body: { use: 'resale' } }), 'use resale');
      ok(await j('/api/chits/' + inv.chit_id + '/deliver-lines', { method: 'POST', token: A.token, body: { rows: [{ line_id: lines[0].line_id, quantity: 6, unit: G.unit, client_ref: RUN + '-I2:0' }] } }), 'goods in');
      await settle(A, G.id, 1);
      expect(near(await onHand(A, G.id), 6), 'on hand ' + await onHand(A, G.id) + ' (expected 6)');
    }, 'deliver-lines records chit_line_delivery only; a supplier line carries no item of MINE (ST-19)');
    await kase('SU-01', 'invoice 10, received 8: the short 2 is flagged on the bill, not left silent', async () => {
      const inv = await invoiceFrom(S, A.bridge, A.name, RUN + '-I1', G.name, 10), lines = await mineLines(A, inv.chit_id);
      ok(await j('/api/chits/' + inv.chit_id + '/use', { method: 'PUT', token: A.token, body: { use: 'resale' } }), 'use resale');
      const d = ok(await j('/api/chits/' + inv.chit_id + '/deliver-lines', { method: 'POST', token: A.token, body: { rows: [{ line_id: lines[0].line_id, quantity: 8, unit: G.unit, client_ref: RUN + '-I1:0' }] } }), 'goods in').b;
      const read = JSON.stringify(ok(await j('/api/chits/' + inv.chit_id, { token: A.token }), 'read').b);
      expect(/short|shortfall|outstanding|remaining|undelivered/i.test(JSON.stringify(d) + read), 'no short word in the goods-in answer or the bill: ' + JSON.stringify(d).slice(0, 200));
    }, 'short-by figure not surfaced on the bill (three-way match view)');
    await kase('SU-06', 'a received bill that is rejected leaves stock where it was', async () => {
      const before = await onHand(A, G.id), inv = await invoiceFrom(S, A.bridge, A.name, RUN + '-I6', G.name, 4);
      const rej = await j('/api/chits/' + inv.chit_id + '/status', { method: 'PUT', token: A.token, body: { status: 'rejected', note: 'suppliers truth: wrong goods' } });
      await pause(800);
      expect(rej.status < 300 && near(await onHand(A, G.id), before), 'reject HTTP ' + rej.status + ' ' + JSON.stringify(rej.b).slice(0, 120) + ' · on hand ' + await onHand(A, G.id) + ' (was ' + before + ')');
    });
    await kase('SU-08', 'a supply used, sent twice with no reference, records one issue', async () => {
      const sup = ok(await j('/api/supplies', { method: 'POST', token: A.token, body: { name: 'Bags ' + RUN, unit: 'piece', keep_stock: true } }), 'supply').b.supply;
      const sid = sup.supply_item_id || sup.item_id;
      ok(await j('/api/supplies/purchase', { method: 'POST', token: A.token, body: { ref: RUN + '-P8', lines: [{ name: 'Bags ' + RUN, unit: 'piece', qty: 10, cost: 5 }] } }), 'purchase');
      await j('/api/supplies/' + sid + '/issue', { method: 'POST', token: A.token, body: { qty: 2 } });
      await j('/api/supplies/' + sid + '/issue', { method: 'POST', token: A.token, body: { qty: 2 } });
      const rows = (await pg.query(`SELECT count(*)::int AS n FROM stock_movement WHERE entity_id = $1 AND item_id = $2 AND reason = 'issued'`, [A.entity, sid])).rows[0].n;
      expect(rows === 1, rows + ' issue rows for one use sent twice (expected 1: ST-27 wants a reference-less repeat to be one row)');
    }, 'issue with no ref gets a unique use-<time> ref, so a replay doubles it (ST-27, supply-store.js:238)');
    await kase('SU-14', 'the same supplier invoice sent twice (same reference) is one bill: answered as a replay, or refused in words that make sense', async () => {
      const a = await invoiceFrom(S, A.bridge, A.name, RUN + '-I14', G.name, 2);
      const r = await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ display_name: A.name, bridge_id: A.bridge, kind: 'to' }], purpose: 'invoice', subject: 'Invoice ' + RUN + '-I14', manual_subject: 'Invoice ' + RUN + '-I14', client_ref: RUN + '-I14', business_json: { bill_no: RUN + '-I14', billed_at: new Date().toISOString() }, line_items: [{ particulars: G.name, quantity: 2, unit: 'piece', price: 20, total: 40 }] } });
      const n = (await pg.query(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND business_json->>'client_ref' = $2`, [A.entity, RUN + '-I14'])).rows[0].n;
      const sentence = r.status < 300 ? r.b.chit_id === a.chit_id : (r.status === 409 && !/null/.test(String(r.b.message)));
      expect(n <= 1 && sentence, 'copies ' + n + ' · second send HTTP ' + r.status + ' ' + String(r.b.message || r.b.chit_id).slice(0, 140));
    }, 'a replayed rail invoice is refused as a till-series collision naming "counter null" (b263 guard, no till on a supplier chit)');
    await kase('SU-12', 'a bill from a rail supplier NOT on my list does not post: it waits, and says so', async () => {
      const X = await supplierShop(RUN + 'x');
      const inv = await invoiceFrom(X, A.bridge, A.name, RUN + '-I12', G.name, 3);
      const read = JSON.stringify(ok(await j('/api/chits/' + inv.chit_id, { token: A.token }), 'read').b);
      const posted = (await pg.query(`SELECT count(*)::int AS n FROM stock_movement WHERE entity_id = $1 AND ref LIKE $2`, [A.entity, '%' + RUN + '-I12%'])).rows[0].n;
      expect(posted === 0 && /list|unlisted|waiting|hold|not.{0,12}supplier|add .{0,20}supplier/i.test(read), 'stock rows ' + posted + ' · bill says: ' + read.slice(0, 160));
    }, 'the bill from an unlisted seller carries no sentence saying it waits');
    await kase('SU-03', 'a batch-tracked product received with no batch number posts nothing; the same product with its batch posts', async () => {
      const P = await trackedProduct(A, 'Tracked ' + RUN + '-3');
      await sendSelf(A, lotReceipt(RUN + '-R3n', P, [{ qty: 5 }]), 'receipt with no batch');
      await sendSelf(A, lotReceipt(RUN + '-R3b', P, [{ qty: 3, lot: { batch: BATCH_ONLY } }]), 'receipt with a batch');
      const moves = await settleLots(A, P.id, 1);
      expect(moves.length === 1 && String(moves[0].lot).toUpperCase() === BATCH_ONLY.toUpperCase() && near(moves[0].qty, 3), 'movements ' + JSON.stringify(moves) + ' (expected only the batch ' + BATCH_ONLY + ' x3: the no-batch receipt is refused one layer down, lib/stock-store.js:112)');
    });
    await kase('SU-04', 'two batches of one product on one receipt are two movements under two lots, each with its own expiry, and one on-hand figure', async () => {
      const P = await trackedProduct(A, 'Tracked ' + RUN + '-4');
      await sendSelf(A, lotReceipt(RUN + '-R4', P, [{ qty: 10, lot: { batch: BATCH_A, expiry: EXPIRY_A } }, { qty: 5, lot: { batch: BATCH_B, expiry: EXPIRY_B } }]), 'two-batch receipt');
      const moves = await settleLots(A, P.id, 2), by = (b) => moves.find((m) => m.lot === b) || {};
      const shape = moves.length === 2 && near(by(BATCH_A).qty, 10) && by(BATCH_A).expires_at === EXPIRY_A && near(by(BATCH_B).qty, 5) && by(BATCH_B).expires_at === EXPIRY_B;
      expect(shape && near(await onHand(A, P.id), 15), 'movements ' + JSON.stringify(moves) + ' · on hand ' + await onHand(A, P.id) + ' (expected two lots 10 + 5, total 15)');
    });
    await kase('SU-R58', 'a goods receipt sent to self takes none of the shop sales offers: no offer recorded on its copy, the total as received', async () => {
      const sent = await sendSelf(A, H.receipt(RUN + '-R58', [[G, 4, 25]]), 'receipt to self');
      const row = (await pg.query(`SELECT summary_json->'offers' AS offers, (summary_json->>'total_value')::float AS total FROM chit_header WHERE entity_id = $1 AND chit_id = $2`, [A.entity, sent.chit_id])).rows[0] || {};
      const offers = Array.isArray(row.offers) ? row.offers : [];
      expect(offers.length === 0 && near(row.total, 100), 'offers recorded ' + JSON.stringify(row.offers) + ' · total ' + row.total + ' (expected none and 100 = 4 x 25)');
    }, 'R58 walk 24 Oct: routes/chits.js sendOffers (~:1207) runs the seller live sales offers on any send to self, a goods receipt included. Not armed here: no live offer is created (the offer door is the catalogue area), so this passes until one exists');
    await kase('SU-05', 'a pharma delivery to a food shop is judged by the fields it needs (batch + expiry) against what I record, not refused by the trade key', async () => {
      const P = await supplierShop(RUN + 'p'); await declareSectors(P, ['pharma']);
      const B = await freshShop(RUN + 'f', 'Food buyer'); await declareSectors(B, ['food']);
      const note = await deliveryFrom(P, B, RUN + '-D5', 'Strip ' + RUN, { batch: BATCH_A }), row = await adoptRow(B, note.chit_id);
      expect(row.refused !== 'vertical' && Array.isArray(row.missing) && row.missing.includes('expiry'), 'row says ' + JSON.stringify({ may: row.may, refused: row.refused, needs: row.needs, missing: row.missing, why: String(row.why || '').slice(0, 120) }) + ' (expected a question about expiry, not a refusal by trade)');
    }, 'VB7 (BOX-TRUTH-TESTS section 7 Open list): lib/adopt.js consider() step 3 refuses when the two trade keys differ (theirs !== mine); the required-field compare is not built');
    await kase('SU-05b', 'a shop that has declared no trade is told what a pharma delivery needs: offered, batch + expiry named, the missing expiry said', async () => {
      const P = await supplierShop(RUN + 'q'); await declareSectors(P, ['pharma']);
      const C = await freshShop(RUN + 'g', 'Plain buyer');
      const note = await deliveryFrom(P, C, RUN + '-D5b', 'Strip ' + RUN + 'b', { batch: BATCH_B }), row = await adoptRow(C, note.chit_id);
      expect(row.may === 'offer' && JSON.stringify(row.needs) === JSON.stringify(PHARMA_NEEDS) && Array.isArray(row.missing) && row.missing.includes('expiry') && !row.missing.includes('batch'),
        'row says ' + JSON.stringify({ may: row.may, needs: row.needs, missing: row.missing }));
    });
    await kase('SU-09', 'ADD HALF: an off-rail local supplier added by name is a row on the same supplier list as a rail one, the same row shape, marked not on the rail', async () => {
      const name = 'Corner hardware ' + RUN;
      const added = ok(await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { name, supply_kind: 'resale' } }), 'add local supplier').b.supplier;
      const rows = ok(await j('/api/relationships/suppliers', { token: A.token }), 'supplier list').b.suppliers || [];
      const local = rows.find((r) => r.supplier_entity_id === added.supplier_entity_id), rail = rows.find((r) => r.bridge_id === S.bridge);
      const keys = (r) => JSON.stringify(Object.keys(r).sort());
      expect(local && rail && local.on_rail === false && rail.on_rail === true && keys(local) === keys(rail),
        'local ' + JSON.stringify(local && { on_rail: local.on_rail, name: local.display_name }) + ' · rail ' + JSON.stringify(rail && { on_rail: rail.on_rail }) + ' · keys local ' + (local && keys(local)) + ' rail ' + (rail && keys(rail)));
    });
    await kase('SU-11', 'a repeat-supply agreement: both parties hold the agreement chit; once agreed, a run mints ONE invoice, and the same day again mints nothing', async () => {
      const R = await supplierShop(RUN + 'r'), W = await freshShop(RUN + 'w', 'Repeat buyer');
      const bill = await invoiceFrom(R, W.bridge, W.name, RUN + '-I11', G.name, 2);
      const ask = (start) => j('/api/repeat', { method: 'POST', token: R.token, body: { chit_id: bill.chit_id, every: 1, unit: 'daily', start_on: start, until: { runs: 3 }, mode: 'send' } });
      let made = await ask(dayAt(0));
      if (made.status === 400) made = await ask(dayAt(IST_OFFSET_MS));   /* the shop's zone is ahead of UTC: its today is the later day */
      const ag = ok(made, 'create agreement').b.agreement, held = '?chit=' + ag.chit_id;
      const theirs = ok(await j('/api/repeat/' + ag.agreement_id + held, { token: W.token }), 'customer reads the agreement').b.agreement;
      ok(await j('/api/chits/' + ag.chit_id, { token: R.token }), 'seller holds the agreement chit'); ok(await j('/api/chits/' + ag.chit_id, { token: W.token }), 'customer holds the agreement chit');
      ok(await j('/api/repeat/' + ag.agreement_id + '/accept' + held, { method: 'POST', token: W.token, body: { chit_id: ag.chit_id } }), 'customer accepts');
      const first = ok(await j('/api/repeat/' + ag.agreement_id + '/run', { method: 'POST', token: R.token }), 'run').b;
      const again = await j('/api/repeat/' + ag.agreement_id + '/run', { method: 'POST', token: R.token });
      const now = ok(await j('/api/repeat/' + ag.agreement_id, { token: R.token }), 'agreement after').b.agreement;
      const runChit = (first.ran[0] || {}).chit_id, heldRun = runChit ? (await j('/api/chits/' + runChit, { token: W.token })).status : 'no run';
      expect(theirs.agreement_id === ag.agreement_id && first.ran.length === 1 && heldRun === 200 && again.status >= 400 && Object.keys(now.runs || {}).length === 1 && now.runs_done === 1,
        'customer view ' + theirs.agreement_id + ' · first run ' + JSON.stringify(first.ran) + ' · customer reads the run ' + heldRun + ' · second run HTTP ' + again.status + ' · runs ' + JSON.stringify(now.runs) + ' done ' + now.runs_done);
    }, 'REPEAT-500 (S41, 24 Oct): POST /api/repeat answers 500 because lib/repeat-supply.js:357 selects h.current_status, which chit_header does not have; owner cb-orders');
  } finally { await pg.end(); }
  finish('suppliers-truth', process.env.SUPPLIERS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('suppliers truth could not run:', e && e.message); process.exit(2); });
