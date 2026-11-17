'use strict';
/**
 * tests/l16-money-ops.test.cjs — the books' sums, differences and roundings go through the engine's money operators (CUR-1, ACC-206).
 *
 * OWNS      GOLDEN cases for lib/books-money-ops.js: each gives the figure the hand sum or hand rounding gave before it moved, in two currencies
 *           (2 decimals and 0 decimals), and a mismatch or a part-unit REFUSES rather than passing through.
 * CALLED BY .github/workflows/ci.yml (l16 offline tests)
 * FLOW      fixed rows in ──▶ books-money-ops ──▶ compared with the figure worked by hand once, here, as a constant (never recomputed by a second formula)
 * CARD      14-accounting/README
 */
const assert = require('assert');
const MO = require('../lib/books-money-ops');
const R = require('../lib/books-report-period');
let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log('   ok   ' + name);
};
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

ok('a list of rows adds to the figure the hand sum gave (AUD, strings from the database read as numbers)', () => {
  const lines = [{ dr_minor: '123456' }, { dr_minor: 789 }, { dr_minor: '0' }, { dr_minor: null }];
  assert.strictEqual(MO.sumMinor(lines, 'AUD', (line) => line.dr_minor), 124245);
});
ok('an empty or missing list is 0 and a list of bare amounts needs no picker (JPY, no decimals)', () => {
  assert.strictEqual(MO.sumMinor([], 'AUD'), 0);
  assert.strictEqual(MO.sumMinor(null, 'AUD'), 0);
  assert.strictEqual(MO.sumMinor([1200, -300, 5], 'JPY'), 905);
});
ok('a difference keeps its sign (credit minus debit) and an addition carries it', () => {
  assert.strictEqual(MO.diffMinor(5, 9, 'INR'), -4);
  assert.strictEqual(MO.diffMinor('1000', '250', 'INR'), 750);
  assert.strictEqual(MO.addMinor(-4, 10, 'INR'), 6);
});
ok('a figure is rounded to whole minor units half AWAY from zero, both signs (what half() did for basis points)', () => {
  assert.strictEqual(MO.roundMinor(0.5, 'AUD'), 1);
  assert.strictEqual(MO.roundMinor(-0.5, 'AUD'), -1);
  assert.strictEqual(MO.roundMinor(6666.666666, 'AUD'), 6667);
  assert.strictEqual(MO.roundMinor(-13333.5, 'AUD'), -13334);
  assert.strictEqual(MO.roundMinor('1250', 'AUD'), 1250);
});
ok('the report bands keep their golden basis points (change of 120.00 on 100.00 is +20.00%, a share of 25.00 on 200.00 is 12.50%)', () => {
  assert.strictEqual(R.changeOf(12000, 10000, 'AUD'), 2000);
  assert.strictEqual(R.shareOf(2500, 20000, 'AUD'), 1250);
  assert.strictEqual(R.changeOf(-10001, 30000, 'AUD'), -13334);
  assert.strictEqual(R.changeOf(5, 0, 'AUD'), null);
});
ok('no currency REFUSES (MONEY_CURRENCY_MISSING) and an unlisted code REFUSES: an amount never travels bare', () => {
  assert.strictEqual(code(() => MO.sumMinor([1], undefined)), 'MONEY_CURRENCY_MISSING');
  assert.strictEqual(code(() => MO.diffMinor(1, 2, '')), 'MONEY_CURRENCY_MISSING');
  assert.notStrictEqual(code(() => MO.sumMinor([1], 'ZZZ')), null);
});
ok('a part of a minor unit REFUSES in a sum (the engine never rounds silently), and roundMinor is the one place that rounds', () => {
  assert.strictEqual(code(() => MO.sumMinor([1.5], 'AUD')), 'MONEY_AMOUNT_INVALID');
  assert.strictEqual(MO.roundMinor(1.5, 'AUD'), 2);
});

console.log('\n  ' + pass + ' passed\n');
