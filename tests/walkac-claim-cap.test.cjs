/**
 * walkac-claim-cap.test.cjs - walk AC 1129 AC-F-04: the tax with no tax invoice that a return carries is never more than the box it sits in.
 * Hand (AE VAT201): purchases' input VAT with no invoice 35.00; a credit note of 5.00 took Box 13 down to 30.00 -> carried 30.00 (not "35.00 of 30.00"); a box that holds more is left alone.
 * Run: node tests/walkac-claim-cap.test.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const Ev = require('../lib/books-evidence');
const T = require('../lib/books-period-taxed');
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
(async () => {
  const inputRoles = Ev.inputRoles;
  Ev.inputRoles = () => new Set(['input_vat']);
  Ev.unsupportedIn = async () => ({ count: 2, tax_minor: 3500, from: '2026-10-01', to: '2026-12-31', currency: 'AED' });
  const ask = (amount) => ({ pack: {}, cur: 'AED', period: { start: '2026-10-01', end: '2026-12-31' }, boxes: [{ code: '13', roles: ['input_vat'], amount_minor: amount }] });
  const a = await T.unsupportedInput(null, 'e', ask(3000));
  eq('Box 13 30.00: the no-invoice tax is carried as 30.00, box 13', [a.tax_minor, a.box], [3000, '13']);
  const b = await T.unsupportedInput(null, 'e', ask(5000));
  eq('Box 13 50.00: the 35.00 stays', b.tax_minor, 3500);
  Ev.inputRoles = inputRoles;
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ok ' + pass + ' passed') + '\n');
  process.exit(fail ? 1 : 0);
})();
