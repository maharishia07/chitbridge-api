/**
 * tests/books-split-units-1129.test.cjs - THE SMALL MODULES SPLIT OUT OF books.js, books-hooks.js AND catalogue-write.js KEEP THEIR RULES (readability 1129, behaviour unchanged).
 *
 * OWNS      the proof of lib/books-bill-order.js (oldest first, then the number on the paper, then the ref), lib/books-waiting-row.js (the todo is one of three words, the shortfall is integers,
 *           the near suppliers are at most three) and lib/catalogue-rate-menu.js (a rate the country does not list is refused in words; a row's own rate and a country with no menu are never judged).
 * CALLED BY the test library (api T1). Run: node tests/books-split-units-1129.test.cjs
 * CARD      14-accounting/books-health-to-do-outbox
 */
'use strict';
const assert = require('assert');
const path = require('path');
let checks = 0;
const check = (value, message) => (checks++, assert.ok(value, message));
const same = (actual, expected, message) => (checks++, assert.deepStrictEqual(actual, expected, message));

/* books-bill-order: one rule per tie-break */
const { oldestFirst } = require('../lib/books-bill-order');
const numbers = { a: 'INV-10', b: 'INV-9', c: 'INV-9', d: null };
const order = (bills) => bills.sort(oldestFirst(numbers)).map((bill) => bill.ref);
same(order([{ ref: 'a', due_date: '2026-02-01' }, { ref: 'b', due_date: '2026-01-01' }]), ['b', 'a'], 'the earlier due date first');
same(order([{ ref: 'a', date: '2026-01-02' }, { ref: 'b', date: '2026-01-01' }]), ['b', 'a'], 'no due date: the bill date decides');
same(order([{ ref: 'a', date: '2026-01-01' }, { ref: 'b', date: '2026-01-01' }]), ['b', 'a'], 'same day: the number on the paper counts numerically (9 before 10), never the chit id');
same(order([{ ref: 'c', date: '2026-01-01' }, { ref: 'b', date: '2026-01-01' }]), ['b', 'c'], 'same number: the ref is the last tie-break only');
same(order([{ ref: 'z' }, { ref: 'd' }]), ['d', 'z'], 'a bill with no number and no day is never refused a place');

/* books-waiting-row: the row's data, never its words */
const row = require('../lib/books-waiting-row');
same(row.TODOS, ['accept', 'add_supplier', 'record'], 'a waiting row asks one of three things');
same(row.shortOf({ theirs_minor: '1000.4', ours_minor: 900, short_minor: 100 }), { theirs_minor: 1000, ours_minor: 900, short_minor: 100 }, 'the shortfall figures are integers');
same(row.shortOf(null), null, 'no figures, no shortfall: nothing is invented');
same(row.todoFields({ todo: 'nonsense' }), { todo: 'record' }, 'a todo the row may not ask is refused and falls back to record');
same(row.todoFields({ todo: 'add_supplier', name: 'Sri', candidates: [1, 2, 3, 4] }).candidates.length, 3, 'at most three near suppliers ride the row');
const shown = row.waitingRow({ id: 7, why: 'not posted', tries: '2', todo: 'add_supplier', event: { job: 'chit', chit_id: 'c1', candidates: [{ name: 'Sri Traders', party_no: 'P1' }, { name: 'Sri Stores' }] } });
same([shown.todo, shown.reason, shown.tries, shown.job, shown.source.chit_id], ['add_supplier', 'not posted', 2, 'chit', 'c1'], 'the row carries data the screen branches on');
same(shown.candidates, [{ name: 'Sri Traders', party_no: 'P1' }, { name: 'Sri Stores', party_no: null }], 'near suppliers: name and party_no only');
same(row.waitingRow({ id: 8, event: { candidates: [{ name: 'x' }] } }).candidates, [], 'a row that is not an add-supplier row lists no candidates');

/* catalogue-rate-menu: a rate outside the country's list is refused in words (db read stubbed: no database) */
let country = 'AU';
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [{ country, gstn: country === 'AU' ? '51824753556' : null }] }), withEntity: async () => null } };
const menu = require('../lib/catalogue-rate-menu');
(async () => {
  const refusal = (rate, stored) => menu.rateMenuRefusal('e1', { gst_rate: rate }, stored);
  check(/15% is not one the tax rules of your country have\. The rates here are 0% or 10%/.test(await refusal(15)), 'a rate the country does not list is refused in words');
  same(await refusal(10), null, 'a listed rate passes');
  same(await refusal(undefined), null, 'no rate given: nothing to judge');
  same(await refusal('abc'), null, 'not a number: the schema judges that, not the menu');
  same(await refusal(15, { gst_rate: 15 }), null, 'the rate a stored row already holds is never refused (a legacy row stays editable)');
  country = 'XX';
  same(await refusal(15), null, 'a country with no menu judges nothing (the door stays open, never closed on a guess)');
  console.log('books-split-units-1129: all passed');
  console.log(checks + ' checks (' + path.basename(__filename) + ')');
})().catch((error) => {
  console.log('FAIL', error.message);
  process.exit(1);
});
