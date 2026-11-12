/**
 * acc-265b-note-after-cancel.test.cjs — ACC-265b: a credit note is not raised against a bill the books already took back, and a REJECTED sale with a live note is not rejected (offline; real-Postgres:
 * acc-265b-note-after-cancel.realstack.cjs).
 * Gap 1: lib/credit-cap billOf ignored a withdrawn (cancelled / rejected) bill, so a note struck after the cancel posted a second reversal (hand, IN: sale 118000 reversed to 0, the note then
 *   leaves 1300 Receivables -35400, 4090 Sales returns +30000, 2200/2201 +2700 each, no sale left). Now: 409 BILL_WITHDRAWN, nothing written, NOT a waiting code (a till queue must not resend it).
 * Gap 2: lib/rail-status creditNoteRefusal asked for to = cancelled only; rejected is a withdrawal the books reverse the same way (rail-actions WITHDRAWN, the one list).
 * Run: node tests/acc-265b-note-after-cancel.test.cjs
 * CARD 01-rail-core-the-chit/status-the-one-status-writer (ACC-265b)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cap = require('../lib/credit-cap');
const lock = require('../lib/xact-lock');
const railStatus = require('../lib/rail-status');
const chitPaid = require('../lib/chit-paid');
const railActions = require('../lib/rail-actions');

let pass = 0, fail = 0;
const ok = (name, good, why) => { if (good) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-265265265b65', BILL = 'b0000000-0000-4000-8000-00000000265b', NOTE = 'c0000000-0000-4000-8000-00000000265b';
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

/** a note send, answered by a stand-in database holding one bill row (withdrawn or not) */
function noteAgainst(billRow, byNumber) {
  const client = { query: async (sql, params) => {
    if (sql === lock.LOCK_SQL) return { rows: [] };
    if (/ANY\(\$4::text\[\]\)/.test(sql)) return { rows: [billRow] };
    if (/DISTINCT ON/.test(sql)) return { rows: [] };
    throw new Error('unexpected sql ' + sql.slice(0, 60));
  } };
  const against = byNumber ? { bill_no: 'B-1' } : { bill_no: 'B-1', chit_id: BILL };
  return cap.holdUnderLock(client, { sender_id: SHOP, chit_id: NOTE, purpose: 'credit_note', currency_code: 'INR', is_draft: false,
    business_json: { till: { id: 'C1' }, against, refund: { total: 354 }, invoice: { ValDtls: { TotInvVal: 354 } } } }).then(() => 'ok', (e) => e);
}
const bill = (extra) => Object.assign({ chit_id: BILL, invoice_total: 1180, money_total: null, legacy_total: null, refund_total: null, bill_no: 'B-1', till_id: 'C1', currency_code: 'INR', withdrawn: false }, extra || {});

/** the world one statusGate asks (as tests/acc-265-cancel-credit-note.test.cjs) */
function world(status, notes) {
  const log = [];
  return { log, query: async (sql, params) => {
    const one = String(sql).replace(/\s+/g, ' ').trim(); log.push({ sql: one, params });
    if (/^SELECT current_status FROM chit_status/.test(one)) return { rows: [{ current_status: status }] };
    if (one === lock.LOCK_SQL) return { rows: [] };
    if (/WHERE h\.chit_id = \$1 AND h\.entity_id = \$2 AND h\.sender_entity_id = \$2 AND h\.purpose = ANY/.test(one)) return { rows: [{ chit_id: BILL, bill_no: 'B-1', till_id: 'C1' }] };
    if (/DISTINCT ON \(h\.chit_id\)/.test(one)) return { rows: notes.map((id) => ({ chit_id: id })) };
    throw new Error('unexpected sql ' + one.slice(0, 90));
  } };
}

(async () => {
  console.log('\n== ACC-265b · a note after the cancel · a reject with a live note ==\n');
  /* gap 1 */
  let r = await noteAgainst(bill({ withdrawn: true }));
  ok('G1 · a note naming a cancelled bill by its id: 409 BILL_WITHDRAWN, a thrown refusal in words', r && r.refused === true && r.status === 409 && r.code === 'BILL_WITHDRAWN' && /was cancelled/.test(r.message) && /already reversed/.test(r.message), String(r && (r.code || r)));
  r = await noteAgainst(bill({ withdrawn: true }), true);
  ok('G1 · the same by bill number (one bill on its till)', r && r.code === 'BILL_WITHDRAWN' && r.status === 409, String(r && (r.code || r)));
  r = await noteAgainst(bill());
  ok('G1 · a live bill: the note is judged as before (inside the cap, ok)', r === 'ok', String(r && (r.code || r)));
  ok('G1 · BILL_WITHDRAWN is not a waiting code (middleware/idempotency WAITING_CODES keeps only BILL_NOT_RECORDED)', !/WAITING_CODES = new Set\([^)]*BILL_WITHDRAWN/.test(read('middleware/idempotency.js')));
  ok('G1 · the one reader: billOf selects the withdrawn flag with counter-bill WITHDRAWN_TEST (not a second status read)', /\$\{counterBill\.WITHDRAWN_TEST\} AS withdrawn/.test(read('lib/credit-cap.js')));
  /* gap 2 */
  chitPaid.paidFactsOf = async () => false;
  const gate = (db, to) => railStatus.statusGate(db, SHOP, BILL, to, railStatus.SYSTEM, { copy: 'sent' });
  let db = world('pending', [NOTE]); let g = await gate(db, 'rejected');
  ok('G2 · rejected with a live note: has_credit_note, the note named, nothing written', g.ok === false && g.why === 'has_credit_note' && g.notes[0] === NOTE && !db.log.some((e) => /^(UPDATE|INSERT)/.test(e.sql)), JSON.stringify({ ok: g.ok, why: g.why }));
  db = world('pending', []); g = await gate(db, 'rejected');
  ok('G2 · rejected with no note goes through (a plain reject of a sale is allowed, as before)', g.ok === true && !g.noop);
  db = world('pending', [NOTE]); g = await gate(db, 'cancelled');
  ok('G2 · cancelled with a live note still refused (ACC-265 kept)', g.why === 'has_credit_note');
  db = world('pending', [NOTE]); g = await gate(db, 'accepted');
  ok('G2 · a move that is neither never asks for notes', !db.log.some((e) => /DISTINCT ON/.test(e.sql)));
  ok('G2 · the list is the rail\'s own WITHDRAWN (rejected, cancelled): no second spelling in rail-status', /railActions\.WITHDRAWN\.includes\(to\)/.test(read('lib/rail-status.js')) && railActions.WITHDRAWN.join() === 'rejected,cancelled');
  ok('G2 · the words cover both moves', /cancelled or rejected/.test(railStatus.creditNoteSaid([NOTE]).message));
  const reg = JSON.parse(read('docs/error-codes.json')).codes.filter((row) => row.code === 'BILL_WITHDRAWN');
  ok('G1 · BILL_WITHDRAWN is registered once (409, a sentence, a hint) in docs/error-codes.json and docs/ERROR-CODES.md', reg.length === 1 && reg[0].status === '409' && reg[0].shopkeeper !== 'PENDING' && /BILL_WITHDRAWN \| 409/.test(read('docs/ERROR-CODES.md')));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
