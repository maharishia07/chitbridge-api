/**
 * tests/ctry-77-send-route.test.cjs — CTRY-77: THE REAL SEND STEP, OVER A REAL EXPRESS APP, FOR AN AU SHOP.
 *
 * OWNS      routes/chits.js sendCashStep (the real function, the real problem renderer and error shape) driven over http: an AU live bill with an
 *           off-step cash part → 400 CASH_ROUNDING_STEP; the same bill billed 2 hours ago (an offline replay) → let through, cash_step on the chit and
 *           the answer, and the books post it as round-off (tests/support/books-harness classify); a future or 40-day-old billed_at → 400; IN → untouched.
 *           The rest of the send pipeline needs the database (the *-truth.realstack.cjs files); this is the one step this change adds, over the wire.
 * CALLED BY scripts/guards.cjs · by hand: node tests/ctry-77-send-route.test.cjs
 * FLOW      POST body ──▶ express ──▶ sendCashStep(sendState from the body, db stand-in answers the shop's country) ──▶ 400 problem | 200 {cash_step}
 * CARD      counter/bill-slip
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const IN_SHOP = '99999999-9999-4999-8999-999999999999';
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
require.cache[dbFile].exports = Object.assign({}, real, {
  query: async (sql, params) => (/FROM identities WHERE identity_id/.test(sql) ? { rows: [{ country: (params && params[0] === IN_SHOP) ? 'IN' : 'AU', gstn: null }], rowCount: 1 } : { rows: [], rowCount: 0 })
});
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== CTRY-77 · the real send step over express ==\n');
  ok('routes/chits.js exports the real sendCashStep', typeof chits.sendCashStep === 'function');
  if (typeof chits.sendCashStep !== 'function') { console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(1); }
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: req.body.sender || '11111111-1111-4111-8111-111111111111', business_json: req.body.business_json, currency_code: req.body.currency, is_draft: !!req.body.is_draft };
    if (await chits.sendCashStep(state, req, res)) return;
    if (!res.headersSent) res.json({ message: 'Chit sent successfully', cash_step: state.cashStep, business_json: state.business_json });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const bill = (billed_at, how, amount) => ({ currency: 'AUD', business_json: { bill_no: 'C1-1', till: { id: 'C1' }, billed_at, payment: { parts: [{ how: how || 'Cash', amount: amount == null ? 10.02 : amount }] } } });
  const ago = (ms) => new Date(Date.now() + ms).toISOString();
  const HOUR = 3600000, DAY = 24 * HOUR;

  let r = await post(bill(ago(-30000)));
  ok('AU live bill, cash 10.02 → 400 CASH_ROUNDING_STEP, the cite and the nearest 10.00 named', r.status === 400 && r.body.code === 'CASH_ROUNDING_STEP' && /10\.00/.test(r.body.detail || r.body.message || '') && r.body.nearest_minor === 1000, JSON.stringify(r));
  r = await post(bill(ago(-2 * HOUR)));
  ok('the same bill billed 2 hours ago (replay) → 200 with cash_step accepted:replay', r.status === 200 && r.body.cash_step && r.body.cash_step.accepted === 'replay', JSON.stringify(r));
  ok('…and recorded ON the chit (business_json.cash_step), not only on the answer', r.body.business_json && r.body.business_json.cash_step && r.body.business_json.cash_step.code === 'CASH_ROUNDING_STEP');
  r = await post(bill(ago(+2 * HOUR)));
  ok('a billed_at in the FUTURE → 400 (not a replay)', r.status === 400 && r.body.code === 'CASH_ROUNDING_STEP', JSON.stringify(r));
  r = await post(bill(ago(-40 * DAY)));
  ok('a billed_at 40 days old → 400 (backdated, not queued)', r.status === 400, JSON.stringify(r));
  r = await post(bill(undefined));
  ok('no billed_at → 400', r.status === 400, JSON.stringify(r));
  r = await post(bill(ago(-30000), 'Card', 10.02));
  ok('AU live card 10.02 → 200, nothing said', r.status === 200 && !r.body.cash_step, JSON.stringify(r));
  r = await post(bill(ago(-30000), 'Cash', 10.05));
  ok('AU live cash 10.05 → 200', r.status === 200 && !r.body.cash_step);
  r = await post(Object.assign(bill(ago(-30000)), { currency: 'INR', sender: IN_SHOP }));
  ok('IN control · live cash 10.02 → 200, untouched', r.status === 200 && !r.body.cash_step, JSON.stringify(r));
  server.close();

  /* the books post a replayed off-step bill as round-off: invoice A$10.03 (9.12 + 0.91), cash 10.02 → gap -0.01 inside the 5c step */
  const H = require('./support/books-harness.cjs');
  const X = H.load();
  if (X.src.dir) {
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const invoice = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 9.12, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 0.91, CesAmt: 0 }], ValDtls: { TotInvVal: 10.03 } };
    const out = K.classify({ chit: { chit_id: 'c1', purpose: 'order', currency_code: 'AUD', business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: { parts: [{ how: 'Cash', amount: 10.02 }] } } }, entry: { sells: true, invoice }, setting: { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' } });
    ok('books · the replayed cash 10.02 against a 10.03 invoice posts with a round-off of -0.01', out.kind === 'walkin' && out.bill && out.bill.round_off === -0.01, JSON.stringify(out).slice(0, 300));
  } else console.log('   (books leg skipped: ' + X.src.why + ')');
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
