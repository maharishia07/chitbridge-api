#!/usr/bin/env node
// @type: unit
/**
 * c11-10a-supplies-bounds.test.cjs — C11 input-shape sweep, batch 10a (12 Nov 2026): the supplies doors refuse a figure past its column, a day that is no day or past tomorrow and a blank name, in words, before anything is written.
 *
 * OWNS      the schema of the five supplies operations (lib/supplies-contract.js BODIES: B.qty / B.amount / B.day / B.text / B.flag / B.list), numeric text read against the same bounds in the store (numbersOf),
 *           the "not later than tomorrow" rule on the shop's clock (atTooLate, lib/supplies-contract.js), the Idempotency-Key as the ref of an issue (issueRefOf, OPS-10). The routes' own 422 answers (nothing reaches the database) are scenes of
 *           tests/api-problem-supplies.test.cjs. A unit the shop types ("tray") and a numeric text the store always read ("2") stay taken.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      OPERATIONS[key] → schemaValidate → the answer a stand-in response sees; the pure functions of lib/supply-store.js
 * CARD      16-finance/supplies-routes
 * MIN unit — each refusal case is 422 with its field named; each accepted case calls next.
 * TRACE     lib/supplies-contract.js BODIES ← this test · lib/supply-store.js numbersOf · lib/supplies-contract.js atTooLate, issueRefOf ← this test
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const path = require('path');
const HERE = path.join(__dirname, '..');
const { OPERATIONS, atTooLate, issueRefOf } = require(path.join(HERE, 'lib', 'supplies-contract.js'));
const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate.js'));
const store = require(path.join(HERE, 'lib', 'supply-store.js'));
const clock = require(path.join(HERE, 'lib', 'shop-clock.js'));

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) {
    failed++;
    console.log('  FAIL  ' + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
  }
};
const ID = '77777777-7777-4777-8777-777777777777';
const run = (key, body) =>
  new Promise((done) => {
    const req = { body, query: {}, params: { id: ID }, headers: {}, method: key.split(' ')[0], id: 'req-test' };
    const res = { status(code) { this.code = code; return this; }, set() {}, getHeader() {}, json(answer) { done({ status: this.code, fields: (answer.errors || []).map((one) => one.field), detail: answer.detail }); } };
    schemaValidate(OPERATIONS[key])(req, res, () => done({ status: 'next' }));
  });
const PURCHASE = 'POST /api/supplies/purchase';
const ISSUE = 'POST /api/supplies/:id/issue';
const EDIT = 'PATCH /api/supplies/:id';
const ADD = 'POST /api/supplies';
const line = (more) => ({ ref: 'BILL-1', lines: [Object.assign({ name: 'Floor cleaner', qty: 1, cost: 40 }, more)] });

(async () => {
  const refused = [
    ['1e308 quantity on a purchase line', PURCHASE, line({ qty: 1e308 }), 'lines.0.qty'],
    ['1e20 cost on a purchase line', PURCHASE, line({ cost: 1e20 }), 'lines.0.cost'],
    ['a quantity that is a list', PURCHASE, line({ qty: [1] }), 'lines.0.qty'],
    ['a day that is garbage', PURCHASE, Object.assign(line(), { at: 'garbage' }), 'at'],
    ['year 0001', PURCHASE, Object.assign(line(), { at: '0001-01-01' }), 'at'],
    ['a thousand lines', PURCHASE, { ref: 'B', lines: Array.from({ length: 501 }, () => ({ name: 'x', qty: 1 })) }, 'lines'],
    ['1e308 used', ISSUE, { qty: 1e308 }, 'qty'],
    ['0 used', ISSUE, { qty: 0 }, 'qty'],
    ['a blank name on an edit', EDIT, { name: '' }, 'name'],
    ['keep_stock that is a word', EDIT, { keep_stock: 'yes' }, 'keep_stock'],
    ['keep_stock that is a word on an add', ADD, { name: 'x', keep_stock: 'yes' }, 'keep_stock'],
    ['a name of 5000 characters', ADD, { name: 'x'.repeat(5000) }, 'name']
  ];
  for (const [name, key, body, field] of refused) {
    const got = await run(key, body);
    check(name + ': 422', got.status === 422, got);
    check(name + ': names ' + field, (got.fields || []).includes(field), got);
  }
  const taken = [
    ['a tray as a unit, a null cost, text figures', PURCHASE, { ref: 'B', at: '2026-11-12T10:00:00Z', lines: [{ name: 'x', unit: 'tray', qty: '3', cost: null }] }],
    ['a purchase line of nothing (a 200 that lists it as failed)', PURCHASE, line({ qty: 0 })],
    ['an edit that retires', EDIT, { retired: true, keep_stock: null }],
    ['2 used', ISSUE, { qty: 2, ref: 'USE-1' }]
  ];
  for (const [name, key, body] of taken) check(name + ': taken', (await run(key, body)).status === 'next', await run(key, body));

  check('numeric text past the column: too large', store.numbersOf({ qty: '1e300' }).why === 'the quantity is too large', store.numbersOf({ qty: '1e300' }));
  check('numeric text cost past the ceiling: too large', store.numbersOf({ qty: '2', cost: '1e20' }).why === 'the cost is too large', store.numbersOf({ qty: '2', cost: '1e20' }));
  check('a negative cost keeps its own words', store.numbersOf({ qty: 2, cost: -1 }).why === 'the cost must be a number, 0 or more');
  check('numeric text inside the bounds is read', store.numbersOf({ qty: '2.5', cost: '40' }).qty === 2.5);

  clock.set('2026-11-12T10:00:00Z');
  check('today is not late', atTooLate('2026-11-12') === false);
  check('tomorrow is not late', atTooLate('2026-11-13T09:00:00Z') === false);
  check('the day after tomorrow is late', atTooLate('2026-11-14') === true);
  check('2099 is late', atTooLate('2099-01-01') === true);
  check('no day is not late', atTooLate(undefined) === false && atTooLate(null) === false && atTooLate('') === false);
  check('a list body has no day ([].at is a function)', atTooLate([].at) === false);
  clock.reset();

  check('the ref of an issue: the caller own wins', issueRefOf('USE-1', 'key-1') === 'USE-1');
  check('the ref of an issue: the key makes it, the same each time', issueRefOf(undefined, 'key-1') === 'use-key-1' && issueRefOf('', 'key-1') === issueRefOf(undefined, 'key-1'));
  check('the ref of an issue: neither: the store makes its own', issueRefOf(undefined, undefined) === undefined);

  console.log(failed ? '\n  ' + failed + ' failed' : '\n  every check held');
  process.exit(failed ? 1 : 0);
})();
