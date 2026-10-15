'use strict';
/**
 * page-limit.test.cjs — ⭐ LIM2 (W1-PLAT): THE ONE PAGER, every rule it enforces (DISCIPLINES §7, middleware/lib row).
 *
 *   limitOf   absent → default · above the max → the max · not a number → the default · 0 or negative → 1
 *   pageOf    a whole number ≥ 1
 *   pageArgs  not asked = every row (limit null, offset 0, page 1) · asked = the clamp + the offset · page alone asks · limit alone asks
 *   pageOut   not asked → the whole list, total = its length, limit = total · asked → the slice, total = the whole · a page past the end
 *             → an empty page with the true total · an already-cut page keeps its rows and the statement's total · a non-list → []
 *
 * Offline: no database, no server. Run: node tests/page-limit.test.cjs
 */
const assert = require('assert'), path = require('path');
const PL = require(path.join(__dirname, '..', 'lib', 'page-limit'));

let n = 0, fail = 0;
const ok = (what, fn) => { n++; try { fn(); console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
const ROWS = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i }));

console.log('\nTHE ONE PAGER — lib/page-limit\n');

ok('limitOf: absent → default · above the max → the max · not a number → the default · 0 and negative → 1', () => {
  assert.strictEqual(PL.limitOf(undefined, 20, 200), 20);
  assert.strictEqual(PL.limitOf('1000000', 20, 200), 200);
  assert.strictEqual(PL.limitOf('abc', 20, 200), 20);
  assert.strictEqual(PL.limitOf('0', 20, 200), 1);
  assert.strictEqual(PL.limitOf('-5', 20, 200), 1);
});
ok('pageOf: a whole number ≥ 1', () => {
  assert.strictEqual(PL.pageOf('-3'), 1); assert.strictEqual(PL.pageOf('7'), 7); assert.strictEqual(PL.pageOf(undefined), 1); assert.strictEqual(PL.pageOf('2.9'), 2);
});
ok('pageArgs: nothing asked → every row (limit null = LIMIT NULL, offset 0, page 1)', () => {
  assert.deepStrictEqual(PL.pageArgs({}, 50, 200), { asked: false, page: 1, limit: null, offset: 0 });
  assert.deepStrictEqual(PL.pageArgs(undefined, 50, 200), { asked: false, page: 1, limit: null, offset: 0 });
  assert.strictEqual(PL.WHOLE_LIST, null);
});
ok('pageArgs: asked → the clamp and the offset (page 3 of 200 → offset 400; ?limit=1000000 never beats the max)', () => {
  assert.deepStrictEqual(PL.pageArgs({ limit: '1000000', page: '3' }, 50, 200), { asked: true, page: 3, limit: 200, offset: 400 });
});
ok('pageArgs: ?page alone asks (default size) · ?limit alone asks (page 1)', () => {
  assert.deepStrictEqual(PL.pageArgs({ page: '2' }, 50, 200), { asked: true, page: 2, limit: 50, offset: 50 });
  assert.deepStrictEqual(PL.pageArgs({ limit: '10' }, 50, 200), { asked: true, page: 1, limit: 10, offset: 0 });
});
ok('pageOut: not asked → the whole list under its key, total = length, page 1, limit = total', () => {
  const out = PL.pageOut('items', ROWS, PL.pageArgs({}, 50, 200));
  assert.deepStrictEqual(Object.keys(out).sort(), ['items', 'limit', 'page', 'total']);
  assert.strictEqual(out.items.length, 7); assert.strictEqual(out.total, 7); assert.strictEqual(out.page, 1); assert.strictEqual(out.limit, 7);
});
ok('pageOut: asked → the slice, total = the whole (page 2 of 3 → rows 4..6)', () => {
  const out = PL.pageOut('items', ROWS, PL.pageArgs({ page: '2', limit: '3' }, 50, 200));
  assert.deepStrictEqual(out.items.map((r) => r.id), [4, 5, 6]); assert.strictEqual(out.total, 7); assert.strictEqual(out.page, 2); assert.strictEqual(out.limit, 3);
});
ok('pageOut: a page past the end → an empty page with the true total (the end-of-list marker)', () => {
  const out = PL.pageOut('items', ROWS, PL.pageArgs({ page: '9', limit: '3' }, 50, 200));
  assert.deepStrictEqual(out.items, []); assert.strictEqual(out.total, 7); assert.strictEqual(out.page, 9);
});
ok('pageOut: the statement already cut (total given) → rows kept as they are, total = the statement\'s count', () => {
  const out = PL.pageOut('items', ROWS.slice(0, 3), PL.pageArgs({ page: '2', limit: '3' }, 50, 200), '1234');
  assert.strictEqual(out.items.length, 3); assert.strictEqual(out.total, 1234); assert.strictEqual(out.limit, 3);
});
ok('pageOut: an empty list and a non-list both answer [] with total 0 — never "nothing"', () => {
  assert.deepStrictEqual(PL.pageOut('items', [], PL.pageArgs({}, 50, 200)), { items: [], total: 0, page: 1, limit: 0 });
  assert.deepStrictEqual(PL.pageOut('items', null, PL.pageArgs({ limit: '5' }, 50, 200)), { items: [], total: 0, page: 1, limit: 5 });
});

console.log('\n' + n + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exitCode = 1;
