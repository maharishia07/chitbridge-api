/**
 * tests/bills-folder.test.cjs — THE BILLS FOLDER ON THE FOLDER SYSTEM (Athi, 2026-10-01; BACKLOG "BILLS TO ACCEPT").
 *
 *   A  the inventory: every system folder's code is its ledger's number in lib/accounts-packs (B-2100 · B-1300 · R-1400 ·
 *      E-6000 · RT-4090), Tasks and Orders are the tracks themselves and always on
 *   B  nothing is seeded: listing twice gives the same fixed ids and writes nothing
 *   C  the switches: Bills · Received, Bills · Issued, Receipts on by default, Expenses and Returns off; the OWNER turns one on
 *      or off (a co-assist and the generic policy door are refused); an OFF folder is absent from the tree and its own routes
 *   D  ONE classification: docOf agrees with the ledger's own tests (tax-copy billReceived / counterIssued); the inbox and the
 *      folders read the same compiled SQL; only bills leave the inbox — orders, jobs, receipts, returns stay
 *   E  view folders: membership is the rule's matches (system: the inventory's; a shop's own: its folder_rule rows), a chit in
 *      two system folders at once, nothing can be moved into a view, and a view folder's rule never files
 *   F  THE STEP FUNCTION over the five states (Received · Goods checked · Bill accepted · Disputed · Closed) and the issued
 *      side; every line names its folder code + user id + time; two acceptances on one bill carry two codes
 *   G  the facts are read from what exists (state_log · deliveries · journal_entry · party_item · identities) — the folder
 *      listing returns each bill with its step
 *   H  the Task and Order lists (and their counts) carry the inbox predicate; a named folder does not; reconcile still adds up
 * No database: db and auth are stubbed; the routes are the real ones.   Run: node tests/bills-folder.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', SUP = '22222222-2222-4222-8222-222222222222', CUST = '33333333-3333-4333-8333-333333333333';
const RAVI = '44444444-4444-4444-8444-444444444444', CHOLA = '55555555-5555-4555-8555-555555555555';
const VIEW_F = '66666666-6666-4666-8666-666666666666', FILED_F = '77777777-7777-4777-8777-777777777777';

/* ── the stand-in database: answers by the shape of the statement ── */
let SQL = [], FLAGS = {}, ROWS = [], USER_FOLDERS = [], RULES = [], LOG = [], DISP = [], JE = [], PI = [], LINES = [], PEOPLE = {}, WRITES = [];
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  SQL.push(s);
  if (/^(INSERT|UPDATE|DELETE)/i.test(s) && !/policy_flags/.test(s) && !/chit_status SET folder_id/.test(s)) WRITES.push(s);
  if (/SELECT policy_flags, self_copy_pref FROM identities/.test(s)) return [{ policy_flags: FLAGS, self_copy_pref: null }];
  if (/UPDATE identities SET policy_flags/.test(s)) { FLAGS = Object.assign({}, FLAGS, JSON.parse(p[0])); return []; }
  if (/FROM folder_rule/.test(s)) return RULES.filter((r) => !/folder_id = \$2/.test(s) || r.folder_id === p[1]);
  if (/FROM folder f WHERE f.entity_id = \$1 AND to_jsonb\(f\)->>'kind' = 'view'/.test(s)) return USER_FOLDERS.filter((f) => f.kind === 'view');
  if (/FROM folder f WHERE f.folder_id = \$1/.test(s)) return USER_FOLDERS.filter((f) => f.folder_id === p[0]);
  if (/FROM folder f/.test(s) && /ORDER BY f.parent_id/.test(s)) return USER_FOLDERS.map((f) => Object.assign({ count: 0, scope: 'task', sort: 0, parent_id: null }, f));
  if (/FROM folder WHERE entity_id = \$1 ORDER BY sort/.test(s)) return USER_FOLDERS;
  if (/FROM chit_status cs JOIN chit_header ch/.test(s) && /AS doc_kind/.test(s)) {
    let out = ROWS.slice();
    const dIdx = (s.match(/= ANY\(\$(\d+)::text\[\]\)/) || [])[1];
    if (dIdx && /AS doc_kind.*\(CASE .* END\) = ANY/.test(s)) out = out.filter((r) => p[+dIdx - 1].indexOf(r.doc_kind) >= 0);
    if (/cs.direction = \$/.test(s)) { const d = p.find((x) => x === 'sent' || x === 'received'); out = out.filter((r) => r.direction === d); }
    return out;
  }
  if (/FROM chit_line l LEFT JOIN chit_line_delivery d/.test(s)) return LINES.filter((l) => (p[1] || []).indexOf(l.chit_id) >= 0);
  if (/FROM state_log sl LEFT JOIN identities i/.test(s)) return LOG.filter((l) => (p[1] || []).indexOf(l.chit_id) >= 0);
  if (/FROM chit_disputes WHERE chit_id = ANY/.test(s)) return DISP.filter((d) => (p[0] || []).indexOf(d.chit_id) >= 0);
  if (/FROM journal_entry WHERE entity_id = \$1 AND source_chit_id = ANY/.test(s)) return JE.filter((j) => (p[1] || []).indexOf(j.chit_id) >= 0);
  if (/unnest\(j.source_chit_ids\)/.test(s)) return [];
  if (/FROM party_item i LEFT JOIN books_payment p/.test(s)) return PI.filter((x) => (p[1] || []).indexOf(x.chit_id) >= 0);
  if (/SELECT identity_id, user_id, display_name FROM identities/.test(s)) return (p[0] || []).map((id) => PEOPLE[id]).filter(Boolean);
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

const INV = require(path.join(API, 'lib', 'folder-inventory'));
const P = require(path.join(API, 'lib', 'accounts-packs'));
const TC = require(path.join(API, 'lib', 'tax-copy'));
const steps = require(path.join(API, 'lib', 'bill-steps'));
const match = require(path.join(API, 'lib', 'match'));
const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/folders', require(path.join(API, 'routes', 'folders')));
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* ── the shop's copies: each row's doc_kind is what docSql computes (docOf — the same table compiled to JS) ── */
const C = (id, o) => { const r = Object.assign({ chit_id: id, current_status: 'pending', direction: 'received', folder_id: null, created_at: '2026-10-01T05:00:00.000Z',
  manual_subject: o.subj || id, sender_entity_id: SHOP, sender_entity_display_name: 'Mayur Traders', all_recipients: [{ entity_id: SHOP }], open_disputes: 0 }, o);
  r.doc_kind = INV.docOf(r, SHOP); r.counterparty_name = r.sender_entity_display_name; return r; };
const id = (n) => '0000000' + n + '-0000-4000-8000-00000000000' + n;
const BILL_IN = id(1), BILL_OUT = id(2), ORDER_IN = id(3), JOB = id(4), WALKIN = id(5), RECEIPT = id(6), CREDIT = id(7), INVOICE_IN = id(8);
const till = { bill_no: 'C1/26-27/0041', till: { id: 'C1' } };
function world() {
  ROWS = [
    C(BILL_IN,   { purpose: 'invoice', sender_entity_id: SUP, sender_entity_display_name: 'Agro Mills', business_json: Object.assign({ counter_bill: true }, till), subj: 'Bill C1/26-27/0041 from Agro Mills' }),
    C(BILL_OUT,  { purpose: 'order', business_json: till, all_recipients: [{ entity_id: SHOP }, { entity_id: SHOP }, { entity_id: CUST }], subj: 'Counter sale 42' }),
    C(ORDER_IN,  { purpose: 'order', sender_entity_id: CUST, sender_entity_display_name: 'Chola Auto Care', business_json: {}, subj: 'Order from Chola' }),
    C(JOB,       { purpose: 'general', business_json: {}, subj: 'Fix the shutter' }),
    C(WALKIN,    { purpose: 'order', business_json: { bill_no: 'C1/26-27/0043', till: { id: 'C1' } }, all_recipients: [{ entity_id: SHOP }, { entity_id: SHOP }], subj: 'Counter sale 43' }),
    C(RECEIPT,   { purpose: 'general', business_json: { kind: 'payment_received' }, subj: 'Payment received' }),
    C(CREDIT,    { purpose: 'credit_note', business_json: { bill_no: 'CN-1', till: { id: 'C1' } }, subj: 'Credit note' }),
    C(INVOICE_IN,{ purpose: 'invoice', sender_entity_id: SUP, sender_entity_display_name: 'Agro Mills', business_json: { invoice_no: 'AM-77' }, subj: 'Invoice AM-77' }),
    /* a numbered order that no till issued — NOT a counter bill (tax-copy.counterIssued needs the till) */
    C(id(9),     { purpose: 'order', business_json: { bill_no: 'Q-1' }, subj: 'Numbered order' }),
  ];
  FLAGS = {}; USER_FOLDERS = []; RULES = []; LOG = []; DISP = []; JE = []; PI = []; LINES = []; PEOPLE = {}; WRITES = [];
  WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
}

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, u, body) => { SQL = []; const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const B2100 = INV.sysId('B-2100'), B1300 = INV.sysId('B-1300'), E6000 = INV.sysId('E-6000'), R1400 = INV.sysId('R-1400');
  try {
    console.log('\n══ A · THE INVENTORY, NUMBERED WITH THE LEDGER ══\n');
    const pack = P.packFor('IN');
    for (const f of INV.INVENTORY.filter((x) => x.kind === 'view')) {
      const want = f.role ? (P.accountOf(pack, f.role) || {}).code : String((P.groupOf(pack, f.group) || { range: [] }).range[0]);
      ok(f.code + ' ' + f.name + ' is numbered with its ledger (' + (f.role || f.group) + ' ' + want + ')', f.code.split('-')[1] === want, f.code + ' vs ' + want);
    }
    ok('Tasks (T) and Orders (O) are the tracks themselves, always on', INV.INVENTORY.filter((f) => f.kind === 'track').map((f) => f.code + f.scope + !!f.fixed).join() === 'Ttasktrue,Oordertrue');
    ok('every code is one row (no two folders claim one number)', new Set(INV.INVENTORY.map((f) => f.code)).size === INV.INVENTORY.length);

    console.log('\n══ B · NOTHING IS SEEDED — the same ids, no writes ══\n');
    world();
    const l1 = await call('GET', '/api/folders'), l2 = await call('GET', '/api/folders');
    const sysIds = (r) => (r.body.folders || []).filter((f) => f.system).map((f) => f.folder_id + f.code).join();
    ok('the folder list carries the system folders (B-2100, B-1300, R-1400 by default), system first', l1.status === 200 && (l1.body.folders || []).slice(0, 3).map((f) => f.code).join() === 'B-2100,B-1300,R-1400', JSON.stringify((l1.body.folders || []).map((f) => f.code)));
    ok('listing twice gives the same fixed ids (idempotent)', sysIds(l1) && sysIds(l1) === sysIds(l2), sysIds(l1) + ' / ' + sysIds(l2));
    ok('…and writes nothing to any table', WRITES.length === 0, WRITES.join(' | ').slice(0, 300));
    const b2100 = (l1.body.folders || []).find((f) => f.code === 'B-2100') || {};
    ok('a system folder shows its ledger beside its name (2100 Suppliers)', b2100.ledger && b2100.ledger.code === '2100' && /Suppliers/.test(b2100.ledger.name), JSON.stringify(b2100.ledger));
    ok('…with the count of its OPEN items (2 bills received, nothing accepted)', b2100.count === 2, JSON.stringify(b2100));

    console.log('\n══ C · THE SWITCHES — owner only; OFF is absent ══\n');
    const inv = await call('GET', '/api/folders/inventory');
    const on = (r, c) => ((r.body.rows || []).find((x) => x.code === c) || {}).on;
    ok('defaults: B-2100, B-1300, R-1400 on; E-6000, RT-4090 off; T, O on', [on(inv, 'B-2100'), on(inv, 'B-1300'), on(inv, 'R-1400'), on(inv, 'E-6000'), on(inv, 'RT-4090'), on(inv, 'T'), on(inv, 'O')].join() === 'true,true,true,false,false,true,true');
    ok('…and the owner may change them (can_change)', inv.body.can_change === true);
    WHO = { identity_id: RAVI, identity_type: 'actor', parent_entity_id: SHOP, display_name: 'Ravi' };
    const no1 = await call('PUT', '/api/folders/inventory/E-6000', { on: true });
    const no2 = await call('PATCH', '/api/entities/policy', { system_folders: { 'E-6000': 'on' } });
    ok('a co-assist cannot switch a folder (403), nor through the generic policy door (403)', no1.status === 403 && no2.status === 403 && !FLAGS.system_folders, no1.status + ' ' + no2.status);
    WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
    const t1 = await call('PUT', '/api/folders/inventory/E-6000', { on: true });
    ok('the owner turns Expenses on → stored as policy_flags.system_folders { on }', t1.status === 200 && FLAGS.system_folders && FLAGS.system_folders['E-6000'] && FLAGS.system_folders['E-6000'].on === true, JSON.stringify(FLAGS));
    ok('…and E-6000 is now in the tree', ((await call('GET', '/api/folders')).body.folders || []).some((f) => f.code === 'E-6000'));
    ok('a track cannot be switched off (400)', (await call('PUT', '/api/folders/inventory/T', { on: false })).status === 400);
    await call('PUT', '/api/folders/inventory/B-2100', { on: false });
    const off = await call('GET', '/api/folders');
    ok('B-2100 switched OFF → absent from the tree, and its count with it', !(off.body.folders || []).some((f) => f.code === 'B-2100'), JSON.stringify((off.body.folders || []).map((f) => f.code)));
    const offR = await call('GET', '/api/folders/' + B2100 + '/chits');
    ok('…its own route answers as absent (404)', offR.status === 404, offR.status + ' ' + JSON.stringify(offR.body).slice(0, 200));
    const inboxOff = await call('GET', '/api/chits/inbox');
    ok('…and the bills STILL stay out of Task (the inbox predicate does not read the switch)', SQL.some((s) => /FROM chit_status cs/.test(s) && s.indexOf(INV.inboxSql('ch', 'cs').replace(/\s+/g, ' ')) >= 0), inboxOff.status + ' ' + SQL.join(' || ').slice(0, 200));
    await call('PUT', '/api/folders/inventory/B-2100', { on: true });

    console.log('\n══ D · ONE CLASSIFICATION — the ledger\'s tests, the inbox\'s SQL ══\n');
    world();
    for (const r of ROWS) {
      const rec = TC.billReceived(r, SHOP), iss = String(r.sender_entity_id) === SHOP && TC.counterIssued(r.business_json) && /^(order|offer|subscription)$/.test(r.purpose);
      ok('docOf(' + r.manual_subject + ') = ' + r.doc_kind + ' agrees with tax-copy (received ' + rec + ', issued ' + iss + ')',
        (r.doc_kind === 'bill_received') === rec && (r.doc_kind === 'bill_issued') === !!iss);
    }
    ok('only BILLS leave the inbox: the predicate names bill_received and bill_issued, nothing else', JSON.stringify(INV.LEAVES) === JSON.stringify(['bill_received', 'bill_issued']));
    const stays = ROWS.filter((r) => INV.LEAVES.indexOf(r.doc_kind) < 0).map((r) => r.manual_subject);
    ok('…so orders, jobs, receipts, credit notes stay in Task/Order', JSON.stringify(stays) === JSON.stringify(['Order from Chola', 'Fix the shutter', 'Payment received', 'Credit note', 'Numbered order']), JSON.stringify(stays));
    const compiled = INV.docSql('ch', 'cs');
    ok('the SQL is compiled from the same rows (every purpose and both kinds of bill named)', ['invoice', 'credit_note', 'payment_received', 'bill_received', 'bill_issued', "'till'->>'id'"].every((w) => compiled.indexOf(w) >= 0));
    ok('the inbox predicate IS that SQL (one expression, not a second copy)', INV.inboxSql('ch', 'cs').indexOf(compiled) >= 0);
    const sel = require(path.join(API, 'lib', 'select'));
    await sel.rows(SHOP, {});
    ok('…and lib/select.js carries it on every row as doc_kind (what a folder rule reads)', SQL.some((s) => s.indexOf(compiled.replace(/\s+/g, ' ') + ') AS doc_kind') >= 0));

    console.log('\n══ E · VIEW FOLDERS — a rule\'s matches; two folders at once; never a place ══\n');
    world();
    const recv = await call('GET', '/api/folders/' + B2100 + '/chits?state=all');
    ok('Bills · Received holds the two bills I received (counter bill + app invoice)', JSON.stringify((recv.body.chits || []).map((c) => c.chit_id).sort()) === JSON.stringify([BILL_IN, INVOICE_IN].sort()), JSON.stringify(recv.body).slice(0, 300));
    const iss = await call('GET', '/api/folders/' + B1300 + '/chits?state=all');
    ok('Bills · Issued holds my counter bills (to a rail customer + a walk-in)', JSON.stringify((iss.body.chits || []).map((c) => c.chit_id).sort()) === JSON.stringify([BILL_OUT, WALKIN].sort()));
    ok('Receipts holds the payment chit', JSON.stringify(((await call('GET', '/api/folders/' + R1400 + '/chits?state=all')).body.chits || []).map((c) => c.chit_id)) === JSON.stringify([RECEIPT]));
    /* a shop's own view folder: "everything from Agro Mills" — its folder_rule rows define it */
    USER_FOLDERS = [{ folder_id: VIEW_F, name: 'Agro Mills', kind: 'view' }, { folder_id: FILED_F, name: 'Urgent', kind: 'filed' }];
    RULES = [{ rule_id: 'r1', folder_id: VIEW_F, when: { from: 'Agro' }, enabled: true, sort: 0 }];
    const mine = await call('GET', '/api/folders/' + VIEW_F + '/chits?state=all');
    ok('a shop\'s own VIEW folder holds its rule\'s matches (from: Agro → both Agro Mills bills)', JSON.stringify((mine.body.chits || []).map((c) => c.chit_id).sort()) === JSON.stringify([BILL_IN, INVOICE_IN].sort()), JSON.stringify(mine.body).slice(0, 200));
    ok('…so one bill is in Bills · Received AND the Agro Mills folder, and its filing is untouched (folder_id null)', (recv.body.chits || []).some((c) => c.chit_id === BILL_IN) && (mine.body.chits || []).some((c) => c.chit_id === BILL_IN && c.folder_id === null));
    /* two SYSTEM folders at once: membership is per rule, never a partition — an inventory row whose rule is not a document kind overlaps */
    INV.INVENTORY.push({ code: 'X-2900', name: 'Disputed (test)', kind: 'view', when: { has_dispute: true }, on: true });
    const X = INV.sysId('X-2900');
    require(path.join(API, 'lib', 'folder-inventory'));
    ROWS[0].open_disputes = 1;
    const vx = require(path.join(API, 'lib', 'folder-views'));
    const inX = (await vx.members(SHOP, Object.assign({ system: true }, INV.INVENTORY[INV.INVENTORY.length - 1]), { state: 'all' })).chits.map((c) => c.chit_id);
    const inB = (await vx.members(SHOP, Object.assign({ system: true }, INV.byCode('B-2100')), { state: 'all' })).chits.map((c) => c.chit_id);
    ok('a chit in TWO system folders at once (Bills · Received and a dispute view)', inX.indexOf(BILL_IN) >= 0 && inB.indexOf(BILL_IN) >= 0, JSON.stringify([inX, inB]));
    INV.INVENTORY.pop(); void X;
    ROWS[0].open_disputes = 0;
    const mv = await call('POST', '/api/folders/move', { chit_id: BILL_IN, folder_id: B2100 });
    const mv2 = await call('POST', '/api/folders/move', { chit_id: BILL_IN, folder_id: VIEW_F });
    ok('nothing can be MOVED into a view folder — system or own (400 FOLDER_IS_VIEW)', mv.status === 400 && mv.body.code === 'FOLDER_IS_VIEW' && mv2.status === 400 && mv2.body.code === 'FOLDER_IS_VIEW', mv.status + ' ' + mv2.status);
    const rl = await call('GET', '/api/folders/' + B2100 + '/rules');
    ok('a system folder\'s rule is shown, fixed (doc: bill_received), and cannot be added to (400)',
      rl.body.system === true && (rl.body.rules || [])[0].when.doc === 'bill_received' && (await call('POST', '/api/folders/' + B2100 + '/rules', { when: { from: 'x' } })).status === 400);
    const fr = require(path.join(API, 'lib', 'folder-rules'));
    RULES = [{ rule_id: 'r1', folder_id: VIEW_F, when: { from: 'Agro' }, enabled: true, sort: 0 }, { rule_id: 'r2', folder_id: FILED_F, when: { purpose: 'invoice' }, enabled: true, sort: 1 }];
    const filed = await fr.fileArrival(SHOP, ROWS[7]);
    ok('a VIEW folder\'s rule never files: an Agro invoice is filed by the next (filing) rule, not the view\'s', filed && filed.folder_id === FILED_F, JSON.stringify(filed));
    ok('the rule vocabulary knows `doc` (a system folder\'s rule can be previewed like any other)', match.validate({ doc: 'bill_received' }).ok && match.match(ROWS[0], { doc: 'bill_received' }) && !match.match(ROWS[2], { doc: 'bill_received' }));

    console.log('\n══ F · THE STEP FUNCTION — five states, each line with its code, user and time ══\n');
    const T0 = '2026-10-01T05:00:00.000Z', T1 = '2026-10-01T08:50:00.000Z', T2 = '2026-10-01T09:10:00.000Z', T3 = '2026-10-02T04:00:00.000Z';
    const sup = { by: 'agro-mills', at: T0 }, rv = { by: 'chola-ravi', at: T1 }, rv2 = { by: 'chola-ravi', at: T2 };
    const L = (f) => steps.lifecycle(Object.assign({ side: 'received', status: 'pending', created: sup }, f));
    const s1 = L({}), s2 = L({ goods: { lines: 2, complete: 1, started: 1, by: rv.by, at: rv.at } });
    const s3 = L({ status: 'accepted', accepted: rv2, posted: rv2, goods: { lines: 2, complete: 0, started: 0 } });
    const s4 = L({ disputes: [rv2], goods: { lines: 2, complete: 1, started: 1, by: rv.by, at: rv.at } });
    const s5 = L({ status: 'accepted', accepted: rv2, posted: rv2, goods: { lines: 2, complete: 2, started: 2, by: rv.by, at: rv.at } });
    ok('Received — nothing posted, nothing counted', s1.step === 'received' && s1.code === 'B-2100' && s1.label === 'Received' && s1.open, JSON.stringify(s1));
    ok('Goods checked — goods-in recorded, B-2100 · Goods checked · chola-ravi · 08:50', s2.step === 'goods_checked' && s2.code === 'B-2100' && s2.label === 'Goods checked' && s2.by === 'chola-ravi' && s2.at === T1, JSON.stringify(s2));
    ok('Accepted — B-2100 · Bill accepted · chola-ravi (goods not all in: still open)', s3.step === 'accepted' && s3.label === 'Bill accepted' && s3.by === 'chola-ravi' && s3.open, JSON.stringify(s3));
    ok('Disputed — an open dispute wins over every other step, and its line carries the DISPUTE code (DSP)', s4.step === 'disputed' && s4.code === 'DSP' && s4.open, JSON.stringify(s4));
    ok('Closed — goods in + accepted, no longer open', s5.step === 'closed' && !s5.open && s5.code === 'B-2100', JSON.stringify(s5));
    ok('a bill with no lines to count closes on acceptance', L({ status: 'accepted', accepted: rv2 }).step === 'closed');
    ok('a refused bill is closed, "Bill refused"', L({ status: 'rejected', refused: rv2 }).label === 'Bill refused' && !L({ status: 'rejected', refused: rv2 }).open);
    const s6 = L({ status: 'accepted', accepted: rv2, posted: rv2, goods: { lines: 1, complete: 1, started: 1, by: rv.by, at: rv.at }, money: { settled: true, at: T3 },
                   lines: [{ step: 'paid', code: 'R-1400', label: 'Paid ₹481.65 of ₹481.65', by: 'tallytest', at: T3 }] });
    const codes = s6.history.map((h) => h.code + ' · ' + h.label + ' · ' + h.by);
    ok('PAID is shown, never holding the bill: R-1400 · Paid ₹481.65 of ₹481.65 · tallytest — step stays Closed', s6.paid && s6.step === 'closed' && codes.indexOf('R-1400 · Paid ₹481.65 of ₹481.65 · tallytest') >= 0, JSON.stringify(codes));
    ok('…two acceptances on one bill carry TWO codes (B-2100 Bill accepted, R-1400 Paid)', codes.indexOf('B-2100 · Bill accepted · chola-ravi') >= 0 && codes.some((c) => /^R-1400 · Paid/.test(c)));
    ok('…a paid bill whose goods are not in is NOT closed by the money', L({ status: 'accepted', accepted: rv2, goods: { lines: 2, complete: 0, started: 0 }, money: { settled: true, by: 'x', at: T3 } }).step === 'accepted');
    const I = (f) => steps.lifecycle(Object.assign({ side: 'issued', status: 'pending', created: { by: 'mayur-owner', at: T0 } }, f));
    const i1 = I({ waiting: true }), i2 = I({ waiting: true, money: { settled: true, at: T3 } });
    const i3 = I({ waiting: false }), i4 = I({ waiting: true, disputes: [rv2] });
    ok('Issued — waiting on payment: B-1300 · Issued', i1.step === 'issued' && i1.code === 'B-1300' && i1.open, JSON.stringify(i1));
    ok('paid in full in MY ledger → Closed', i2.step === 'closed' && !i2.open && i2.paid, JSON.stringify(i2));
    ok('a walk-in bill: Closed when issued', i3.step === 'closed' && !i3.open);
    ok('Disputed → Disputed (DSP)', i4.step === 'disputed' && i4.open && i4.code === 'DSP');
    ok('money on an issued bill reads R-1400 · Received ₹118 of ₹118 (my own receipt)', I({ waiting: false, money: { settled: true, at: T3 }, lines: [{ step: 'received', code: 'R-1400', label: 'Received ₹118 of ₹118', by: 'tallytest', at: T3 }] }).history.some((h) => h.code === 'R-1400' && h.label === 'Received ₹118 of ₹118' && h.by === 'tallytest'));

    console.log('\n══ G · THE FACTS ARE THE RECORDS THAT EXIST — the listing returns each bill\'s step ══\n');
    world();
    PEOPLE = { [CHOLA]: { identity_id: CHOLA, user_id: 'chola-ravi', display_name: 'Ravi K' }, [RAVI]: { identity_id: RAVI, user_id: 'tallytest', display_name: 'Tally Test' } };
    LINES = [{ chit_id: BILL_IN, line_id: 'l1', particulars: 'Rice', ordered_unit: 'kg', ordered: 10, removed: false, delivery_id: 'd1', dq: 10, du: 'kg', recorded_by_entity_id: SHOP, recorded_by_actor_id: CHOLA, recorded_by_name: 'Mayur', delivered_at: T1 }];
    LOG = [{ chit_id: BILL_IN, action: 'status_accepted', who_id: CHOLA, who_name: 'Ravi K', at: T2, parent_entity_id: SHOP },
           { chit_id: BILL_IN, action: 'bill_step', who_id: RAVI, who_name: 'Tally Test', at: T3, parent_entity_id: SHOP,
             detail: JSON.stringify({ code: 'R-1400', step: 'paid', label: 'Money paid', party: 'Mayur Traders', amount_minor: 48165, of_minor: 48165, due_minor: 0, currency: 'INR' }) },
           /* fanned into MY state_log by the buyer before the privacy rule — never read as anything of mine */
           { chit_id: BILL_OUT, action: 'status_accepted', who_id: '99999999-9999-4999-8999-999999999999', who_name: 'Chola buyer', at: T2, parent_entity_id: CUST }];
    PEOPLE['99999999-9999-4999-8999-999999999999'] = { identity_id: '99999999-9999-4999-8999-999999999999', user_id: 'chola-buyer', display_name: 'Chola buyer' };
    JE = [{ chit_id: BILL_IN, at: T2, who_id: CHOLA }];
    PI = [{ chit_id: BILL_IN, open_minor: 0, bill_minor: -48165, at: T3, who_id: RAVI }];
    const g = await call('GET', '/api/folders/' + B2100 + '/chits?state=all');
    const gb = ((g.body.chits || []).find((c) => c.chit_id === BILL_IN) || {}).bill || {};
    ok('the received bill reads Closed from the records: goods in (deliveries), accepted (state_log), posted (journal)', gb.step === 'closed', JSON.stringify(gb));
    ok('…every line names the person by USER ID: B-2100 · Goods checked · chola-ravi', (gb.history || []).some((h) => h.code === 'B-2100' && h.label === 'Goods checked' && h.by === 'chola-ravi' && h.at === T1), JSON.stringify(gb.history));
    ok('…B-2100 · Bill accepted · chola-ravi (from the status history, not a new log)', (gb.history || []).some((h) => h.label === 'Bill accepted' && h.by === 'chola-ravi'));
    ok('…R-1400 · Paid ₹481.65 of ₹481.65 · tallytest (my own payment step; paid from MY ledger)', gb.paid === true && (gb.history || []).some((h) => h.code === 'R-1400' && h.by === 'tallytest' && h.label === 'Paid ₹481.65 of ₹481.65'), JSON.stringify(gb.history));
    ok('the closed bill leaves the OPEN list (state=open) and the open count', ((await call('GET', '/api/folders/' + B2100 + '/chits')).body.chits || []).every((c) => c.chit_id !== BILL_IN));
    const ib = ((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || []).find((c) => c.chit_id === BILL_OUT) || {};
    ok('the issued bill does NOT read the customer\'s acceptance (a buyer row in my state_log): still Issued, open, no line of theirs', ib.bill && ib.bill.step === 'issued' && ib.bill.open && !ib.bill.history.some((h) => h.by === 'chola-buyer'), JSON.stringify(ib.bill));
    const wk = ((await call('GET', '/api/folders/' + B1300 + '/chits?state=all')).body.chits || []).find((c) => c.chit_id === WALKIN) || {};
    ok('the walk-in bill (only the shop on it) reads Closed — nobody to accept it', wk.bill && wk.bill.step === 'closed', JSON.stringify(wk.bill));
    ok('…and the bill to a rail customer nobody has accepted yet stays Issued, open', (() => { LOG = []; return true; })()
      && (((await call('GET', '/api/folders/' + B1300 + '/chits')).body.chits || []).map((c) => c.chit_id).join() === BILL_OUT));
    ok('no statement in any of this wrote to a table', WRITES.length === 0, WRITES.join(' | ').slice(0, 200));

    console.log('\n══ H · THE TASK AND ORDER LISTS — one predicate; a named folder keeps its filing; reconcile adds up ══\n');
    world();
    const pred = INV.inboxSql('ch', 'cs').replace(/\s+/g, ' ');
    const has = () => SQL.filter((s) => s.indexOf(pred) >= 0).length;
    await call('GET', '/api/chits/inbox');
    ok('Task (/inbox): the count and the page both carry the inbox predicate', has() >= 2, SQL.length + ' statements');
    await call('GET', '/api/chits/sent');
    ok('Order (/sent): the count and the page both carry it', has() >= 2);
    await call('GET', '/api/chits/rollup?direction=received');
    ok('the track\'s tab counts (/rollup) carry it too', has() >= 2);
    await call('GET', '/api/chits/inbox?folder_id=' + FILED_F);
    ok('a folder the person NAMED shows its filing as is (no predicate — a bill moved there by hand stays)', has() === 0);
    ROWS[2].folder_id = FILED_F; USER_FOLDERS = [{ folder_id: FILED_F, parent_id: null, name: 'Urgent' }];
    const rc = await call('GET', '/api/folders/reconcile?scope=task');
    const r = rc.body;
    ok('reconcile: total = inbox + in bills + filed, and it says it adds up', r.reconciles === true && r.inbox + r.in_bills + r.filed === r.total && r.in_bills === 4 && r.filed === 1, JSON.stringify({ t: r.total, i: r.inbox, b: r.in_bills, f: r.filed, ok: r.reconciles }));
  } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack)); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
