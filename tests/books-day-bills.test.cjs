'use strict';
/* M132: a walk-in day's source carries the bills it covers (chit_id + printed number), so "N bills" can open each one. Pure: sourceOf reads the row. */
const assert = require('assert');
const { sourceOf } = require('../routes/books')._test;
const day = { covers: 2, source_chit_id: null, source_ref: 'walkin:C5:2026-10-09', event_type: 'walkin_day', tenders: [],
  day_bills: [{ chit_id: 'a', ref: 'C5/26-27/0001' }, { chit_id: 'b', ref: 'C5/26-27/0002' }] };
const s = sourceOf(day);
assert.strictEqual(s.kind, 'day'); assert.strictEqual(s.count, 2);
assert.deepStrictEqual(s.bills.map((b) => b.ref), ['C5/26-27/0001', 'C5/26-27/0002']);
assert.strictEqual(sourceOf(Object.assign({}, day, { day_bills: null })).bills, null, 'no list read → null, the count still shows');
assert.strictEqual(sourceOf({ covers: null, source_chit_id: 'x', src_chit_id: 'x', src_ref: 'C5/1', event_type: 'sale_bill' }).bills, null, 'a single bill has no list');
console.log('books-day-bills: ok');
