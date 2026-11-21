#!/usr/bin/env node
// @type: unit
/**
 * tests/grey-au-seat-and-registration.test.cjs — GREY-AU (walk U, U-F-04 + U-F-09, batch 1129): the server's may/why, so the screen can grey with a sentence.
 * 1) GET /periods: a seat that is not the owner gets lock { may:false, why } and reopen { may:false, why } on every month (the owner's rows are untouched).
 * 2) GET /returns: a shop that said it is not registered gets { needs: 'registration', why: "This shop is not registered for GST, so there is no BAS to lodge." }, no boxes.
 * HAND-COMPUTED  AU: tax word GST, return BAS → the sentence above. AE: VAT, VAT return.
 * OWNS the offline guard of both.   CALLED BY scripts/guards.cjs.   CARD 14-accounting
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const lib = (f) => path.join(__dirname, '..', 'lib', f);
const A = require(lib('books-month-advice.js'));
const P = require(lib('books-return-registration.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400)); } };
const rows = [{ period: 1, lock: { may: true, why: null }, reopen: { may: false, why: null } }, { period: 2, lock: { may: false, why: 'Lock the earlier months first.' }, reopen: { may: true, why: 'Opening it again needs a reason.' } }];
t('the owner keeps the server rule for each month', () => assert.deepStrictEqual(A.seatAnswer(rows, { owner: true, why: 'x' }), rows));
t('another seat: every month says no, in its sentence, lock and reopen', () => {
  const out = A.seatAnswer(rows, { owner: false, why: 'Only the owner may do this.' });
  out.forEach((r) => { assert.deepStrictEqual(r.lock, { may: false, why: 'Only the owner may do this.' }); assert.strictEqual(r.reopen.may, false); assert.strictEqual(r.reopen.why, 'Only the owner may do this.'); });
  assert.strictEqual(rows[0].lock.may, true, 'the input is not changed');
});
t('GET /periods passes the answer through seatAnswer with the owner test', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
  assert.ok(/seatAnswer\(B\.periodAdvice\([^)]*\), \{ owner: isOwner\(req\)/.test(src));
});
t('the unregistered sentence: AU says GST and BAS, AE says VAT and VAT return', () => {
  assert.strictEqual(P.notRegisteredWhy('AU', 'BAS'), 'This shop is not registered for GST, so there is no BAS to lodge.');
  assert.strictEqual(P.notRegisteredWhy('AE', 'VAT return'), 'This shop is not registered for VAT, so there is no VAT return to lodge.');
});
t('taxReturn answers needs:registration only for an unregistered shop (never unknown)', () => {
  const src = fs.readFileSync(lib('books-period.js'), 'utf8');
  assert.ok(src.includes("const unregistered = (await require('./country-setup').registrationOfShop(entity)) === 'unregistered'") && src.includes("if (unregistered) return require('./books-return-registration').unregisteredAnswer(base, pack.id, returnsDef)"));
});
t('the empty answer: needs registration, the sentence, no boxes, nothing to pay', () => {
  const a = P.unregisteredAnswer({ form: 'BAS', short: 'BAS' }, 'AU', { short: 'BAS' });
  assert.strictEqual(a.needs, 'registration'); assert.strictEqual(a.why, 'This shop is not registered for GST, so there is no BAS to lodge.');
  assert.deepStrictEqual([a.boxes.length, a.net_minor, a.period], [0, 0, null]);
});
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
