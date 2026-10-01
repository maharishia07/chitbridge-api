/**
 * tests/goods-in-accepts.test.cjs — GOODS-IN TICKS THE SAME FACT AS INTAKE (the two-sided counter bill, Athi 2026-10-01).
 *
 * *"One fact, three doors: the chit's step is the fact; Intake, goods-in and the ledger's Waiting all show and drive the same
 * transition."* Goods-in recorded the delivered lines (POST /:chit_id/deliver-lines) and never moved the bill, so a buyer who
 * counted the goods in still had a bill "waiting for you to confirm the goods were received".
 *
 *   · the BUYER records every line of a bill they RECEIVED → their copy moves to `accepted` through moveStatus — the SAME
 *     function PUT /:chit_id/status runs (one UPDATE of their own received copy, the timeline row, the ledger hook)
 *   · a part delivery moves nothing; an already-accepted bill moves nothing (idempotent — no second UPDATE, no second post)
 *   · the SELLER recording a despatch against its own bill moves nothing; nor does any chit that is not a bill I received
 *   · PUT /:chit_id/status still answers exactly as before (moveStatus is its body, lifted)
 * No database. Run: node tests/goods-in-accepts.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
let ME = CUST, STATUS = 'pending', UPDATES = [], SENDER = SHOP, TASK_ROWS = [], HEADS = [];

function rowsFor(sql, p) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/SELECT current_status FROM chit_status/.test(s)) return [{ current_status: STATUS }];
  if (/UPDATE chit_status SET current_status = \$1/.test(s)) { UPDATES.push([p[2], p[0]]); STATUS = p[0]; return []; }
  if (/SELECT sender_entity_id FROM chit_header/.test(s)) return [{ sender_entity_id: SENDER }];
  if (/SELECT h\.chit_id, d\.line_items, h\.business_json/.test(s)) return TASK_ROWS;
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity', display_name: ME === CUST ? 'Chola Auto Care' : 'Mayur Traders' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

/* the delivery itself is lib/deliverline's (tested on its own); here it reports how many lines are now complete */
const DL = require(path.join(API, 'lib', 'deliverline'));
let LINES = 2, DONE = 2;
DL.record = async (e, c, rows) => ({ ok: true, delivered: (Array.isArray(rows) ? rows : [rows]).map((r) => ({ line_id: r.line_id, quantity: r.quantity })) });
DL.progress = async () => new Map();
DL.summarise = () => ({ lines: LINES, complete: DONE, started: DONE, none: LINES - DONE, partial: 0 });
const TC = require(path.join(API, 'lib', 'tax-copy'));
let HDR = null;
TC.copyOf = async (chit_id, me) => HDR && Object.assign({}, HDR, { current_status: STATUS });
const hooks = require(path.join(API, 'lib', 'books-hooks'));
let HEARD = [];
hooks.afterChit = (e, c) => { HEARD.push(String(e)); return Promise.resolve({}); };
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}

require(path.join(API, 'lib', 'select')).rows = async () => HEADS;

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/till', require(path.join(API, 'routes', 'till')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const counterBill = { bill_no: 'C1/26-27/0041', till: { id: 'C1' }, billed_at: '2026-10-01T05:00:00.000Z', customer: { name: 'Chola Auto Care', entity_id: CUST } };
const hdr = (o) => Object.assign({ chit_id: 'cb1', sender_entity_id: SHOP, purpose: 'order', business_json: counterBill, all_recipients: [] }, o || {});

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}/api/chits`;
  const deliver = async () => {
    UPDATES = []; HEARD = [];
    const r = await fetch(base + '/cb1/deliver-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ line_id: 'l1', quantity: 2, unit: 'piece', reference: 'GRN-7' }, { line_id: 'l2', quantity: 1, unit: 'piece', reference: 'GRN-7' }] }) });
    await new Promise((res) => setTimeout(res, 30));
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    console.log('\n══ GOODS-IN TICKS THE SAME FACT ══\n');
    ME = CUST; SENDER = SHOP; STATUS = 'pending'; HDR = hdr(); LINES = 2; DONE = 2;
    const a = await deliver();
    ok('the buyer records every line of a counter bill they received → 200', a.status === 200, a.status + ' ' + JSON.stringify(a.body));
    ok('…their copy moves to accepted — ONE update of their OWN received copy', UPDATES.length === 1 && UPDATES[0][0] === CUST && UPDATES[0][1] === 'accepted', JSON.stringify(UPDATES));
    ok('…the answer says so (accepted: true)', a.body.accepted === true, JSON.stringify(a.body));
    ok('…and the ledger hears it from the buyer (the purchase posts behind acceptance)', HEARD.indexOf(CUST) >= 0, JSON.stringify(HEARD));

    const again = await deliver();
    ok('recorded again (a correction, a replayed queue): already accepted → nothing moves, nothing posts twice', again.status === 200 && UPDATES.length === 0 && HEARD.length === 0 && !again.body.accepted,
      JSON.stringify([UPDATES, HEARD, again.body.accepted]));

    STATUS = 'pending'; DONE = 1;
    const part = await deliver();
    ok('one line of two received → nothing moves (a part delivery is not acceptance)', part.status === 200 && UPDATES.length === 0 && !part.body.accepted, JSON.stringify(UPDATES));

    DONE = 2; STATUS = 'rejected';
    const rej = await deliver();
    ok('a bill the buyer REJECTED is not accepted behind their back by a later goods-in', UPDATES.length === 0 && !rej.body.accepted, JSON.stringify(UPDATES));

    STATUS = 'delivered'; ME = SHOP; SENDER = SHOP;
    const seller = await deliver();
    ok('the SELLER recording a despatch against its own bill moves nothing', seller.status === 200 && UPDATES.length === 0 && !seller.body.accepted, JSON.stringify(UPDATES));

    ME = SHOP; SENDER = CUST; STATUS = 'pending'; HDR = hdr({ sender_entity_id: CUST, business_json: {} });
    const order = await deliver();
    ok('a storefront ORDER the shop received and fulfilled is not "accepted" by goods-in (it is not a bill I bought)', UPDATES.length === 0 && !order.body.accepted, JSON.stringify(UPDATES));

    ME = CUST; SENDER = SHOP; STATUS = 'pending'; HDR = hdr({ purpose: 'invoice', business_json: { invoice_no: 'INV-9' } });
    const inv = await deliver();
    ok('a supplier INVOICE received in full is accepted the same way (the ledger gates it the same way)', UPDATES.length === 1 && UPDATES[0][1] === 'accepted' && inv.body.accepted === true, JSON.stringify(UPDATES));

    /* Intake's door is unchanged */
    ME = CUST; STATUS = 'pending'; UPDATES = []; HEARD = [];
    const put = await fetch(base + '/cb1/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'accepted' }) });
    const pb = await put.json(); await new Promise((res) => setTimeout(res, 30));
    ok('PUT /status accepted (Intake) answers as before: 200, previous pending → accepted', put.status === 200 && pb.previous_status === 'pending' && pb.new_status === 'accepted', JSON.stringify(pb));
    ok('…one update, and the ledger hears it', UPDATES.length === 1 && HEARD.indexOf(CUST) >= 0, JSON.stringify([UPDATES, HEARD]));
    const put2 = await fetch(base + '/cb1/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'accepted' }) });
    const pb2 = await put2.json();
    ok('…again: the idempotent no-op it always was', put2.status === 200 && pb2.noop === true, JSON.stringify(pb2));
    STATUS = 'completed';
    const put3 = await fetch(base + '/cb1/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'rejected' }) });
    const pb3 = await put3.json();
    ok('…and an invalid move is still a 400 that names what is allowed', put3.status === 400 && Array.isArray(pb3.allowed_transitions), put3.status + ' ' + JSON.stringify(pb3));

    /* the counter's goods-in list: the supplier's bill is goods to count in; my own counter sale is not */
    ME = CUST;
    const line = [{ line_id: 'l1', particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59 }];
    HEADS = [{ chit_id: 'cb1', direction: 'received', purpose: 'order', sender_entity_id: SHOP, created_at: '2026-10-01T05:00:01Z', manual_subject: 'Counter sale C1/26-27/0041', counterparty_name: 'Mayur Traders' },
             { chit_id: 'mine', direction: 'received', purpose: 'order', sender_entity_id: CUST, created_at: '2026-10-01T06:00:00Z', manual_subject: 'Counter sale C1/26-27/0007' }];
    TASK_ROWS = [{ chit_id: 'cb1', line_items: line, business_json: counterBill }, { chit_id: 'mine', line_items: line, business_json: { bill_no: 'C1/26-27/0007', till: { id: 'C1' }, customer: { name: 'Walk-in' } } }];
    const rcv = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/till/tasks?kind=receive`)).json();
    ok('goods-in (receive) lists the supplier\'s counter bill sent to me, with what is left to count', rcv.count === 1 && rcv.tasks[0].chit_id === 'cb1' && rcv.tasks[0].lines[0].remaining === 2, JSON.stringify(rcv));
    const dsp = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/till/tasks?kind=despatch`)).json();
    ok('…and neither it nor my own counter sale is a despatch task', dsp.count === 0, JSON.stringify(dsp));
  } catch (e) { fail++; console.log('   FAIL the test ran   ' + (e && e.stack)); }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
