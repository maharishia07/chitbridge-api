/**
 * tests/fin51-payment-safe-repeat.test.cjs — FIN-51: POST /api/chits/:chit_id/payment ("Mark paid") is SAFE TO REPEAT.
 *
 * A retry after a lost answer must record the payment once and get the same answer. The door now sits behind the ONE gate the books' money
 * doors use (middleware/idempotency requireKey, bearer form, FIN-63). Held here through the real chits router, the real gate (with a
 * recorder standing in for the idempotency_key table), the real books-hooks.chitPaid and the in-memory ledger (no database).
 *
 * The bill: Mala's sale bill of ₹1,000 + 18% GST = ₹1,180.00 = 118,000 paise, nothing paid. Hand-computed after each step (paise):
 *   0  no Idempotency-Key                         422 IDEMPOTENCY_KEY_REQUIRED · payments 0 · paid 0       · owed 118,000
 *   1  key K1, ₹500                               200 'Payment recorded'       · payments 1 · paid 50,000  · owed 68,000
 *   2  key K1 again, same body                    200, same status AND same body (replayed) · payments 1 · paid 50,000 · owed 68,000
 *   3  key K1, another body (₹600)                422 IDEMPOTENCY_CONFLICT     · payments 1 · paid 50,000  · owed 68,000
 *   4  key K2, ₹100, two calls AT ONCE            one 200, one 409 IDEMPOTENCY_IN_PROGRESS · payments 2 · paid 60,000 · owed 58,000
 *   5  key K2 after both finished, same body      the first answer again       · payments 2 · paid 60,000  · owed 58,000
 *   6  key K1 from ANOTHER shop, same body        its own answer (404), no replay of the first shop answer · figures unchanged
 *
 * Offline. Run: node tests/fin51-payment-safe-repeat.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
const BILL = 'c0000000-0000-4000-8000-00000000000f';
const BILL_TOTAL = 118000;
const OTHER_SHOP = '44444444-4444-4444-8444-444444444444';
let caller = SHOP; /* who signs in: the shop, or another shop sending the same key */
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: caller, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});

/** one request: { status, headers, body } */
const call = (port, p, body, key) => new Promise((done) => {
  const b = JSON.stringify(body);
  const headers = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }, key ? { 'Idempotency-Key': key } : {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers }, (res) => {
    let raw = '';
    res.on('data', (c) => (raw += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* a non-JSON answer reads as {} and fails the check that looks at it */ } done({ status: res.statusCode, headers: res.headers, body: j }); });
  });
  r.end(b);
});

/** the idempotency_key table as a recorder: the SQL middleware/idempotency sends, answered like Postgres would (one row per entity+key, INSERT … DO NOTHING) */
function idempotencyTable(X) {
  const rows = new Map();
  const realQuery = X.db.query;
  X.db.query = async (text, v) => {
    const sql = String(text);
    if (/UPDATE chit_header SET business_json/.test(sql)) return { rows: [{ chit_id: v[1] }] };
    if (/SELECT sender_entity_id FROM chit_header/.test(sql)) return { rows: [] }; /* RAIL-216 tellPaid: no sender row in memory, so no notice to write (that path is tests/rail-216-void-paid.test.cjs) */
    if (!/idempotency_key/.test(sql)) return realQuery(text, v);
    const slot = v[0] + '\n' + (/^\s*INSERT/.test(sql) ? v[1] : /idem_key = \$3/.test(sql) ? v[2] : v[1]);
    if (/^\s*SELECT/.test(sql)) return { rows: rows.has(slot) ? [Object.assign({ expired: false }, rows.get(slot))] : [] };
    if (/^\s*INSERT/.test(sql)) { if (rows.has(slot)) return { rows: [] }; rows.set(slot, { idem_key: v[1], req_hash: v[4], state: 'in_progress', status: null, response: null }); return { rows: [{ idem_key: v[1] }] }; }
    if (/^\s*UPDATE/.test(sql)) { Object.assign(rows.get(slot), { state: 'done', status: v[2], response: JSON.parse(v[3]) }); return { rows: [] }; }
    if (/^\s*DELETE/.test(sql)) rows.delete(slot);
    return { rows: [] };
  };
  return rows;
}

(async () => {
  console.log('\n══ FIN-51 · Mark paid is safe to repeat ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const keyRows = idempotencyTable(X);
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, {});
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-25', currency: 'INR', party: MALA, source_chit_id: BILL, source_ref: 'chit:f',
    by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
  X.T.chits.push({ chit_id: BILL, bill_no: 'C1-0050', entity_id: SHOP, purpose: 'order', business_json: { bill_no: 'C1-0050' } });

  /* the chit as the shop holds it, and who sells to whom (tax-copy), so chitPaid reaches the books exactly as in the live app */
  const TaxCopy = require(path.join(H.API, 'lib', 'tax-copy'));
  TaxCopy.entryFor = async () => ({ sells: true, buyer: { entity_id: MALA }, seller: { entity_id: SHOP }, me: { entity_id: SHOP } });
  let lagMs = 0; /* the route takes this long to read the chit, so a second call lands while the first is still running */
  TaxCopy.copyOn = async (db, chit_id, entity_id) => (await new Promise((r) => setTimeout(r, lagMs)), chit_id === BILL && entity_id === SHOP ? { chit_id: BILL, purpose: 'order', sender_entity_id: MALA, created_at: '2026-09-25T06:00:00Z', currency_code: 'INR',
    summary_json: { total_value: 1180, money: { net: 1000, tax: 180, total: 1180 } }, business_json: {} } : null);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/chits', require(path.join(H.API, 'routes', 'chits')));
  const srv = app.listen(0);
  const port = srv.address().port;
  const URL = '/api/chits/' + BILL + '/payment';

  /** the chit's figures read back from the ledger: payments recorded, paid against the bill, still owed (paise) */
  const figures = async () => {
    const paid = -X.T.items.filter((i) => i.ref_kind === 'allocation' && i.against_ref === BILL && i.ref !== BILL).reduce((t, i) => t + i.amount_minor, 0);
    const items = await X.B.partyItems(X.db, SHOP, MALA, null);
    const row = X.E.receivables().outstanding(items).by_ref[BILL];
    return { payments: X.T.payments.length, paid, owed: row ? row.outstanding_minor : null };
  };
  try {
    eq('the bill stands at ₹1,180.00 owed before anything is paid (1,000 + 18% GST = 118,000 paise)', await figures(), { payments: 0, paid: 0, owed: BILL_TOTAL });

    const bare = await call(port, URL, { method: 'upi', amount: 500, client_ref: 'press-1' });
    ok('0 · no Idempotency-Key → 422 IDEMPOTENCY_KEY_REQUIRED, in the standard problem shape', bare.status === 422 && bare.body.code === 'IDEMPOTENCY_KEY_REQUIRED', JSON.stringify(bare.body));
    eq('0 · …and nothing was recorded: 0 payments, paid 0, owed 118,000', await figures(), { payments: 0, paid: 0, owed: BILL_TOTAL });

    const body1 = { method: 'upi', amount: 500, client_ref: 'press-1' };
    const first = await call(port, URL, body1, 'K1');
    ok('1 · key K1, ₹500 → 200 "Payment recorded", not a replay', first.status === 200 && first.body.message === 'Payment recorded' && first.body.replayed === false, JSON.stringify(first.body).slice(0, 300));
    eq('1 · paid 50,000, owed 68,000 (118,000 − 50,000), 1 payment', await figures(), { payments: 1, paid: 50000, owed: 68000 });

    const again = await call(port, URL, body1, 'K1');
    ok('2 · the same key and body again → the same status', again.status === first.status, again.status + ' vs ' + first.status);
    eq('2 · …and the SAME body, byte for byte (the first answer, not a second "Already recorded")', again.body, first.body);
    ok('2 · …marked as a replay for the outbox (X-Idempotent-Replay: true)', again.headers['x-idempotent-replay'] === 'true');
    eq('2 · still 1 payment, paid 50,000, owed 68,000', await figures(), { payments: 1, paid: 50000, owed: 68000 });

    const other = await call(port, URL, { method: 'upi', amount: 600, client_ref: 'press-1' }, 'K1');
    ok('3 · key K1 with another body (₹600) → 422 IDEMPOTENCY_CONFLICT, the standard conflict answer', other.status === 422 && other.body.code === 'IDEMPOTENCY_CONFLICT', other.status + ' ' + JSON.stringify(other.body).slice(0, 300));
    eq('3 · …nothing moved: 1 payment, paid 50,000, owed 68,000', await figures(), { payments: 1, paid: 50000, owed: 68000 });

    const body2 = { method: 'cash', amount: 100, client_ref: 'press-2' };
    lagMs = 150;
    const [a, b] = await Promise.all([call(port, URL, body2, 'K2'), call(port, URL, body2, 'K2')]);
    lagMs = 0;
    const statuses = [a.status, b.status].sort();
    ok('4 · two calls at once with one key → one runs (200), the other waits out (409 IDEMPOTENCY_IN_PROGRESS)',
      statuses.join() === '200,409' && [a, b].some((r) => r.status === 409 && r.body.code === 'IDEMPOTENCY_IN_PROGRESS'), JSON.stringify([a.status, b.status, a.body.code, b.body.code]));
    eq('4 · exactly 2 payments in all (K1 + K2), paid 60,000, owed 58,000', await figures(), { payments: 2, paid: 60000, owed: 58000 });

    const winner = [a, b].find((r) => r.status === 200);
    const late = await call(port, URL, body2, 'K2');
    ok('5 · K2 sent again after both finished → the first answer', late.status === 200 && JSON.stringify(late.body) === JSON.stringify(winner.body), JSON.stringify(late.body).slice(0, 300));
    eq('5 · still 2 payments, paid 60,000, owed 58,000', await figures(), { payments: 2, paid: 60000, owed: 58000 });
    caller = OTHER_SHOP;
    const foreign = await call(port, URL, body1, 'K1');
    caller = SHOP;
    ok('6 · another shop sending the same key K1 and body gets its own answer (404, the bill is not its), never the first shop recorded answer', foreign.status === 404 && foreign.headers['x-idempotent-replay'] !== 'true' && JSON.stringify(foreign.body) !== JSON.stringify(first.body), foreign.status + ' ' + JSON.stringify(foreign.body).slice(0, 200));
    eq('6 · …and the first shop figures did not move: 2 payments, paid 60,000, owed 58,000', await figures(), { payments: 2, paid: 60000, owed: 58000 });
    ok('the store holds one row per key: K1 and K2 (and the keyless call took none; the other shop try is its own row)', keyRows.size === 3, 'rows ' + keyRows.size);
  } finally { srv.close(); }

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
