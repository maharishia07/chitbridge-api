/**
 * tests/fin-chit-books-agree.test.cjs — M7a (FIN-80, FIN-66, FIN-56, 12 Nov 2026): the chit and the books agree about a payment.
 * Hand-computed, money in minor units WITH currency (INR, 2 decimals: Rs 3,540.00 = 354000):
 *   FIN-80  a withdrawn bill (status cancelled; rejected too) takes no Mark-paid: 409 CHIT_VOIDED, the books are not asked, the copy is not stamped
 *           (on main: 200, the copy stamped paid while the books answered { none }); a live bill still marks paid.
 *   FIN-66  a Mark-paid the books could not post waits in books_outbox WITH its press marker; "Mark unpaid" then closes THAT row (done_at set, no
 *           open press row left) and never the bill's own wait nor another chit's row (on main: the press row stays open and the retry books it).
 *   FIN-56  limit 10,000.00 (1000000), posted owed 6,000.00 (600000), a pending outbox bill 3,000.00 (300000), the new bill 2,000.00 (200000):
 *           600000 + 300000 + 200000 = 1100000 > 1000000 → over, after_minor 1100000 (on main: 800000, not over). The bill's own retry row is not
 *           counted twice (its client_ref is passed), a Mark-paid press row is not a bill, and a pending bill in USD beside an INR bill is REFUSED, never converted.
 * The SQL of the pending read is pinned by clause (done_at IS NULL, press, client_ref, status) — it is UNRUN against a real Postgres here (S41 integration job).
 * Offline: the real chits router, the in-memory books harness, the real finance-terms. Run: node tests/fin-chit-books-agree.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const BILL = 'c0000000-0000-4000-8000-00000000000f';
const OTHER = 'c0000000-0000-4000-8000-0000000000aa';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const headers = { 'Idempotency-Key': 'K' + Math.random().toString(36).slice(2), 'Content-Type': 'application/json' };
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
    let raw = ''; res.on('data', (c) => (raw += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* reads as {} */ } done({ status: res.statusCode, body: j }); });
  });
  r.end(body ? JSON.stringify(body) : undefined);
});

/** the pending-credit half (FIN-56): real lib/finance-terms, a fake handle that answers the waiting-bills read */
async function creditHalf() {
  console.log('\n── FIN-56 · the credit limit counts bills waiting in the outbox ──');
  const T = require('../lib/finance-terms'), schema = require('../lib/schema'), D = require('../db'), hooks = require('../lib/books-hooks'), B = require('../lib/books');
  const E = require('../lib/books-engines');
  schema.hasColumn = async () => false;
  schema.hasTable = async () => true;
  let waitingRows = [], waitingAsked = [];
  const handle = { query: async (text, values) => {
    if (/FROM chit_header h/.test(String(text))) { waitingAsked.push({ text: String(text), values }); return { rows: waitingRows }; }
    return { rows: [{ credit_days: null, credit_limit_minor: '1000000' }] };
  } };
  D.withEntity = async (e, fn) => fn(handle);
  hooks.isOn = async () => ({ enabled: true, country: 'IN', functional_currency: 'INR' });
  B.controlOf = async () => ({ account_id: 'A' });
  B.partyItems = async () => [{ party_id: 'C1' }];
  E.receivables = () => ({ outstanding: () => ({ by_party: { C1: 600000 } }) }); /* the posted owed: Rs 6,000.00, the engine's own carried figure */
  const bill = (amount, extra) => Object.assign({ currency: 'INR', customer: { entity_id: 'C1' }, client_ref: 'NEW-1', payment: { parts: [{ how: 'On credit', amount }] } }, extra || {});
  const pending = (amount, currency) => ({ business_json: { currency, customer: { entity_id: 'C1' }, payment: { parts: [{ how: 'On credit', amount }] } } });

  waitingRows = [];
  let answer = await T.creditSaleCheck('E1', bill(2000));
  ok('nothing waiting: 600000 + 200000 = 800000 is inside 1000000 → not over', answer.over === false, JSON.stringify(answer));
  waitingRows = [pending(3000, 'INR')];
  answer = await T.creditSaleCheck('E1', bill(2000));
  ok('Rs 3,000.00 waiting in the outbox: 600000 + 300000 + 200000 = 1100000 > 1000000 → over, after_minor 1100000, owed 900000',
    answer.over === true && answer.after_minor === 1100000 && answer.owed_minor === 900000 && answer.limit_minor === 1000000 && answer.currency === 'INR', JSON.stringify(answer));
  waitingRows = [pending(3000, 'INR')];
  answer = await T.creditSaleCheck('E1', bill(1000));
  ok('the same Rs 3,000.00 waiting, a new Rs 1,000.00: 600000 + 300000 + 100000 = 1000000 is AT the limit, not over', answer.over === false, JSON.stringify(answer));
  waitingRows = [pending(3000, 'USD')];
  answer = await T.creditSaleCheck('E1', bill(2000));
  ok('a waiting bill in USD beside an INR bill is refused (mismatch named), never converted', answer.mismatch && /USD and INR cannot be combined/.test(answer.mismatch) && answer.over === false, JSON.stringify(answer));
  const asked = waitingAsked[waitingAsked.length - 1];
  ok('the read passes the shop, the customer and the bill\'s own client_ref (its own parked row is left out)', asked.values[0] === 'E1' && asked.values[1] === 'C1' && asked.values[2] === 'NEW-1', JSON.stringify(asked.values));
  ok('the read takes open rows only (done_at IS NULL), leaves a Mark-paid press row and withdrawn bills out',
    /done_at IS NULL/.test(asked.text) && /event->>'press', ''\) = ''/.test(asked.text) && asked.text.includes("$3 = '' OR COALESCE(h.business_json->>'client_ref'") /* a bill with no client_ref must not drop every waiting bill that has none */ && /NOT IN \('cancelled', 'rejected'\)/.test(asked.text), asked.text.slice(0, 300));
  waitingRows = [pending(3000, 'INR')];
  hooks.isOn = async () => null;
  ok('ledger off: no check, as before', (await T.creditSaleCheck('E1', bill(2000))).over === false);
  await overrideHalf(T);
  const route = require('../tools/chits-files.cjs').read(path.join(__dirname, '..')) /* the ONE list of chits files */;
  ok('/send stamps the client_ref BEFORE the check', route.indexOf('stampBillFacts(business_json, client_ref, number_check);') > 0 && route.indexOf('stampBillFacts(business_json, client_ref, number_check);') < route.indexOf("if (!req.body.is_draft && purpose === 'order'"));
}

/** the /send credit gate with a currency mismatch: 409 CURRENCY_MISMATCH without the owner's override, accepted with it (as OVER_LIMIT) */
async function overrideHalf(T) {
  console.log('\n── mismatch sits behind the owner override ──');
  const chits = require(path.join(H.API, 'routes', 'chits'));
  T.creditSaleCheck = async () => ({ over: false, mismatch: 'A bill waiting for the books: USD and INR cannot be combined.' });
  const reply = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, type() { return this; }, set() { return this; }, setHeader() { return this; } });
  const send = async (override, till) => {
    const res = reply();
    const business_json = { currency: 'INR', customer: { entity_id: 'C1' }, payment: { parts: [{ how: 'On credit', amount: 2000 }] } };
    if (override) business_json.credit_override = override;
    await chits.sendCredit({ sender_id: SHOP, client_ref: 'D-1', number_check: null, purpose: 'order', business_json }, { body: {}, identity: { identity_id: 'U9', parent_entity_id: SHOP, identity_type: 'person' }, till }, res);
    return { res, business_json };
  };
  const refused = await send(null, { kind: 'key', counter: true });
  ok('a drained bill with a mismatch and NO override → 409 CURRENCY_MISMATCH', refused.res.code === 409 && refused.res.body && refused.res.body.code === 'CURRENCY_MISMATCH', JSON.stringify(refused.res.body));
  const allowed = await send({ by: 'Owner' }, { kind: 'key', counter: true });
  ok('the same bill with a valid owner override (counter key) → accepted, nothing answered, client_ref stamped', allowed.res.code === null && allowed.business_json.client_ref === 'D-1', String(allowed.res.code));
  const unproven = await send({ by: 'Owner' }, { kind: 'key', counter: false });
  ok('an override that is not a counter key or the owner is still refused', unproven.res.code === 409, String(unproven.res.code));
}

(async () => {
  console.log('\n══ M7a · the chit and the books agree ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const idem = require('../middleware/idempotency');
  require.cache[require.resolve('../middleware/idempotency')].exports = Object.assign({}, idem, { requireKey: () => (req, res, next) => next() }); /* the gate has its own tests (fin51, idem3) */
  const schema = require('../lib/schema');
  schema.hasTable = async () => true;
  const taxCopy = require('../lib/tax-copy');
  const hooks = require('../lib/books-hooks');
  let status = 'accepted', stamps = 0, booksAsked = 0, booksAnswer = { none: true };
  taxCopy.copyOn = async () => ({ chit_id: BILL, business_json: { customer: { name: 'Mala' } }, current_status: status });
  hooks.chitPaid = async () => { booksAsked++; return booksAnswer; };
  const realQuery = X.db.query;
  X.db.query = async (text, values) => {
    if (/UPDATE chit_header SET business_json = COALESCE\(business_json, '\{\}'::jsonb\) \|\| jsonb_build_object\('payment'/.test(String(text))) { stamps++; return { rows: [{ chit_id: values[1] }] }; }
    if (/UPDATE chit_header SET business_json = COALESCE\(business_json, '\{\}'::jsonb\) - 'payment'/.test(String(text))) return { rows: [{ chit_id: values[0] }] };
    if (/SELECT sender_entity_id FROM chit_header/.test(String(text))) return { rows: [] }; /* the seller's notice (RAIL-216 tellPaid) has its own test */
    return realQuery(text, values);
  };
  console.error = () => undefined;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/chits', require(path.join(H.API, 'routes', 'chits')));
  const srv = app.listen(0);
  const port = srv.address().port;
  const PAY = '/api/chits/' + BILL + '/payment';
  try {
    console.log('\n── FIN-80 · a withdrawn bill takes no Mark-paid ──');
    status = 'cancelled';
    const voided = await call(port, 'POST', PAY, { method: 'cash', amount: 3540 });
    ok('voided bill Rs 3,540.00 Mark-paid → 409 CHIT_VOIDED', voided.status === 409 && voided.body.code === 'CHIT_VOIDED', voided.status + ' ' + JSON.stringify(voided.body).slice(0, 200));
    ok('...the copy is not stamped and the books are not asked', stamps === 0 && booksAsked === 0, 'stamps ' + stamps + ' books asked ' + booksAsked);
    status = 'rejected';
    const rejected = await call(port, 'POST', PAY, { method: 'cash', amount: 3540 });
    ok('a rejected bill is the same: 409 CHIT_VOIDED, nothing stamped', rejected.status === 409 && rejected.body.code === 'CHIT_VOIDED' && stamps === 0, rejected.status + ' stamps ' + stamps);
    status = 'accepted';
    const live = await call(port, 'POST', PAY, { method: 'cash', amount: 3540 });
    ok('control: an accepted bill still marks paid (200, stamped once, books asked once)', live.status === 200 && stamps === 1 && booksAsked === 1, live.status + ' ' + JSON.stringify(live.body).slice(0, 200));

    console.log('\n── FIN-66 · Mark unpaid closes the waiting press ──');
    booksAnswer = { queued: true, why: 'That month is waiting for the owner.' };
    const queued = await call(port, 'POST', PAY, { method: 'upi', ref: 'U1', amount: 3540 });
    const mine = () => X.T.outbox.filter((row) => row.source_chit_id === BILL && !row.done_at);
    ok('a press the books could not post waits in the outbox WITH its press marker', queued.status === 200 && mine().length === 1 && mine()[0].event.press === 'payment', queued.status + ' ' + JSON.stringify(X.T.outbox));
    X.T.outbox.push({ id: 90, entity_id: SHOP, source_chit_id: BILL, source_ref: 'chit:' + BILL, event: { job: 'chit', chit_id: BILL, todo: 'accept' }, why: 'Waiting for the buyer to accept.', tries: 0, done_at: null });
    X.T.outbox.push({ id: 91, entity_id: SHOP, source_chit_id: OTHER, source_ref: 'chit:' + OTHER, event: { job: 'chit', chit_id: OTHER, press: 'payment', todo: 'record' }, why: 'x', tries: 0, done_at: null });
    X.T.outbox.push({ id: 92, entity_id: SHOP, source_chit_id: BILL, source_ref: 'chit:' + BILL, event: { job: 'chit', chit_id: BILL, press: 'payment', todo: 'record' }, why: 'A press parked before today.', tries: 0, done_at: null });
    const cleared = await call(port, 'DELETE', PAY);
    const openPress = X.T.outbox.filter((row) => row.source_chit_id === BILL && !row.done_at && row.event.press === 'payment');
    ok('Mark unpaid → 200, and no open press row is left for the bill (was 2: the press above and id 92)', cleared.status === 200 && openPress.length === 0 && X.T.outbox.find((row) => row.id === 92).done_at != null, cleared.status + ' ' + JSON.stringify(X.T.outbox));
    ok('...the bill\'s own wait (id 90) and another chit\'s press row (id 91) stay open', X.T.outbox.find((row) => row.id === 90).done_at == null && X.T.outbox.find((row) => row.id === 91).done_at == null);
  } finally { srv.close(); }
  await creditHalf();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
