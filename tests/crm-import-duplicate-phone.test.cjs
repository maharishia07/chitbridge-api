/**
 * crm-import-duplicate-phone.test.cjs — CR-06b offline: a CSV row whose phone the shop already holds is NOT a second party.
 * A-F-46 (26adb0627): a match is a MERGE onto the existing party (outcome 'merge', party_id handed back, stage and added_via untouched),
 * never an 'add'; a new phone is an 'add'; a DELETED party matches nobody. No DB: lib/crm-leads plan() + shape() over the shop's parties.
 * Real-Postgres twin: tests/crm-truth.realstack.cjs CR-06b.
 */
'use strict';
const assert = require('assert'), path = require('path');
const CL = require(path.join(__dirname, '..', 'lib', 'crm-leads'));
let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok    ' + label); };
const lead = { identity_id: 'P1', digits: '9876510077', name_fold: 'counter twin', minted: true, on_customer: true, added_via: 'lead', txn_count: 0, supplier: false, removed: false };
const run = (rows, existing) => { const r = CL.normalise(rows); CL.plan(r, existing); return CL.shape(r, true); };

ok('the same phone as an existing lead: merged into it, never added (one party), its id handed back', () => {
  const s = run([{ name: 'Import Twin', phone: '9876510077' }, { name: 'Import New', phone: '9876510078' }], [lead]);
  assert.strictEqual(s.added, 1); assert.strictEqual(s.merged, 1); assert.strictEqual(s.skipped.length, 0);
  assert.strictEqual(s.rows[0].outcome, 'merge'); assert.strictEqual(s.rows[0].party_id, 'P1'); assert.strictEqual(s.rows[1].outcome, 'add');
});
ok('typed with +91 and spaces (same last 9 digits, not the same number): never added; named and skipped (CRM-243)', () => {
  const s = run([{ name: 'Format Twin', phone: '+91 98765 10077' }], [lead]);
  assert.strictEqual(s.added, 0); assert.strictEqual(s.rows[0].outcome, 'skip'); assert.ok(/^Same phone as /.test(s.rows[0].why));
});
ok('the same phone twice in one file: the first row stands, the second is skipped with its reason', () => {
  const s = run([{ name: 'Dup One', phone: '9876510099' }, { name: 'Dup Two', phone: '9876510099' }], []);
  assert.strictEqual(s.added, 1); assert.strictEqual(s.skipped.length, 1); assert.ok(/Same phone as row/.test(s.skipped[0].why));
});
ok('a customer or supplier holding the phone is merged into too, with no stage change planned', () => {
  const s = run([{ name: 'Buyer', phone: '9876510077' }], [Object.assign({}, lead, { added_via: 'counter', txn_count: 4, supplier: true })]);
  assert.strictEqual(s.rows[0].outcome, 'merge'); assert.strictEqual(s.added, 0);
});
ok('a DELETED party matches nobody: the row is added as a new party', () => {
  const s = run([{ name: 'Fresh Face', phone: '9876510077' }], [Object.assign({}, lead, { removed: true })]);
  assert.strictEqual(s.added, 1); assert.strictEqual(s.merged, 0);
});
console.log('\n' + pass + ' checks');
