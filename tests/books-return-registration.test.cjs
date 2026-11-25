/**
 * tests/books-return-registration.test.cjs — GREY-AU U-F-09: the answer of GET /returns for a shop that said it is NOT registered for the tax (lib/books-return-registration.js).
 * OWNS      the sentence in the pack's own words (never a typed GST), the empty form (no boxes, nothing to pay, needs 'registration'), and that the base answer is kept, not rebuilt.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      country + return name → notRegisteredWhy ; base + pack + return definition → unregisteredAnswer
 * CARD      14-accounting/tax-return
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const R = require('../lib/books-return-registration');
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
const au = R.notRegisteredWhy('AU', 'BAS'), ae = R.notRegisteredWhy('AE', 'VAT return'), none = R.notRegisteredWhy('AU', undefined);
ok('AU says GST and the BAS, from the pack', [/GST/.test(au), /BAS/.test(au)], [true, true]);
ok('AE says VAT and its own return word', [/VAT/.test(ae), /VAT return/.test(ae), /GST/.test(ae)], [true, true, false]);
ok('no return name: the sentence still reads (a "return" to lodge), never "undefined"', [/undefined/.test(none), /no return to lodge/.test(none)], [false, true]);
const base = { country: 'AU', keep: 'me' };
const out = R.unregisteredAnswer(base, 'AU', { short: 'BAS' });
ok('the empty form: refused to draw boxes, nothing payable, needs registration', [out.needs, out.boxes, out.periods, out.payable_minor, out.refund_minor, out.net_minor, out.period], ['registration', [], [], 0, 0, 0, null]);
ok('the base answer is kept (same object, nothing rebuilt)', [out === base, out.keep, out.country], [true, 'me', 'AU']);
ok('the sentence rides the answer', out.why, au);
console.log('\n' + checks + ' checks');
