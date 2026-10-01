/**
 * tests/two-sided-bill.test.cjs — THE COUNTER SENDS AN ON-RAIL CUSTOMER THEIR COPY OF THE BILL (Athi, 2026-10-01).
 *
 * *"Naming a connected customer on a credit or named bill IS the sending."* The counter now sends such a bill with
 * recipients [{ self:true, name:'self' }, { name, entity_id: <customer entity>, role:'to' }]. POST /api/chits/send:
 *
 *   · a TILL key may send it — but only a counter bill (bill number + till), purpose 'order', to ONE 'to' recipient who
 *     is the bill's own customer (business_json.customer.entity_id), on THIS shop's customer list, a business on the rail.
 *     Anything else from a till key is still refused (403) — the key lives on a shop PC anyone can pick up.
 *   · the shop keeps ONE row (its self copy, as every counter bill today): a numbered document appears once in a shop's
 *     books (b263) — a second, 'sent' row would trip the unique index and the counter could not sell.
 *   · the customer's copy is written exactly as compose writes a 'to' copy: direction received, role Act, status pending
 *     (Intake: accept / dispute). It carries the bill (bill_no, till, customer) but NOT client_ref — that is the SHOP's
 *     replay key, and on the customer's copy it would collide with the customer's own counter numbering (C1/26-27/0041
 *     at both shops) under the same unique index, and fail the whole send.
 *   · the lines are not re-rated or re-priced (REV-02: billed_at); the ledger hears from BOTH sides.
 *   · a replay of the same bill number answers the first chit and writes nothing (idempotent with two recipients).
 *   · a walk-in bill is exactly what it was: one self copy.
 * No database: db, auth and the delivery are stubbed; the route is the real one.
 * Run: node tests/two-sided-bill.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '33333333-3333-4333-8333-333333333333', STRANGER = '44444444-4444-4444-8444-444444444444';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Mayur Traders', country: 'IN', gstn: '33AAAAA0000A1Z5', status: 'active' },
  [CUST]: { identity_id: CUST, bridge_id: 'CB-CUST', display_name: 'Chola Auto Care', country: 'IN', gstn: '33BBBBB0000B1Z5', status: 'active' },
  [STRANGER]: { identity_id: STRANGER, bridge_id: 'CB-STRG', display_name: 'Some Other Business', country: 'IN', status: 'active' },
};
/* the shop's customer list, and who on it is a business on the rail (OUTSIDE is on the list, but a local ~ record) */
const LIST = { [CUST]: { rail: true }, [OUTSIDE]: { rail: false } };
let REPLAY = null, SQL = [];

let LISTED = [];
function rowsFor(sql, p) {
  const s = String(sql);
  SQL.push(s.replace(/\s+/g, ' ').trim());
  if (/INSERT INTO customer_list/.test(s)) { LISTED.push([String(p && p[0]), String(p && p[1])]); return []; }
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return REPLAY ? [REPLAY] : [];
  if (/FROM customer_list/.test(s) && /customer_identity_id = \$2/.test(s)) {
    const l = LIST[p && p[1]];
    return l && l.rail && /identity_type = 'entity'/.test(s) ? [{ ok: 1 }] : [];
  }
  if (/FROM supplier_list/.test(s)) return [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p && p[0]]; return r ? [r] : []; }
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
let KEY = { scopes: ['till'] };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Mayur Traders' }; if (KEY) req.api_key = KEY; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => { COPIES = copies; return { ok: true }; };
const hooks = require(path.join(API, 'lib', 'books-hooks'));
let HEARD = [];
hooks.afterChit = (e, c) => { HEARD.push(String(e)); return Promise.resolve({}); };
try { require(path.join(API, 'lib', 'meter')).meter = async () => {}; } catch (_) {}
let SHELVES = [];
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async (eid) => { SHELVES.push(String(eid)); return null; };
try { require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] }); } catch (_) {}

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const lines = [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118, gst_rate: 18, hsn: '8708' }];
const bill = (no, customer, extra) => Object.assign({
  purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
  business_json: { customer, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: '2026-10-01T05:00:00.000Z',
    payment: { mode: 'On credit', paid: 0, parts: [{ how: 'On credit', amount: 118 }] }, slip: 'cash', terms: { credit_days: 15, due_date: '2026-10-16' } },
  line_items: lines.map((l) => Object.assign({}, l)),
}, extra || {});
const chola = { name: 'Chola Auto Care', phone: '9840012345', identity_id: CUST, entity_id: CUST };
const toCust = { name: 'Chola Auto Care', entity_id: CUST, role: 'to', self: false };
const SELF = { self: true, name: 'self' };

const srv = app.listen(0, '127.0.0.1', async () => {
  const send = async (body) => {
    COPIES = null; HEARD = []; SQL = []; LISTED = []; SHELVES = [];
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await new Promise((res) => setTimeout(res, 30));   /* the ledger hooks run on setImmediate */
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    console.log('\n══ THE TWO-SIDED COUNTER BILL — POST /api/chits/send from a till key ══\n');
    const a = await send(bill('C1/26-27/0041', chola, { recipients: [SELF, toCust] }));
    ok('a credit bill to a rail customer from a TILL key is accepted (200)', a.status === 200, a.status + ' ' + JSON.stringify(a.body).slice(0, 200));
    const cs = COPIES || [];
    const mine = cs.filter((c) => c.entity_id === SHOP), theirs = cs.filter((c) => c.entity_id === CUST);
    ok('…the shop keeps ONE row — its self copy, as every counter bill (no second "sent" row for b263 to refuse)',
      mine.length === 1 && mine[0].direction === 'received', JSON.stringify(mine.map((c) => [c.direction, c.role, c.current_status])));
    ok('…the customer gets ONE copy: received · Act · pending (their Intake: accept / dispute)',
      theirs.length === 1 && theirs[0].direction === 'received' && theirs[0].role === 'Act' && theirs[0].current_status === 'pending',
      JSON.stringify(theirs.map((c) => [c.direction, c.role, c.current_status])));
    const tb = (theirs[0] || {}).business_json || {}, mb = (mine[0] || {}).business_json || {};
    ok('…the customer\'s copy carries the bill: its number, its till, its customer, its terms',
      tb.bill_no === 'C1/26-27/0041' && tb.till && tb.till.id === 'C1' && tb.customer && tb.customer.entity_id === CUST && tb.terms && tb.terms.due_date === '2026-10-16', JSON.stringify(tb).slice(0, 300));
    /* ⭐ THE CUSTOMER'S COPY IS NAMED FOR WHAT IT IS (Athi, 2026-10-01): a bill to accept, not a task */
    const tc = theirs[0] || {}, mc = mine[0] || {};
    ok('…the customer\'s copy is a BILL: purpose invoice (detail invoice), marked counter_bill',
      tc.purpose === 'invoice' && tc.detail_type === 'invoice' && tb.counter_bill === true, JSON.stringify([tc.purpose, tc.detail_type, tb.counter_bill]));
    ok('…its subject reads "Bill C1/26-27/0041 from Mayur Traders"', tc.manual_subject === 'Bill C1/26-27/0041 from Mayur Traders', tc.manual_subject);
    ok('…and its summary says what the list row shows: from, number, what is owed (₹118)',
      tc.summary_json && tc.summary_json.purpose === 'invoice' && JSON.stringify(tc.summary_json.bill_received) === JSON.stringify({ from: 'Mayur Traders', no: 'C1/26-27/0041', total: 118 }),
      JSON.stringify(tc.summary_json && [tc.summary_json.purpose, tc.summary_json.bill_received]));
    ok('…the SHOP\'s own copy is unchanged: purpose order, its own subject, no bill marker',
      mc.purpose === 'order' && mc.manual_subject === 'Counter sale C1/26-27/0041' && !mb.counter_bill && !(mc.summary_json || {}).bill_received,
      JSON.stringify([mc.purpose, mc.manual_subject, mb.counter_bill]));
    ok('…but NOT client_ref (the shop\'s replay key — on the customer\'s copy it collides with their own C1/26-27/0041)',
      !('client_ref' in tb), JSON.stringify(Object.keys(tb)));
    ok('…the shop\'s copy keeps client_ref (its replay key, b263)', mb.client_ref === 'C1/26-27/0041', JSON.stringify(Object.keys(mb)));
    ok('…the lines are the counter\'s, untouched on both copies (no re-rate, no re-price: REV-02)',
      [mine[0], theirs[0]].every((c) => c && c.line_items && c.line_items.length === 1 && c.line_items[0].price === 59 && c.line_items[0].total === 118 && c.line_items[0].gst_rate === 18 && !c.line_items[0].offer),
      JSON.stringify((theirs[0] || {}).line_items));
    ok('…both copies name the same parties: the shop sent it, the customer received it',
      (theirs[0] || {}).sender_entity_id === SHOP && JSON.stringify(((theirs[0] || {}).all_recipients || []).map((r) => r.entity_id)) === JSON.stringify([SHOP, SHOP, CUST]),
      JSON.stringify((theirs[0] || {}).all_recipients));
    ok('…the ledger hears from BOTH sides (the shop\'s sale, the customer\'s purchase-waiting)', HEARD.indexOf(SHOP) >= 0 && HEARD.indexOf(CUST) >= 0, JSON.stringify(HEARD));
    ok('…the SHOP sells it: only the shop\'s shelf is read for rates, never the customer\'s', SHELVES.length >= 1 && SHELVES.every((e) => e === SHOP), JSON.stringify(SHELVES));
    ok('…and the shop is never written into the CUSTOMER\'s customer list (that is what an order to a seller does)', !LISTED.some((x) => x[0] === CUST), JSON.stringify(LISTED));

    /* the gate: a till key sends a bill to its own customer on the rail, and to nobody else */
    const notList = await send(bill('C1/26-27/0042', Object.assign({}, chola, { entity_id: STRANGER, identity_id: STRANGER }), { recipients: [SELF, Object.assign({}, toCust, { entity_id: STRANGER })] }));
    ok('a till key cannot send to a business that is NOT on this shop\'s customer list (403)', notList.status === 403 && !COPIES, notList.status + ' ' + JSON.stringify(notList.body));
    const local = await send(bill('C1/26-27/0043', Object.assign({}, chola, { entity_id: OUTSIDE, identity_id: OUTSIDE }), { recipients: [SELF, Object.assign({}, toCust, { entity_id: OUTSIDE })] }));
    ok('…nor to a customer on the list who is not on the rail (a local record) (403)', local.status === 403 && !COPIES, local.status + ' ' + JSON.stringify(local.body));
    const other = await send(bill('C1/26-27/0044', Object.assign({}, chola, { entity_id: null }), { recipients: [SELF, toCust] }));
    ok('…nor to anyone the bill itself does not name as its customer (403)', other.status === 403 && !COPIES, other.status + ' ' + JSON.stringify(other.body));
    const two = await send(bill('C1/26-27/0045', chola, { recipients: [SELF, toCust, Object.assign({}, toCust, { entity_id: STRANGER })] }));
    ok('…nor to two outside parties (403)', two.status === 403 && !COPIES, two.status + ' ' + JSON.stringify(two.body));
    const cc = await send(bill('C1/26-27/0046', chola, { recipients: [SELF, Object.assign({}, toCust, { role: 'cc' })] }));
    ok('…nor as a cc (403)', cc.status === 403 && !COPIES, cc.status + ' ' + JSON.stringify(cc.body));
    const inv = await send(Object.assign(bill('C1/26-27/0047', chola, { recipients: [SELF, toCust] }), { purpose: 'invoice' }));
    ok('…nor anything that is not a counter sale (purpose invoice) (403)', inv.status === 403 && !COPIES, inv.status + ' ' + JSON.stringify(inv.body));
    const nobill = bill('C1/26-27/0048', chola, { recipients: [SELF, toCust] }); delete nobill.business_json.bill_no; delete nobill.business_json.till;
    const nb = await send(nobill);
    ok('…nor a chit with no counter bill number (403)', nb.status === 403 && !COPIES, nb.status + ' ' + JSON.stringify(nb.body));

    /* a walk-in is what it was */
    const w = await send(bill('C1/26-27/0049', { name: 'Walk-in' }, { recipients: [SELF] }));
    ok('a walk-in bill: 200, ONE copy, the shop\'s own (unchanged)', w.status === 200 && COPIES && COPIES.length === 1 && COPIES[0].entity_id === SHOP && COPIES[0].business_json.client_ref === 'C1/26-27/0049',
      w.status + ' ' + JSON.stringify((COPIES || []).map((c) => [c.entity_id, c.direction])));
    ok('…and the ledger hears from the shop only', JSON.stringify(HEARD) === JSON.stringify([SHOP]), JSON.stringify(HEARD));

    /* the same bill again: the first chit, nothing written */
    REPLAY = { chit_id: 'first-chit', till_id: 'C1', billed_at: '2026-10-01T05:00:00.000Z' };
    const rep = await send(bill('C1/26-27/0041', chola, { recipients: [SELF, toCust] }));
    ok('a replay of the two-recipient bill answers the FIRST chit (duplicate) and writes nothing', rep.status === 200 && rep.body.duplicate === true && rep.body.chit_id === 'first-chit' && !COPIES,
      rep.status + ' ' + JSON.stringify(rep.body));
    REPLAY = null;

    /* a signed-in person (no till key) sending the same shape is compose — not this gate's business */
    KEY = null;
    const app2 = await send(bill('C1/26-27/0050', chola, { recipients: [SELF, toCust] }));
    ok('signed in (not a till key), the same bill is sent the same way — one shop row, one customer copy', app2.status === 200 && COPIES && COPIES.filter((c) => c.entity_id === SHOP).length === 1 && COPIES.filter((c) => c.entity_id === CUST).length === 1,
      app2.status + ' ' + JSON.stringify((COPIES || []).map((c) => [c.entity_id, c.direction])));
    KEY = { scopes: ['till'] };
  } catch (e) { fail++; console.log('   FAIL the test ran   ' + (e && e.stack)); }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
