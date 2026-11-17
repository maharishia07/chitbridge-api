#!/usr/bin/env node
/**
 * books-month-given.test.cjs — FIN-103 · ACC-333 · ACC-334: a date, month or form the caller GIVES is read once and a bad one is a 400, never a 500 and never a default.
 *
 * OWNS      the proof that the books' year range (1900–2100) holds for a day (asOf 9999-12-31 was a RangeError 500), that a month is read by books-period.monthGiven
 *           (2026-13 · 0001-01 · 9999-12 were 500; abc · 2026-02-30 were this month), and that an unknown GSTR form is a 400 naming the allowed forms (gstr9 was gstr1).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the readers as units, monthBounds, the refusal's Problem, and the route's form check by source.
 * FLOW      value → dateGiven | monthGiven → day/month | throw { code DATE_INVALID, status 400, field } → tax-contract.readFault / books-contract.refusalOf → Problem 400
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/books-period');
const C = require('../lib/tax-copy');
const { readFault } = require('../lib/tax-contract');
let n = 0;
const ok = (label, fn) => { fn(); n++; console.log('  ok  ' + label); };
const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };
const IN = { country: 'IN', timezone: 'Asia/Kolkata' };

ok('FIN-103: a day outside 1900-2100 is refused naming asOf (9999-12-31 was a RangeError); the ends of the range pass', () => {
  ['9999-12-31', '0001-01-01', '1899-12-31', '2101-01-01'].forEach((v) => {
    const e = refused(() => P.dateGiven(v, 'asOf', 'x'));
    assert(e && e.code === 'DATE_INVALID' && e.status === 400 && e.field === 'asOf' && e.given === v, v);
  });
  assert.strictEqual(P.dateGiven('1900-01-01', 'asOf', 'x'), '1900-01-01');
  assert.strictEqual(P.dateGiven('2100-12-31', 'asOf', 'x'), '2100-12-31');
  assert.strictEqual(P.dateGiven('', 'asOf', '2026-11-09'), '2026-11-09'); /* absent keeps its documented default */
});
ok('ACC-333: 2026-13 · 0001-01 · 9999-12 are refused naming month; ACC-334: abc · 2026-02-30 · 2026-1 too', () => {
  ['2026-13', '0001-01', '9999-12', 'abc', '2026-02-30', '2026-1', '2026-00', '2026-10-01', '1899-12', '2101-01'].forEach((v) => {
    const e = refused(() => P.monthGiven(v, 'month', '2026-11'));
    assert(e && e.code === 'DATE_INVALID' && e.status === 400 && e.field === 'month' && e.given === v, v);
  });
});
ok('a good month passes (hand: 2026-10, the ends 1900-01 and 2100-12), an absent one takes the fallback', () => {
  ['2026-10', '2026-02', '1900-01', '2100-12'].forEach((v) => assert.strictEqual(P.monthGiven(v, 'month', 'x'), v));
  [undefined, null, ''].forEach((v) => assert.strictEqual(P.monthGiven(v, 'month', '2026-11'), '2026-11'));
});
ok('monthBounds (the one reader behind /tax/ledger and /tax/gstr): hand figures for 2026-10 in IST, and every bad month refused', () => {
  const b = C.monthBounds('2026-10', IN);
  /* Oct 2026 starts 2026-10-01 00:00 IST = 2026-09-30T18:30Z; November starts 2026-10-31T18:30Z; period MMYYYY */
  assert.deepStrictEqual([b.from, b.to, b.period, b.month], ['2026-09-30T18:30:00.000Z', '2026-10-31T18:30:00.000Z', '102026', '2026-10']);
  const dec = C.monthBounds('2026-12', IN);
  assert.strictEqual(dec.to, '2026-12-31T18:30:00.000Z');
  ['2026-13', '0001-01', '9999-12', 'abc', '2026-02-30'].forEach((v) => assert(refused(() => C.monthBounds(v, IN)), v));
  assert(C.monthBounds('', IN).month && C.monthBounds(undefined, IN).month); /* absent → the shop's month */
});
ok('the refusal travels as a 400 DATE_INVALID Problem naming the field on the tax routes (not the 500 TAX_FAILED)', () => {
  const spec = readFault(refused(() => P.monthGiven('2026-13', 'month', 'x')), { id: 'r' });
  assert.deepStrictEqual([spec.status, spec.code, spec.field], [400, 'DATE_INVALID', 'month']);
});
ok('ACC-334: /tax/gstr checks the form before any read and names the allowed forms (source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tax.js'), 'utf8');
  assert(/GSTR_FORMS = \['gstr1', 'gstr3b'\]/.test(src));
  assert(/!GSTR_FORMS\.includes\(form\)\)[^\n]*BAD_FORM[^\n]*GSTR_FORMS\.join/.test(src));
  const gstr = src.slice(src.indexOf("router.get('/gstr'"));
  assert(gstr.indexOf('GSTR_FORMS.includes(form)') < gstr.indexOf('C.ledgerFor('));
});
console.log('books-month-given: ' + n + ' checks passed');
