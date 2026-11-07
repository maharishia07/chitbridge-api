/**
 * tests/ctry-77-cash-step.test.cjs — CTRY-77 / AU-02b: THE API REFUSES A CASH PART NO COIN CAN MAKE.
 *
 * OWNS      lib/cash-step.js refusalOf against the REAL packs (reg-au cashRounding 5c; reg-in and reg-ae have none) + the wire in routes/chits.js
 *           (sendCashStep right after sendPaper, no try/catch, 400 CASH_ROUNDING_STEP) + the code's row in the register. Hand-computed in minor units.
 * CALLED BY scripts/guards.cjs · by hand: node tests/ctry-77-cash-step.test.cjs
 * FLOW      parts [{how, amount}] + country ──▶ refusalOf ──▶ null | { code, part_minor, nearest_minor }
 * CARD      counter/bill-slip
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const CS = require(path.join(ROOT, 'lib', 'cash-step'));
const bill = (...parts) => ({ payment: { parts: parts.map(([how, amount]) => ({ how, amount })) } });
const AU = (...parts) => CS.refusalOf({ country: 'AU', business_json: bill(...parts), currency: 'AUD' });
const IN = (...parts) => CS.refusalOf({ country: 'IN', business_json: bill(...parts), currency: 'INR' });
const brief = (r) => r && [r.code, r.part_minor, r.nearest_minor];

console.log('\n== CTRY-77 · the pack\'s cash step is the door of a cash tender ==\n');
/* hand: 10.02 = 1002 minor, 1002 mod 5 = 2 → off the step, nearest 1000 (10.00); 10.03 = 1003 mod 5 = 3 → nearest 1005 (10.05) */
eq('AU cash 10.02 → refused, nearest 10.00', brief(AU(['Cash', 10.02])), ['CASH_ROUNDING_STEP', 1002, 1000]);
eq('AU cash 10.03 → refused, nearest 10.05', brief(AU(['Cash', 10.03])), ['CASH_ROUNDING_STEP', 1003, 1005]);
eq('AU cash 10.07 → refused, nearest 10.05 (1007 → 1005)', brief(AU(['cash', 10.07])), ['CASH_ROUNDING_STEP', 1007, 1005]);
eq('AU cash 10.08 → refused, nearest 10.10', brief(AU(['CASH ', 10.08])), ['CASH_ROUNDING_STEP', 1008, 1010]);
eq('AU cash 10.00 → passes', AU(['Cash', 10.00]), null);
eq('AU cash 10.05 → passes', AU(['Cash', 10.05]), null);
eq('AU cash 0.1+0.2 float (0.30000000000000004) → passes: minor units, not floats', AU(['Cash', 0.1 + 0.2]), null);
eq('AU card 10.02 stays exact → passes', AU(['Card', 10.02]), null);
eq('AU UPI/other tender 10.03 → passes', AU(['UPI', 10.03]), null);
eq('AU card 5.01 + cash 5.00 → passes (only the cash part is stepped)', AU(['Card', 5.01], ['Cash', 5.00]), null);
eq('AU cash 5.01 + card 5.01 → the cash part is named', brief(AU(['Cash', 5.01], ['Card', 5.01])), ['CASH_ROUNDING_STEP', 501, 500]);
ok('the words name the figure, the nearest and carry the pack\'s cite', (() => { const r = AU(['Cash', 10.02]); return /10\.02/.test(r.why) && /10\.00/.test(r.why) && /RBA/.test(r.cite) && r.field === 'business_json.payment.parts'; })());
eq('IN control · cash 10.02 → passes (reg-in has no cashRounding)', IN(['Cash', 10.02]), null);
eq('IN control · cash 118.99 → passes', IN(['Cash', 118.99]), null);
eq('AE control · cash 10.02 → passes', CS.refusalOf({ country: 'AE', business_json: bill(['Cash', 10.02]), currency: 'AED' }), null);
eq('no country → nothing (never India, never AU)', CS.refusalOf({ country: null, business_json: bill(['Cash', 10.02]), currency: 'AUD' }), null);
eq('a bill with no tender → nothing', CS.refusalOf({ country: 'AU', business_json: {}, currency: 'AUD' }), null);
ok('the step is the pack\'s, read not typed', CS.ruleOf('AU').step === require('../lib/country').packFor('AU').cashRounding.step_minor && CS.ruleOf('IN') === null);
ok('lib/cash-step.js types no step number', !/\b5\b/.test(fs.readFileSync(path.join(ROOT, 'lib', 'cash-step.js'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));

/* ── the wire in routes/chits.js ── */
{
  const src = require('../tools/chits-files.cjs').read(ROOT);
  const steps = src.slice(src.indexOf('const SEND_STEPS = ['), src.indexOf('];', src.indexOf('const SEND_STEPS = [')));
  ok('SEND_STEPS runs sendCashStep right after sendPaper', /sendPaper,\s*sendCashStep,/.test(steps));
  const fn = src.slice(src.indexOf('async function sendCashStep('), src.indexOf('/** which copies a self-chit'));
  ok('sendCashStep has no try/catch — the refusal reaches the counter', fn.length > 0 && !/\btry\s*\{/.test(fn));
  ok('sendCashStep answers 400 and skips a draft', /status: 400/.test(fn) && /is_draft/.test(fn));
  const reg = fs.readFileSync(path.join(ROOT, 'docs', 'ERROR-CODES.md'), 'utf8');
  ok('CASH_ROUNDING_STEP is a row of the register, 400', /\| CASH_ROUNDING_STEP \| 400 \|/.test(reg));
}
console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
