'use strict';
/**
 * tests/suppliers-truth.realstack.cjs — SUPPLIERS / P2P TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §7; OPS-14 / TB-STOCK-7).
 *
 * The six uncovered rows (SU-14 is a new row for the replay door): SU-01 short delivery is flagged · SU-02 a rail invoice counted in raises stock · SU-06 a rejected bill moves no stock ·
 * SU-08 an issue sent twice (no ref) is one row · SU-12 a rail supplier must be on my list to be billed through (a stranger's bill waits, it does not post) ·
 * SU-13 an off-list invoice is SAID to me, not silent. A `gap:` FAIL is a RECORDED finding (OPERATIONS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here.
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
  return { token: v.token, bridge: v.entity.bridge_id };
}
const invoiceFrom = async (S, buyerBridge, buyerName, ref, name, qty) => ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ display_name: buyerName, bridge_id: buyerBridge, kind: 'to' }],
  purpose: 'invoice', subject: 'Invoice ' + ref, manual_subject: 'Invoice ' + ref, client_ref: ref, business_json: { bill_no: ref, billed_at: new Date().toISOString() },
  line_items: [{ particulars: name, quantity: qty, unit: 'piece', price: 20, total: qty * 20 }] } }), 'supplier sends ' + ref).b;
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
  } finally { await pg.end(); }
  finish('suppliers-truth', process.env.SUPPLIERS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('suppliers truth could not run:', e && e.message); process.exit(2); });
