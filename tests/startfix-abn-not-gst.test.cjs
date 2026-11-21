/**
 * startfix-abn-not-gst.test.cjs — A-F-14 (Walk A 21 Nov): in Australia the ABN (business number) and GST registration are TWO facts.
 *   1. typing an ABN alone does not make the shop "registered" (tax-facts.taxFactsOf / numberRegisters) — a GSTIN still does;
 *   2. "not registered" KEEPS the ABN (country-setup.save's merge + clean) — a GSTIN / TRN still goes with the registration;
 *   3. registrationOf: an AU shop with only an ABN is 'unknown' (a question), not 'regular'.
 * No database. Run: node tests/startfix-abn-not-gst.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const TF = require(path.join(API, 'lib', 'tax-facts'));
const CS = require(path.join(API, 'lib', 'country-setup'));
const ABN = '51824753556', GSTIN = '27AAPFU0939F1ZV';

console.log('\n══ A-F-14 · ABN is not GST registration ══\n');
eq('AU number registers? no', TF.numberRegisters('AU'), false);
eq('IN number registers? yes', TF.numberRegisters('IN'), true);
eq('AE number registers? yes', TF.numberRegisters('AE'), true);
eq('no country: old reading', TF.numberRegisters(null), true);
eq('AU ABN alone: registered null (not flipped)', TF.taxFactsOf(null, ABN, {}, TF.numberRegisters('AU')).registered, null);
eq('AU ABN alone: number still shown', TF.taxFactsOf(null, ABN, {}, false).number, ABN);
eq('IN GSTIN alone: registered true', TF.taxFactsOf(null, GSTIN, {}, TF.numberRegisters('IN')).registered, true);
eq('AU owner said yes: registered true', TF.taxFactsOf({ registered: true, number: ABN, scheme: 'regular' }, ABN, {}, false).registered, true);
eq('AU owner said no + ABN: registered false, number kept', TF.taxFactsOf({ registered: false, number: ABN }, ABN, {}, false), { registered: false, number: ABN, scheme: null });
eq('registrationOf AU ABN only -> unknown', CS.registrationOf({ country: 'AU', number: ABN }), 'unknown');
eq('registrationOf IN GSTIN only -> regular', CS.registrationOf({ country: 'IN', number: GSTIN }), 'regular');
eq('registrationOf AU said no -> unregistered', CS.registrationOf({ country: 'AU', number: ABN, tax_registration: { registered: false } }), 'unregistered');
eq('registrationOf AU said yes -> regular', CS.registrationOf({ country: 'AU', number: ABN, tax_registration: { registered: true } }), 'regular');
eq('registrationOf no country: a number is a registration (as before)', CS.registrationOf({ number: ABN }), 'regular');

const held = (n, reg) => ({ country: { code: 'AU' }, tax: { registered: reg, number: n, scheme: reg ? 'regular' : null } });
const base = { country: 'AU', currency: 'AUD', fy_start_month: 7 };
const au = CS.intake_ ? CS.intake_ : null;
if (au) {
  const r = au(held(ABN, true), Object.assign({ tax: { registered: false, number: null } }, base, { confirm_deregister: true }));
  eq('AU save "not registered": the ABN is kept', r.answers.tax, { registered: false, number: ABN, scheme: null });
  eq('AU save "not registered" from a registered shop asks the confirm', r.mergedTax.deregistered, true);
  const r2 = au(held(ABN, null), Object.assign({ tax: { registered: false, number: null } }, base));
  eq('AU ABN-only shop saying "not registered": ABN kept, no stop-charging confirm', [r2.answers.tax.number, r2.mergedTax.deregistered], [ABN, false]);
  const ind = { country: { code: 'IN' }, tax: { registered: true, number: GSTIN, scheme: 'regular' } };
  const r3 = au(ind, { tax: { registered: false, number: null }, country: 'IN', currency: 'INR', fy_start_month: 4 });
  eq('IN save "not registered": the GSTIN goes (as before)', r3.answers.tax.number, null);
} else console.log('   (intake_ is not exported — add it to the exports for this test)');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
