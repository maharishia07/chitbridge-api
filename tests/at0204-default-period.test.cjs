/**
 * at0204-default-period.test.cjs — AT-03 (walk 25 Nov 2026): the ONE default period of a tax return (AU BAS quarter, AE VAT201 period).
 * Rule: named period, else the period holding a day asked (not after today), else the latest ENDED period that is not closed (what is due to lodge),
 * else the period running today, else the latest ended, else the first. Hand figures: today 2026-11-25, FY27 quarters (Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun).
 * Run: node tests/at0204-default-period.test.cjs
 * CARD      14-accounting/README
 */
'use strict';
const assert = require('assert');
const { choosePeriod } = require('../lib/books-period');
const TODAY = '2026-11-25';
const q = (period, start, end, closed) => ({ period, start, end, ended: end <= TODAY, closed: !!closed });
const quarters = (closed1) => [q('2026-Q1', '2026-07-01', '2026-09-30', closed1), q('2026-Q2', '2026-10-01', '2026-12-31'), q('2027-Q3', '2027-01-01', '2027-03-31'), q('2027-Q4', '2027-04-01', '2027-06-30')];
const pick = (periods, query, on) => choosePeriod(periods, query, on, TODAY).period;

assert.strictEqual(pick(quarters(false), {}, null), '2026-Q1', 'Jul-Sep ended and not closed: the one to lodge, never the future Q4');
assert.strictEqual(pick(quarters(true), {}, null), '2026-Q2', 'Jul-Sep closed: the quarter running today (Oct-Dec 2026)');
assert.notStrictEqual(pick(quarters(true), {}, null), '2027-Q4', 'a future quarter is never the default');
assert.strictEqual(pick(quarters(false), { period: '2027-Q3' }, null), '2027-Q3', 'a period named is honoured');
assert.strictEqual(pick(quarters(false), {}, '2026-11-01'), '2026-Q2', 'a day asked names its quarter');
assert.strictEqual(pick(quarters(false), { period: 'nope' }, null), '2026-Q1', 'an unknown name falls to the default');
/* AE: the VAT201 table is the same shape, so the same rule: Feb-Apr and May-Jul 2026 stagger 1, today 2026-06-10 */
const ae = [{ period: '2026-02/2026-04', start: '2026-02-01', end: '2026-04-30', ended: true }, { period: '2026-05/2026-07', start: '2026-05-01', end: '2026-07-31', ended: false }];
assert.strictEqual(choosePeriod(ae, {}, null, '2026-06-10').period, '2026-02/2026-04');
assert.strictEqual(choosePeriod(ae.map((p, i) => (i ? p : Object.assign({}, p, { closed: true }))), {}, null, '2026-06-10').period, '2026-05/2026-07');
console.log('at0204-default-period: 8 passed');
