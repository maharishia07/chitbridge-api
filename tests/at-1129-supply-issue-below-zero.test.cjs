'use strict';
/**
 * at-1129-supply-issue-below-zero.test.cjs — batch 1129 fixAT, AT-F-03 (walk AT 22 Nov): a supply "used some" beyond what is on hand (99 against 12) was accepted, balance -87.
 * The real stock-store.post over a stand-in database (one balance row, the movement log): 99 against 12 is refused in words with nothing written; 12 against 12 goes to 0;
 * a resend of the same ref after that is a duplicate, not a refusal; a till-style movement (no refuse_below_zero) still goes below zero and says below_zero (offline counters never block a sale).
 * No GOV setting for negative stock exists (grep FIELDS.md / policy.js): the supplies door refuses, the till keeps warning. Run: node tests/at-1129-supply-issue-below-zero.test.cjs
 */
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const assert = require('node:assert');
const stock = require('../lib/stock-store');
let bal, log;
const db = {
  query: async (sql, p) => {
    if (/INSERT INTO stock_balance/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM stock_balance/.test(sql)) return { rows: [{ qty: bal.qty, value: bal.value, avg_cost: bal.avg, unit: bal.unit }], rowCount: 1 };
    if (/SELECT 1 FROM stock_movement/.test(sql)) return { rows: log.some((m) => m.ref === p[1]) ? [{}] : [], rowCount: 1 };
    if (/INSERT INTO stock_movement/.test(sql)) { if (log.some((m) => m.ref === p[8])) return { rows: [], rowCount: 0 }; log.push({ ref: p[8], qty: p[3] }); return { rows: [{ movement_id: 'm' + log.length, at: new Date() }], rowCount: 1 }; }
    if (/UPDATE stock_balance/.test(sql)) { bal.qty = p[3]; bal.value = p[4]; return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  }
};
const withEntity = async (id, fn) => fn(db);
const issue = (qty, ref, extra) => stock.post('e1', Object.assign({ item_id: 's1', item_kind: 'supply', reason: 'issued', qty, unit: 'pcs', ref, line_ref: '1' }, extra || {}), withEntity, {});
(async () => {
  bal = { qty: 12, value: 66, avg: 5.5, unit: 'pcs' }; log = [];
  let r = await issue(99, 'u1', { refuse_below_zero: true });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /only 12 pcs on hand, so 99 cannot be recorded as used/);
  assert.strictEqual(log.length, 0, 'nothing written');
  assert.strictEqual(bal.qty, 12, 'balance untouched');
  r = await issue(12, 'u2', { refuse_below_zero: true });
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(r.balance.qty, 0);
  r = await issue(12, 'u2', { refuse_below_zero: true });
  assert.strictEqual(r.ok, true, 'a resend of the same ref is a duplicate, not a refusal: ' + r.why);
  assert.strictEqual(r.duplicate, true);
  bal = { qty: 2, value: 11, avg: 5.5, unit: 'pcs' }; log = [];
  r = await issue(5, 't1');
  assert.strictEqual(r.ok, true, 'the till path (no flag) still goes below zero');
  assert.strictEqual(r.below_zero, true);
  console.log('ok at-1129-supply-issue-below-zero');
})().catch((e) => { console.error(e); process.exit(1); });
