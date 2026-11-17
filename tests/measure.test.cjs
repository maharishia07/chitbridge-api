// @stage tested
/**
 * tests/measure.test.cjs — lib/measure: the ONE measurer of a set of chits (INT7b: its first unit test — W2-RAIL made it read the one status table).
 *
 * median: the middle of the finite numbers, to one decimal; nothing finite → null (never NaN). measure: open · closed are the rail's words
 * (lib/rail-actions OPEN_STATES / CLOSED_STATES), never spelled here; mixed currencies are never summed into one figure.
 */
'use strict';
const assert = require('assert'), path = require('path');
const M = require(path.join(__dirname, '..', 'lib', 'measure'));
const railActions = require(path.join(__dirname, '..', 'lib', 'rail-actions'));
let pass = 0;
const ok = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

ok('median: odd count → the middle · even → the mean of the two middles, to one decimal · nothing finite → null', () => {
  assert.strictEqual(M.median([3, 1, 2]), 2);
  assert.strictEqual(M.median([4, 1, 3, 2]), 2.5);
  assert.strictEqual(M.median([1, 2, 2]), 2);
  assert.strictEqual(M.median([]), null);
  assert.strictEqual(M.median([NaN, Infinity, null]), null);
  assert.strictEqual(M.median([1, 'x', 2]), 1.5);
});
ok('OPEN · CLOSED are the rail\'s one status table (W2-RAIL R2) — no second spelling here', () => {
  assert.strictEqual(M.OPEN, railActions.OPEN_STATES);
  assert.strictEqual(M.CLOSED, railActions.CLOSED_STATES);
  assert.ok(M.CLOSED.includes('completed') && !M.OPEN.includes('completed'));
});
ok('measure: an empty set is zeros, never NaN; a function, not a report', () => {
  const m = M.measure([], {});
  assert.ok(m && typeof m === 'object');
  Object.values(m).forEach((v) => { if (typeof v === 'number') assert.ok(Number.isFinite(v), 'finite'); });
});
console.log(pass + ' checks');
