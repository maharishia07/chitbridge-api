/* Walk AE R-F-04 (21 Nov): GET /api/till/summary counted a rail credit note (no counter, no slip) as a 10.50 SALE: Home 168.50 against the day close's 158.00.
   The live day fold now reads only counter bills. Hand figures in FILS (AED): sale 100.00 + sale 118.00 = 218.00; counter credit note 60.00 (refunded in cash) -> 158.00; rail credit note 10.50 is NOT a counter takings.
   Break check: drop the isCounterTakings filter and the total is 148.50 / a 10.50 sale row. Run: node tests/till-takings-1129.test.cjs */
// CARD      09-counter/day-close
'use strict';
const assert = require('assert');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { liveSummaries } = require('../routes/till');
const today = '2026-11-21';
const bill = (no, total, slip, extra) => Object.assign({ chit_id: no, created_at: today + 'T08:00:00Z', purpose: slip === 'credit_note' ? 'credit_note' : 'order',
  business_json: Object.assign({ bill_no: no, billed_at: today + 'T08:00:00Z', slip, till: { id: 'T1', name: 'Counter 1' } }, extra || {}), summary_json: { money: { total }, total_value: total } });
const rows = [
  bill('A1', 100, 'cash'),
  bill('A2', 118, 'tax'),
  bill('CN1', 60, 'credit_note', { refund: { total: 60, parts: [{ how: 'cash', amount: 60 }] } }),
  { chit_id: 'RAIL', created_at: today + 'T09:00:00Z', purpose: 'credit_note', business_json: { bill_no: 'RN-9', billed_at: today + 'T09:00:00Z' }, summary_json: { money: { total: 10.5 }, total_value: 10.5 } }
];
const out = liveSummaries(rows, [], today);
const minor = (x) => Math.round(x * 100);
assert.strictEqual(out.length, 1, 'one counter row only (the rail note made a second, till-less row)');
assert.strictEqual(out[0].till.id, 'T1');
assert.strictEqual(minor(out[0].totals.total), 15800, 'takings 158.00 AED, the day close figure');
assert.strictEqual(out[0].totals.count, 2);
assert.strictEqual(out[0].totals.returns, 1, 'only the counter credit note is a return');
console.log('1 passed · 6 checks');
