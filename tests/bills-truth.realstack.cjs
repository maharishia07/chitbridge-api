'use strict';
/**
 * tests/bills-truth.realstack.cjs — UNPAID BILLS TRUTH on the LOCAL stack (T2, real Postgres): R124 a paper bill received at the counter from a
 * LOCAL supplier names the SUPPLIER and THEIR number, on the folder row and on the pay sheet.
 *
 * Library cases BKS011 (Accounts › Unpaid bills) + BIL002 · walk rows R124 (P1) and R123 (P2), docs/walks/WALK-2026-10-24.md. The walk saw both of
 * Sri Ganesh Provisions' bills listed as SUPPLIER "kaveri-tiffins" (the shop itself) with BILL NO "—", and the pay sheet naming a chit id:
 *   BL-01 the Unpaid bills › Received row (system folder B-2100) names the supplier and SG-1021, and its counterparty_id is the supplier's id
 *   BL-02 (R123) after accepting, the pay sheet's bills table (POST /payments/preview) names SG-1021, never the chit id
 *   BL-03 a receipt WITHOUT their bill stays a goods receipt: not in Unpaid bills, and the shop's own sale still names its customer (nothing issued changed)
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/bills-truth.realstack.cjs   (one realstack file at a time; API_BASE / TRUTH_DB as the harness says)
 * CARD 16-finance/payables
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, receipt, bill, freshShop, finish } = H;
const RUN = 'bl' + (Date.now() % 1e10).toString(36);
const THEIRS = 500; /* 10 kg at their ₹50, their total agrees with the count */
let pg = null;

/** poll a read until `pick` returns something, for at most ms (the hook posts after the chit's commit, never awaited by the route) */
async function until(read, pick, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await read(), got = pick(r);
    if (got || Date.now() > end) return got || null;
    await pause(250);
  }
}
const chitIdOf = (sent) => sent.chit_id || (sent.chit && sent.chit.chit_id);
/** the system folder by its ledger code (GET /api/folders → folders[]; B-2100 Bills received, B-1300 Bills issued) */
async function folderByCode(shop, code) {
  const f = ok(await j('/api/folders', { token: shop.token }), 'folders').b;
  return (f.folders || []).find((x) => x.code === code) || null;
}
/** one row of a system folder's open members, by chit id */
async function folderRow(shop, folder, chit) {
  const m = ok(await j('/api/folders/' + folder.folder_id + '/chits?state=all', { token: shop.token }), 'folder chits').b;
  return (m.chits || []).find((x) => String(x.chit_id) === String(chit)) || null;
}

(async () => {
  console.log('\n── bills truth (R124 · BKS011) on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Bills truth');
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');
    const supName = 'Sri Ganesh ' + RUN;
    const sup = ok(await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { name: supName, supply_kind: 'resale' } }), 'local supplier').b.supplier;
    const PID = sup.supplier_entity_id;
    const rice = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice ' + RUN, unit: 'kg', price: 60 } } }), 'product').b.item;
    const RICE = { id: rice.item_id, name: 'Rice ' + RUN, unit: 'kg', price: 60 };
    /* the counter's Receive form with the supplier PICKED from the list (party_id + name) and their bill no. and total typed (F10) */
    const chit = receipt(RUN + '-G1', [[RICE, 10, 50, 'kg']]);
    chit.business_json.party = { name: supName, party_id: PID };
    chit.business_json.their_bill = { no: 'SG-1021', date: new Date().toISOString().slice(0, 10), total: THEIRS };
    chit.business_json.input_tax = { inclusive: false, vendor_state: null };
    chit.line_items.forEach((line) => { line.gst_rate = 0; });
    const CHIT = chitIdOf(ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: chit }), 'paper bill received').b);
    expect(CHIT, 'no chit id for the receipt');
    const RECEIVED = await folderByCode(A, 'B-2100');
    expect(RECEIVED, 'no Bills received folder (B-2100) in GET /api/folders');

    await kase('BL-01', 'Unpaid bills › Received names the SUPPLIER (not the shop) and THEIR number SG-1021; the row\'s counterparty_id is the supplier\'s', async () => {
      const row = await until(() => folderRow(A, RECEIVED, CHIT), (r) => r);
      expect(row, 'the receipt is not in Bills received (their bill no. AND total make it a supplier bill)');
      expect(row.counterparty_name === supName, 'SUPPLIER column: ' + JSON.stringify(row.counterparty_name) + ' (expected ' + supName + '; the walk saw the shop\'s own name)');
      expect(row.bill_no === 'SG-1021', 'BILL NO column: ' + JSON.stringify(row.bill_no) + ' (expected SG-1021; the walk saw "—")');
      expect(String(row.counterparty_id) === String(PID), 'counterparty_id ' + row.counterparty_id + ' (expected the supplier ' + PID + ')');
      return row.counterparty_name + ' · ' + row.bill_no;
    });

    await kase('BL-02', 'R123: after Accept, the pay sheet\'s bills table names SG-1021 — never the chit id', async () => {
      ok(await j('/api/chits/' + CHIT + '/status', { method: 'PUT', token: A.token, body: { status: 'accepted' } }), 'accept');
      const open = await until(() => j('/api/books/dues?side=supplier&finance=1', { token: A.token }), (d) => (((d.b && d.b.parties) || []).find((p) => String(p.party_id) === String(PID)) || {}).balance_minor ? true : null);
      expect(open, 'the supplier never got a balance after the accept');
      const pv = ok(await j('/api/books/payments/preview', { method: 'POST', token: A.token, body: { party_id: PID, direction: 'out', amount_minor: THEIRS * 100, currency: 'INR' } }), 'pay preview').b;
      const rows = pv.proposal || [];
      expect(rows.length === 1 && String(rows[0].against_ref) === String(CHIT), 'proposal ' + JSON.stringify(rows).slice(0, 200) + ' (expected one bill, its ref the chit id)');
      expect(rows[0].bill_no === 'SG-1021', 'BILL column: ' + JSON.stringify(rows[0].bill_no) + ' (expected SG-1021; the walk saw the raw chit id)');
      return rows[0].bill_no + ' for ' + rows[0].open_minor;
    });

    await kase('BL-03', 'a goods receipt WITHOUT their bill stays out of Unpaid bills; the shop\'s own counter sale still names its CUSTOMER (nothing issued changed)', async () => {
      const plain = receipt(RUN + '-G2', [[RICE, 2, 50, 'kg']]);
      plain.business_json.party = { name: supName, party_id: PID };
      const PLAIN = chitIdOf(ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: plain }), 'goods receipt').b);
      const sale = bill(RUN + '-S1', [[RICE, 1]]);
      sale.business_json.customer = { name: 'Ravi Stores ' + RUN };
      const SALE = chitIdOf(ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: sale }), 'counter sale').b);
      const ISSUED = await folderByCode(A, 'B-1300');
      expect(ISSUED, 'no Bills issued folder (B-1300)');
      const saleRow = await until(() => folderRow(A, ISSUED, SALE), (r) => r);
      expect(saleRow && saleRow.counterparty_name === 'Ravi Stores ' + RUN && saleRow.bill_no === RUN + '-S1', 'issued row ' + JSON.stringify(saleRow && { who: saleRow.counterparty_name, no: saleRow.bill_no }));
      await pause(500);
      const stray = await folderRow(A, RECEIVED, PLAIN);
      expect(!stray, 'a receipt with no their_bill is listed in Unpaid bills: ' + JSON.stringify(stray && { who: stray.counterparty_name, no: stray.bill_no }));
      return 'sale → ' + saleRow.counterparty_name + ' · ' + saleRow.bill_no;
    });
  } finally {
    await pg.end();
  }
  finish('bills-truth', process.env.BILLS_TRUTH_JSON);
})().catch((e) => { console.error('FAIL (threw): ' + (e && e.stack || e)); process.exit(1); });
