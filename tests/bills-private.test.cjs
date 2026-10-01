/**
 * tests/bills-private.test.cjs — A BILL'S STEPS STAY WITH THE SHOP THAT TOOK THEM, AT THEIR FOLDER'S MESSAGING LEVEL.
 *
 * Athi, 2026-10-01: *"goods verified and accounted are internal status, not between two shops — internal messaging; only the
 * dispute can be a both-side message"* · *"money received, part paid, it has to be both sides"* · a messaging level per folder,
 * external · internal · none, the inventory's level a CEILING a shop may only restrict.
 *
 *   A  the levels: defaults (R-1400 external · B-2100 / B-1300 / E-6000 / RT-4090 internal · DSP external, fixed); the owner
 *      restricts (stored { on, msg }; the old 'on'/'off' string still read); a widen → 409 in a plain sentence; DSP → 409;
 *      a co-assist → 403
 *   B  writeStep: external → every party (state_log_fanout) · internal → my copy only · none → nothing at all
 *   C  a payment against a bill (moneySteps, called by the books confirm route): R-1400 · Paid ₹300 of ₹481.65 written
 *      external by default; restricted to internal it stays mine; none writes nothing
 *   D  THE SELLER'S LIFECYCLE never contains a buyer step (their status, their goods-in, fanned here before the rule); the
 *      dispute IS there (DSP) and Dispute settled; the buyer's shared payment reads "Chola Auto Care paid ₹300 · ₹181.65 due";
 *      when the buyer kept R-1400 internal there is no such row and no such line; the seller closes only on ITS ledger
 *   E  my own line at level none is not shown even if a row exists
 *   F  a status change on a bill is written as MY bill_step (internal), never fanned (no chit_log_all); any other chit still is
 *   G  goods-in on a bill is recorded on MY copy only (no chit_line_event, no state_log_fanout); any other chit still crosses
 *   H  THE SENDER'S CHIT READ of a bill: no buyer status, read time, history or delivery; the dispute and the shared payment stay
 *   I  the activity feed hides the other shop's steps on a bill (the predicate is in its SQL)
 * No database: db and auth are stubbed; the routes are the real ones.   Run: node tests/bills-private.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const RAVI = '44444444-4444-4444-8444-444444444444', BUYER_P = '99999999-9999-4999-8999-999999999999', OWNER_P = '55555555-5555-4555-8555-555555555555';
const BILL = '00000002-0000-4000-8000-000000000002', ORDER = '00000003-0000-4000-8000-000000000003';
const T0 = '2026-10-01T05:00:00.000Z', T1 = '2026-10-01T08:50:00.000Z', T2 = '2026-10-01T09:10:00.000Z', T3 = '2026-10-02T04:00:00.000Z';

let SQL = [], FLAGS = {}, ROWS = [], LOG = [], DISP = [], PI = [], PEOPLE = {}, COPY = null, CUR = 'pending', HDR = null, DELIV = [], PARTS = [], PROG = [];
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  SQL.push({ s, p });
  if (/SELECT policy_flags, self_copy_pref FROM identities/.test(s)) return [{ policy_flags: FLAGS, self_copy_pref: null }];
  if (/UPDATE identities SET policy_flags/.test(s)) { FLAGS = Object.assign({}, FLAGS, JSON.parse(p[0])); return []; }
  if (/FROM chit_status cs JOIN chit_header ch/.test(s) && /AS doc_kind/.test(s)) return ROWS;
  if (/FROM state_log sl LEFT JOIN identities i/.test(s)) return LOG.filter((l) => (p[1] || []).indexOf(l.chit_id) >= 0);
  if (/FROM chit_disputes WHERE chit_id = ANY/.test(s)) return DISP;
  if (/FROM party_item i LEFT JOIN books_payment p/.test(s)) return PI;
  if (/FROM party_item WHERE entity_id = \$1 AND against_ref = \$2/.test(s)) return [{ open_minor: -18165, bill_minor: -48165 }];
  if (/SELECT identity_id, user_id, display_name FROM identities/.test(s)) return (p[0] || []).map((id) => PEOPLE[id]).filter(Boolean);
  if (/SELECT identity_id FROM identities WHERE identity_id = ANY\(\$1::uuid\[\]\) AND parent_entity_id = \$2/.test(s)) return (p[0] || []).filter((id) => PEOPLE[id] && PEOPLE[id].parent === p[1]).map((id) => ({ identity_id: id }));
  if (/SELECT display_name FROM identities WHERE identity_id = \$1/.test(s)) return [{ display_name: p[0] === SHOP ? 'Mayur Traders' : 'Chola Auto Care' }];
  /* tax-copy copyOf / copyOn */
  if (/FROM chit_header h/.test(s) && /WHERE h.chit_id = \$1 AND h.entity_id = \$2/.test(s)) return COPY ? [Object.assign({ current_status: CUR }, COPY)] : [];
  /* moveStatus */
  if (/SELECT current_status/.test(s) && /FROM chit_status/.test(s) && /direction = 'received'/.test(s)) return [{ current_status: CUR }];
  if (/SELECT sender_entity_id, purpose, business_json FROM chit_header/.test(s)) return HDR ? [HDR] : [];
  /* the chit read */
  if (/^SELECT \* FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return HDR ? [HDR] : [];
  if (/FROM chit_detail WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return [{ detail_type: 'invoice', line_items: [{ line_id: 'l1', particulars: 'Rice', quantity: 10, unit: 'kg', price: 48.165 }] }];
  if (/FROM state_log WHERE chit_id = \$1 AND entity_id = \$2 AND action != 'read'/.test(s)) return LOG.filter((l) => l.chit_id === p[0]).map((l) => ({ action: l.action, action_by_identity_id: l.who_id, action_by_display_name: l.who_name, detail: l.detail || null, created_at: l.at }));
  if (/AS participants/.test(s) && /AS deliveries/.test(s)) return [{ participants: PARTS, amendments: [], lines: [{ line_id: 'l1', seq: 1, particulars: 'Rice', quantity: 10, unit: 'kg', price: 48.165 }], assignments: [], deliveries: DELIV }];
  /* the read's own delivery query (the redaction) — filtered only when it asks for my claims alone */
  if (/d.recorded_by_name, d.recorded_by_actor_name, d.delivered_at/.test(s)) return /AND \(d.delivery_id IS NULL OR d.recorded_by_entity_id = \$1\)/.test(s) ? DELIV.filter((d) => !d.delivery_id || d.recorded_by_entity_id === p[0]) : DELIV;
  /* deliverline progress (deliver-lines) */
  if (/FROM chit_line l LEFT JOIN chit_line_delivery d/.test(s) && /l.chit_id = \$2/.test(s)) return PROG;
  if (/SELECT chit_line_event\(/.test(s)) return [{ copies: 2 }];
  if (/SELECT COUNT\(/.test(s)) return [{ count: '0', n: 0 }];
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
let WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = Object.assign({}, WHO); next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
try { const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => true; sc.hasTable = async () => true; } catch (_) {}
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}

const fs = require('fs');
const INV = require(path.join(API, 'lib', 'folder-inventory'));
const BP = require(path.join(API, 'lib', 'bill-privacy'));
const steps = require(path.join(API, 'lib', 'bill-steps'));
const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/folders', require(path.join(API, 'routes', 'folders')));
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/notifications', require(path.join(API, 'routes', 'notifications')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const wrote = (re) => SQL.filter((x) => re.test(x.s));
const tillBill = { bill_no: 'C1/26-27/0041', till: { id: 'C1' } };
/* the SELLER's own copy of its counter bill to Chola (a rail customer) */
const sellerRow = () => ({ chit_id: BILL, current_status: 'pending', direction: 'received', folder_id: null, created_at: T0, manual_subject: 'Counter sale 41', purpose: 'order',
  sender_entity_id: SHOP, sender_entity_display_name: 'Mayur Traders', business_json: tillBill, all_recipients: [{ entity_id: SHOP }, { entity_id: SHOP }, { entity_id: CUST }],
  open_disputes: 0, doc_kind: 'bill_issued', counterparty_name: 'Chola Auto Care' });
function reset() { SQL = []; FLAGS = {}; ROWS = []; LOG = []; DISP = []; PI = []; COPY = null; CUR = 'pending'; HDR = null; DELIV = []; PARTS = []; PROG = [];
  PEOPLE = { [RAVI]: { identity_id: RAVI, user_id: 'tallytest', display_name: 'Tally Test', parent: SHOP }, [OWNER_P]: { identity_id: OWNER_P, user_id: 'mayur-owner', display_name: 'Mayur', parent: SHOP },
             [BUYER_P]: { identity_id: BUYER_P, user_id: 'chola-ravi', display_name: 'Ravi K', parent: CUST } };
  WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' }; }
const buyerPaid = (due) => JSON.stringify({ code: 'R-1400', step: 'paid', label: 'Money paid', party: 'Chola Auto Care', amount_minor: 30000, of_minor: 48165, due_minor: due, currency: 'INR' });

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, u, body) => { SQL = []; const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  try {
    console.log('\n══ A · THE MESSAGING LEVELS — a ceiling, restricted only by the owner ══\n');
    reset();
    const lv = INV.levels({});
    ok('defaults: R-1400 external · B-2100, B-1300, E-6000, RT-4090 internal · DSP external',
      [lv['R-1400'], lv['B-2100'], lv['B-1300'], lv['E-6000'], lv['RT-4090'], lv.DSP].join() === 'external,internal,internal,internal,internal,external', JSON.stringify(lv));
    const inv = await call('GET', '/api/folders/inventory');
    const row = (c) => (inv.body.rows || []).find((x) => x.code === c) || {};
    ok('the inventory says ceiling, level and choices: R-1400 external (external · internal · none), B-2100 internal (internal · none), DSP fixed',
      row('R-1400').msg_ceiling === 'external' && row('R-1400').msg_choices.join() === 'none,internal,external' && row('B-2100').msg_choices.join() === 'none,internal'
      && row('DSP').msg_fixed === true && row('DSP').msg_choices.length === 0, JSON.stringify([row('R-1400'), row('DSP')]));
    const r1 = await call('PUT', '/api/folders/inventory/R-1400', { msg: 'internal' });
    ok('the owner restricts R-1400 to internal → stored { msg: "internal" }, level internal', r1.status === 200 && FLAGS.system_folders['R-1400'].msg === 'internal'
      && INV.levels(FLAGS)['R-1400'] === 'internal', r1.status + ' ' + JSON.stringify(FLAGS));
    const w = await call('PUT', '/api/folders/inventory/B-2100', { msg: 'external' });
    ok('a widen above the ceiling → 409, in a plain sentence', w.status === 409 && w.body.code === 'MSG_ABOVE_CEILING'
      && w.body.message === 'Bills · Received can be kept internal or switched off, but not shared beyond the default.', w.status + ' ' + JSON.stringify(w.body));
    const d = await call('PUT', '/api/folders/inventory/DSP', { msg: 'internal' });
    ok('the dispute cannot be restricted → 409', d.status === 409 && d.body.code === 'MSG_FIXED', d.status + ' ' + JSON.stringify(d.body));
    WHO = { identity_id: RAVI, identity_type: 'actor', parent_entity_id: SHOP, display_name: 'Ravi' };
    ok('a co-assist cannot change a level (403)', (await call('PUT', '/api/folders/inventory/R-1400', { msg: 'none' })).status === 403);
    WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
    await call('PUT', '/api/folders/inventory/R-1400', { on: false });
    ok('switching off keeps the level beside it ({ on: false, msg: "internal" })', FLAGS.system_folders['R-1400'].on === false && FLAGS.system_folders['R-1400'].msg === 'internal', JSON.stringify(FLAGS));
    ok('the older "on"/"off" string is still read (switch off, level at its ceiling)', INV.switches({ system_folders: { 'R-1400': 'off' } })['R-1400'] === false && INV.levels({ system_folders: { 'R-1400': 'off' } })['R-1400'] === 'external');
    ok('a stored level above the ceiling is never honoured (B-2100 stays internal)', INV.levels({ system_folders: { 'B-2100': { msg: 'external' } } })['B-2100'] === 'internal');

    console.log('\n══ B · writeStep — external · internal · none ══\n');
    const st = { code: 'R-1400', step: 'paid', label: 'Money paid', amount_minor: 30000, of_minor: 48165, due_minor: 18165, currency: 'INR' };
    reset(); await BP.writeStep(CUST, BILL, st, { id: BUYER_P, name: 'Ravi K' });
    ok('external (the default for R-1400) → every party, through state_log_fanout', wrote(/state_log_fanout/).length === 1 && wrote(/INSERT INTO state_log/).length === 0);
    reset(); await BP.writeStep(CUST, BILL, st, { id: BUYER_P }, { system_folders: { 'R-1400': { msg: 'internal' } } });
    ok('internal → my copy only (one INSERT for me, no fan-out)', wrote(/state_log_fanout/).length === 0 && wrote(/INSERT INTO state_log/).length === 1 && wrote(/INSERT INTO state_log/)[0].p[1] === CUST);
    reset(); const n0 = await BP.writeStep(CUST, BILL, st, { id: BUYER_P }, { system_folders: { 'R-1400': { msg: 'none' } } });
    ok('none → nothing written at all, not even mine', SQL.length === 0 && n0.written === 'none');
    reset(); await BP.writeStep(SHOP, BILL, { code: 'B-1300', step: 'accepted', label: 'Bill accepted' }, { id: OWNER_P });
    ok('a seller\'s own bill step (B-1300) is internal by default — never fanned', wrote(/state_log_fanout/).length === 0 && wrote(/INSERT INTO state_log/).length === 1);

    console.log('\n══ C · a payment against a bill — R-1400, at its level ══\n');
    reset(); COPY = { chit_id: BILL, purpose: 'invoice', sender_entity_id: SHOP, business_json: Object.assign({ counter_bill: true }, tillBill) };
    await BP.moneySteps(CUST, { direction: 'out', currency: 'INR' }, [{ against_ref: BILL, amount_minor: 30000 }], { id: BUYER_P, name: 'Ravi K' });
    const fan = wrote(/state_log_fanout/)[0];
    const sent = fan ? JSON.parse(fan.p[4]) : {};
    ok('the buyer\'s part payment crosses (R-1400 external): ₹300 of ₹481.65, ₹181.65 due, from Chola Auto Care',
      fan && sent.code === 'R-1400' && sent.amount_minor === 30000 && sent.of_minor === 48165 && sent.due_minor === 18165 && sent.party === 'Chola Auto Care' && sent.step === 'paid', JSON.stringify(sent));
    ok('…and reads, in the buyer\'s own words, "Paid ₹300 of ₹481.65"', BP.label(sent, true) === 'Paid ₹300 of ₹481.65', BP.label(sent, true));
    reset(); COPY = { chit_id: BILL, purpose: 'invoice', sender_entity_id: SHOP, business_json: Object.assign({ counter_bill: true }, tillBill) }; FLAGS = { system_folders: { 'R-1400': { msg: 'internal' } } };
    await BP.moneySteps(CUST, { direction: 'out', currency: 'INR' }, [{ against_ref: BILL, amount_minor: 30000 }], { id: BUYER_P });
    ok('R-1400 restricted to internal on the buyer: the payment stays in the buyer\'s history only', wrote(/state_log_fanout/).length === 0 && wrote(/INSERT INTO state_log/).length === 1);
    reset(); COPY = { chit_id: ORDER, purpose: 'order', sender_entity_id: CUST, business_json: {} };
    await BP.moneySteps(SHOP, { direction: 'in', currency: 'INR' }, [{ against_ref: ORDER, amount_minor: 100 }], { id: OWNER_P });
    ok('a payment against something that is not a bill writes no bill step', wrote(/state_log/).length === 0);
    const booksSrc = fs.readFileSync(path.join(API, 'routes', 'books.js'), 'utf8');
    ok('the books confirm route writes the money steps after the posting', /router\.post\('\/payments\/:id\/confirm'[\s\S]*?moneySteps\(e, pay, list,[\s\S]*?\n\}\);/.test(booksSrc));

    console.log('\n══ D · THE SELLER\'S LIFECYCLE — never a buyer step; the dispute and the shared payment ══\n');
    reset(); ROWS = [sellerRow()];
    LOG = [{ chit_id: BILL, action: 'created', who_id: OWNER_P, who_name: 'Mayur', at: T0, parent_entity_id: SHOP },
           /* fanned into the SELLER's state_log by the buyer before the privacy rule */
           { chit_id: BILL, action: 'status_accepted', who_id: BUYER_P, who_name: 'Ravi K', at: T1, parent_entity_id: CUST },
           { chit_id: BILL, action: 'bill_step', who_id: BUYER_P, who_name: 'Ravi K', at: T2, parent_entity_id: CUST, detail: buyerPaid(18165) }];
    const B1300 = INV.sysId('B-1300');
    let sb = (((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    const lines = (sb.history || []).map((h) => [h.code, h.label, h.by].join(' · '));
    ok('the seller\'s lifecycle has NO buyer step — no "Accepted by customer", nothing by the buyer but what was shared',
      !(sb.history || []).some((h) => /Accepted by customer|Bill accepted/.test(h.label)) && (sb.history || []).filter((h) => h.by === 'chola-ravi').length === 1, JSON.stringify(lines));
    ok('…the buyer\'s shared part payment reads "R-1400 · Chola Auto Care paid ₹300 · ₹181.65 due · chola-ravi"', lines.indexOf('R-1400 · Chola Auto Care paid ₹300 · ₹181.65 due · chola-ravi') >= 0, JSON.stringify(lines));
    ok('…and the bill stays Issued, open: only MY ledger closes it', sb.step === 'issued' && sb.open && !sb.paid, JSON.stringify(sb));
    PI = [{ chit_id: BILL, open_minor: 0, bill_minor: 48165, at: T3 }];
    sb = (((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    ok('paid in full in the SELLER\'s own ledger → Closed', sb.step === 'closed' && sb.paid, JSON.stringify(sb));
    PI = []; LOG = LOG.filter((l) => l.action !== 'bill_step');
    sb = (((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    ok('the buyer kept R-1400 internal (no shared row) → the seller sees no payment at all', !(sb.history || []).some((h) => h.code === 'R-1400'), JSON.stringify(sb.history));
    DISP = [{ chit_id: BILL, status: 'open', who_id: CUST, who_name: 'Chola Auto Care', at: T2 }];
    sb = (((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    ok('a dispute IS visible to the seller: Disputed, DSP', sb.step === 'disputed' && sb.code === 'DSP', JSON.stringify(sb));
    DISP = [{ chit_id: BILL, status: 'resolved', who_id: CUST, who_name: 'Chola Auto Care', at: T1, resolved_at: T2 }];
    sb = (((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    ok('…and once resolved: DSP · Dispute settled, back to Issued', sb.step === 'issued' && (sb.history || []).some((h) => h.code === 'DSP' && h.label === 'Dispute settled'), JSON.stringify(sb.history));
    /* the BUYER's side of the same rule: the seller's own status row, fanned into the buyer's log before the rule, is not the buyer's acceptance */
    reset(); WHO = { identity_id: CUST, identity_type: 'entity', display_name: 'Chola Auto Care' };
    ROWS = [Object.assign(sellerRow(), { purpose: 'invoice', sender_entity_id: SHOP, business_json: Object.assign({ counter_bill: true }, tillBill), doc_kind: 'bill_received', all_recipients: [{ entity_id: SHOP }, { entity_id: CUST }] })];
    LOG = [{ chit_id: BILL, action: 'status_completed', who_id: OWNER_P, who_name: 'Mayur', at: T1, parent_entity_id: SHOP }];
    const bb = (((await call('GET', '/api/folders/' + INV.sysId('B-2100') + '/chits?state=all')).body.chits || [])[0] || {}).bill || {};
    ok('the seller\'s status row in the BUYER\'s log is not the buyer\'s acceptance: still Received', bb.step === 'received' && !(bb.history || []).some((h) => h.by === 'mayur-owner'), JSON.stringify(bb));
    const buyerSide = steps.lifecycle({ side: 'received', status: 'pending', created: { by: 'mayur', at: T0 }, disputes: [{ by: 'chola-ravi', at: T2 }] });
    ok('the same dispute on the buyer\'s side: Disputed, DSP — both see it', buyerSide.step === 'disputed' && buyerSide.code === 'DSP');

    console.log('\n══ E · level none: not even in mine ══\n');
    const mineRow = { step: 'paid', code: 'R-1400', label: 'Paid ₹300 of ₹481.65', by: 'tallytest', at: T3 };
    const withLine = (levels) => steps.lifecycle({ side: 'received', status: 'pending', created: { by: 'x', at: T0 }, lines: [mineRow], levels });
    ok('R-1400 internal: my payment line is in my history', withLine({ 'R-1400': 'internal' }).history.some((h) => h.code === 'R-1400'));
    ok('R-1400 none: not even in mine', !withLine({ 'R-1400': 'none' }).history.some((h) => h.code === 'R-1400'));

    console.log('\n══ F · a status change on a bill is MY step — never fanned ══\n');
    reset(); HDR = { chit_id: BILL, sender_entity_id: SHOP, purpose: 'invoice', business_json: Object.assign({ counter_bill: true }, tillBill) }; CUR = 'pending';
    WHO = { identity_id: BUYER_P, identity_type: 'actor', parent_entity_id: CUST, display_name: 'Ravi K' };
    const sa = await call('PUT', '/api/chits/' + BILL + '/status', { status: 'accepted' });
    const stepRow = wrote(/INSERT INTO state_log/).find((x) => x.p && x.p[2] === 'bill_step');
    ok('the buyer accepts a bill: 200, written as ONE bill_step on the buyer\'s copy (B-2100 · Bill accepted)', sa.status === 200 && stepRow && stepRow.p[1] === CUST && JSON.parse(stepRow.p[5]).code === 'B-2100'
      && JSON.parse(stepRow.p[5]).label === 'Bill accepted', sa.status + ' ' + JSON.stringify(stepRow && stepRow.p));
    ok('…and never fanned to the seller (no chit_log_all, no fan-out, no status row for every party)',
      wrote(/chit_log_all|state_log_fanout|SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = \$1\) cs/).length === 0, wrote(/state_log/).map((x) => x.s.slice(0, 80)).join(' | '));
    reset(); HDR = { chit_id: ORDER, sender_entity_id: SHOP, purpose: 'order', business_json: {} }; CUR = 'pending';
    WHO = { identity_id: CUST, identity_type: 'entity', display_name: 'Chola Auto Care' };
    await call('PUT', '/api/chits/' + ORDER + '/status', { status: 'accepted' });
    ok('an ORDER (not a bill) still tells the other party (the status row fans out as before)', wrote(/chit_log_all|SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = \$1\) cs/).length === 1);

    console.log('\n══ G · goods-in on a bill is recorded on MY copy only ══\n');
    reset(); COPY = { chit_id: BILL, purpose: 'invoice', sender_entity_id: SHOP, business_json: Object.assign({ counter_bill: true }, tillBill) };
    PROG = [{ chit_id: BILL, line_id: 'l1', particulars: 'Rice', ordered_unit: 'kg', ordered: 10, removed: false, delivery_id: 'd1', dq: 4, du: 'kg', recorded_by_entity_id: CUST, delivered_at: T1 }];
    WHO = { identity_id: BUYER_P, identity_type: 'actor', parent_entity_id: CUST, display_name: 'Ravi K' };
    const gi = await call('POST', '/api/chits/' + BILL + '/deliver-lines', { rows: [{ line_id: 'l1', quantity: 4 }] });
    ok('goods-in on a bill: 200, ONE plain INSERT into my copy\'s deliveries', gi.status === 200 && wrote(/INSERT INTO chit_line_delivery/).length === 1 && wrote(/INSERT INTO chit_line_delivery/)[0].p[1] === CUST, gi.status + ' ' + JSON.stringify(gi.body).slice(0, 200));
    ok('…not the definer that writes every party\'s copy, and no fan-out of the event', wrote(/chit_line_event|chit_line_deliver\(|state_log_fanout/).length === 0);
    ok('…its line is MY B-2100 · Goods checked (internal)', wrote(/INSERT INTO state_log/).some((x) => x.p[2] === 'bill_step' && JSON.parse(x.p[5]).label === 'Goods checked' && JSON.parse(x.p[5]).code === 'B-2100'));
    reset(); COPY = { chit_id: ORDER, purpose: 'order', sender_entity_id: SHOP, business_json: {} };
    WHO = { identity_id: CUST, identity_type: 'entity', display_name: 'Chola Auto Care' };
    await call('POST', '/api/chits/' + ORDER + '/deliver-lines', { rows: [{ line_id: 'l1', quantity: 4 }] });
    ok('an ORDER\'s goods-in still crosses (the definer and the fan-out, as before)', wrote(/chit_line_event/).length === 1 && wrote(/state_log_fanout/).length === 1);

    console.log('\n══ H · THE SENDER\'S CHIT READ of a bill ══\n');
    reset(); HDR = Object.assign({ entity_id: SHOP, direction: 'received', role: 'Act', all_recipients: [{ entity_id: SHOP }, { entity_id: CUST }] }, sellerRow(), { chit_id: BILL });
    LOG = [{ chit_id: BILL, action: 'created', who_id: OWNER_P, who_name: 'Mayur', at: T0 },
           { chit_id: BILL, action: 'status_accepted', who_id: BUYER_P, who_name: 'Ravi K', at: T1, detail: 'Status changed from pending to accepted by Ravi K' },
           { chit_id: BILL, action: 'delivered_line', who_id: BUYER_P, who_name: 'Ravi K', at: T1, detail: '1 line(s) delivered: 10' },
           { chit_id: BILL, action: 'dispute_raised', who_id: BUYER_P, who_name: 'Ravi K', at: T2, detail: 'Short by 2 kg' },
           { chit_id: BILL, action: 'bill_step', who_id: BUYER_P, who_name: 'Ravi K', at: T2, detail: buyerPaid(18165) },
           { chit_id: BILL, action: 'bill_step', who_id: OWNER_P, who_name: 'Mayur', at: T3, detail: JSON.stringify({ code: 'B-1300', step: 'completed', label: 'Completed' }) }];
    PARTS = [{ entity_id: SHOP, current_status: 'pending', read_at: T0, display_name: 'Mayur Traders', bridge_id: 'CB-SHOP' },
             { entity_id: CUST, current_status: 'accepted', read_at: T1, assigned_to_actor_display_name: 'Ravi K', updated_at: T1, display_name: 'Chola Auto Care', bridge_id: 'CB-CUST' }];
    DELIV = [{ line_id: 'l1', particulars: 'Rice', ordered_unit: 'kg', ordered: 10, removed: false, delivery_id: 'dx', dq: 10, du: 'kg', recorded_by_entity_id: CUST, recorded_by_name: 'Chola Auto Care', delivered_at: T1 }];
    const rd = await call('GET', '/api/chits/' + BILL);
    const acts = (rd.body.state_log || []).map((r) => r.action);
    ok('the seller\'s read: 200, flagged bill_private', rd.status === 200 && rd.body.bill_private === true, rd.status + ' ' + JSON.stringify(rd.body).slice(0, 300));
    ok('…no buyer status or goods-in in the history (status_accepted, delivered_line gone)', acts.indexOf('status_accepted') < 0 && acts.indexOf('delivered_line') < 0, JSON.stringify(acts));
    ok('…the bill\'s creation and the DISPUTE stay', acts.indexOf('created') >= 0 && acts.indexOf('dispute_raised') >= 0);
    const shared = (rd.body.state_log || []).find((r) => r.action === 'bill_step' && r.code === 'R-1400') || {};
    ok('…the buyer\'s shared payment stays, in the seller\'s words', shared.detail === 'R-1400 · Chola Auto Care paid ₹300 · ₹181.65 due', JSON.stringify(shared));
    const mineStep = (rd.body.state_log || []).find((r) => r.action === 'bill_step' && r.code === 'B-1300') || {};
    ok('…my own step reads as mine (B-1300 · Completed)', mineStep.detail === 'B-1300 · Completed' && mineStep.mine === true, JSON.stringify(mineStep));
    const other = (rd.body.participants || []).find((p) => p.entity_id === CUST) || {};
    ok('…the buyer on the participants panel: who they are, never their status, read time or assignee',
      other.display_name === 'Chola Auto Care' && !('current_status' in other) && !('read_at' in other) && !('assigned_to_actor_display_name' in other), JSON.stringify(other));
    const ld = (rd.body.line_delivery || {}).l1 || {};
    ok('…no buyer delivery in the line picture (their goods-in is theirs)', !rd.body.line_delivery || (Number(ld.theirs || 0) === 0 && Number(ld.delivered || 0) === 0 && !(ld.events || []).length), JSON.stringify(rd.body.line_delivery));
    HDR = Object.assign({}, HDR, { purpose: 'order', business_json: {}, chit_id: ORDER, sender_entity_id: CUST }); LOG = LOG.map((l) => Object.assign({}, l, { chit_id: ORDER }));
    const ro = await call('GET', '/api/chits/' + ORDER);
    ok('an ORDER\'s read is untouched (the other party\'s status row and status stay)', (ro.body.state_log || []).some((r) => r.action === 'status_accepted')
      && ((ro.body.participants || []).find((p) => p.entity_id === CUST) || {}).current_status === 'accepted');

    console.log('\n══ I · the activity feed ══\n');
    reset(); await call('GET', '/api/notifications');
    const feed = SQL.find((x) => /FROM state_log sl/.test(x.s) && /notif_dismissed/.test(x.s));
    ok('the feed leaves out the other shop\'s steps on a bill (the predicate is in its SQL)', feed && feed.s.indexOf(BP.billSql('ch', 'cs').replace(/\s+/g, ' ')) >= 0 && feed.s.indexOf(BP.foreignStepSql('sl', '$1').replace(/\s+/g, ' ')) >= 0);
    ok('…which keeps the dispute and the shared steps (they are not "foreign steps")', ['dispute_raised', 'dispute_resolved', 'bill_step'].every((a) => BP.foreignStepSql('sl', '$1').indexOf("'" + a + "'") >= 0));
  } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack)); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
