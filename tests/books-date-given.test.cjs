#!/usr/bin/env node
/**
 * books-date-given.test.cjs — ACC-274: a date the caller GIVES is read once, by books-period.dateGiven (dateOf and routes/books.js dateQ both go through it).
 *
 * OWNS      the proof that an ABSENT date falls back and a GIVEN one that is not a real YYYY-MM-DD day is a 400 DATE_INVALID naming the field (never today, never a 200).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the reader as a unit, refusalOf's answer, and the real route over a stand-in db (tests/api-problem-books.test.cjs rows date-given-*).
 * FLOW      value → dateGiven → day | throw { code DATE_INVALID, status 400, field } → refusalOf → Problem { status 400, code, field }
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const P = require('../lib/books-period');
const { refusalOf } = require('../lib/books-contract');
let n = 0;
const ok = (label, fn) => { fn(); n++; console.log('  ok  ' + label); };
const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };

ok('an absent date falls back (undefined, null, empty): today stays today', () => {
  [undefined, null, ''].forEach((v) => assert.strictEqual(P.dateGiven(v, 'date', '2026-11-08'), '2026-11-08'));
  assert.strictEqual(P.dateOf({}, 'date', '2026-11-08'), '2026-11-08');
  assert.strictEqual(P.dateGiven(undefined, 'date', null), null);
});
ok('a good day, and a date-time keeping its day, pass', () => {
  assert.strictEqual(P.dateGiven('2026-10-03', 'date', 'x'), '2026-10-03');
  assert.strictEqual(P.dateGiven('2026-10-03T18:30:00Z', 'date', 'x'), '2026-10-03');
  assert.strictEqual(P.dateGiven('2028-02-29', 'date', 'x'), '2028-02-29');
});
ok('03/10/2026, 2026-02-30, 2026-13-01 and words are refused, naming the field', () => {
  ['03/10/2026', '2026-02-30', '2026-13-01', '2027-02-29', 'tomorrow', '2026-1-3'].forEach((v) => {
    const e = refused(() => P.dateGiven(v, 'asOf', 'x'));
    assert(e && e.code === 'DATE_INVALID' && e.status === 400 && e.field === 'asOf' && e.given === v, v);
  });
  const e = refused(() => P.dateOf({ put_to_use: '03/10/2026' }, 'put_to_use', '2026-11-08'));
  assert(e && e.code === 'DATE_INVALID' && e.field === 'put_to_use');
});
ok('refusalOf answers it as a 400 Problem with code and field', () => {
  const spec = refusalOf(refused(() => P.dateGiven('03/10/2026', 'date', 'x')), { id: 'r' });
  assert.deepStrictEqual([spec.status, spec.code, spec.field], [400, 'DATE_INVALID', 'date']);
});
ok('a reader handed only the value gets its field from the request (query asOf, body date)', () => {
  const e = refused(() => P.dateGiven('03/10/2026', null, 'x'));
  assert.strictEqual(refusalOf(e, { query: { asOf: '03/10/2026' } }).field, 'asOf');
  assert.strictEqual(refusalOf(e, { body: { narration: 'n', date: '03/10/2026' } }).field, 'date');
});
ok('a bad value that also sits in another key names the date key, not the narration', () => {
  const e = refused(() => P.dateGiven('tomorrow', null, 'x'));
  assert.strictEqual(refusalOf(e, { body: { narration: 'tomorrow', date: 'tomorrow' } }).field, 'date');
  assert.strictEqual(refusalOf(e, { query: { note: 'tomorrow', asOf: 'tomorrow' } }).field, 'asOf');
});
ok('a missing required date (no default) is still the old question', () => {
  const e = refused(() => P.dateOf({}, 'date'));
  assert(e && e.code === 'BOOKS_BAD_REQUEST');
});
console.log('\n  ' + n + ' passed\n');
