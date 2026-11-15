#!/usr/bin/env node
/**
 * availability-range-refusal.test.cjs — a typed or fed stock figure has a ceiling, a precision and a floor date (CAT-309, CAT-322, CAT-327; 2026-11-15).
 * @type regression
 * OWNS      the proof that availability.refusal() answers in words for a quantity above one billion (1e300, 1e18, 1e308: the last was stored as null behind a 200),
 *           for a nonzero quantity that three decimals would store as 0 (0.0001), and for an as_of before 2000 (1970 = an unset clock); and that real figures
 *           (0, 0.4, 2.5, 7, 1000000000) and a recent date still pass.
 * CALLED BY scripts/guards.cjs · CI. Pure: lib/availability.js, no database. Both doors (PUT /:id/availability and POST /availability/bulk) ask refusal() before stamp().
 * FLOW      refusal({ qty, as_of }, nowIso) → sentence | null
 * CARD      06-catalogue-pim/schedule-and-availability
 *   node tests/availability-range-refusal.test.cjs
 */
'use strict';
const assert = require('node:assert');
const A = require('../lib/availability');
const NOW = '2026-11-15T10:00:00.000Z';
let pass = 0, fail = 0;
function it(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).split('\n')[0]); } }

for (const big of [1e300, 1e18, 1e308, '1e18', 1000000001]) {
  it('CAT-309/322: qty ' + JSON.stringify(big) + ' is refused above the ceiling', () => {
    assert.match(A.refusal({ qty: big }, NOW), /cannot be more than 1000000000/);
  });
}
it('CAT-322: qty 0.0001 (would be stored as 0 behind a 200) is refused in words', () => {
  assert.match(A.refusal({ qty: 0.0001 }, NOW), /more than three decimals/);
});
for (const ok of [0, 0.4, 2.5, 7, '12', 0.001, 1000000000]) {
  it('real figure ' + JSON.stringify(ok) + ' is not refused', () => { assert.strictEqual(A.refusal({ qty: ok }, NOW), null); });
}
for (const old of ['1970-01-01', '1970-01-01T00:00:00Z', '1999-12-31T23:59:59Z']) {
  it('CAT-327: as_of ' + old + ' is refused as before 2000', () => {
    assert.match(A.refusal({ qty: 7, as_of: old }, NOW), /before 2000/);
  });
}
it('CAT-327: as_of 2031 (future) and tomorrow stay refused; yesterday and 2000-01-01 pass', () => {
  assert.match(A.refusal({ qty: 7, as_of: '2031-01-01T00:00:00Z' }, NOW), /future/);
  assert.match(A.refusal({ qty: 7, as_of: '2026-11-16T10:00:00Z' }, NOW), /future/);
  assert.strictEqual(A.refusal({ qty: 7, as_of: '2026-11-14T10:00:00Z' }, NOW), null);
  assert.strictEqual(A.refusal({ qty: 7, as_of: '2000-01-01T00:00:00Z' }, NOW), null);
});
it('CAT-327: a junk date is still refused, not replaced by now', () => {
  assert.match(A.refusal({ qty: 7, as_of: 'yesterday-ish' }, NOW), /must be a date/);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
