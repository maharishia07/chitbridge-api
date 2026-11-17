/**
 * e2e/try-engines.cjs — the "Try it" answers, computed outside the browser.
 *
 * Athi, 2026-09-11: *"provide an execute function to run the test there itself and show the result… so each
 * function is validated by a human and confirmed."*
 *
 * ⭐⭐ THE POINT OF THIS PROBE IS THAT THE PAGE MUST NOT BE THE ONLY WITNESS. The Try view runs the vendored
 * engines in a browser and shows a person the answer; if that answer is wrong, the person confirming it is
 * confirming a wrong thing with real conviction. So the same calls run here, headless, against the same files.
 *
 * ⚠️ IT DOES NOT ASSERT A RESULT IT INVENTED. It prints what the engines actually say and fails only on the
 * handful of facts that are load-bearing and already decided elsewhere — the currency grouping rule, the `oru`
 * trap, the 16-character cap. Everything else is printed for a person to read.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public', 'engine');
global.window = {}; global.self = global;
const load = (f) => { require(path.join(WEB, f)); };
load('money.js'); global.CBMoney = global.window.CBMoney;
load('locale.js');
load('docnumber.js');
load('nums.js');

/**
 * ⚠️⚠️ THE ENGINES ATTACH TO globalThis, WHICH *IS* `window` IN A BROWSER AND IS NOT THE STUB MADE HERE.
 * Reading `window.CBLocale` gave undefined and this probe died on its first call — a difference between the
 * host and the page that only a headless run can find, and exactly the kind of thing that makes a "Try it"
 * screen look broken when the engine is perfect.
 */
const pick = (nm) => globalThis[nm] || global.window[nm];
const L = pick('CBLocale'), D = pick('CBDoc'), N = pick('CBNums');
let bad = 0;
const must = (what, cond) => { if (!cond) { bad++; console.log('    FAIL  ' + what); } };

console.log('\n  CURRENCY · the same figure, whoever reads it\n');
[['INR', 1234567.5], ['USD', 1234567.5], ['AED', 1234567.5], ['JPY', 1234567],
 ['KWD', 1234567.5], ['EUR', 1234567.5], ['PKR', 1234567.5]].forEach(([c, v]) => {
  const s = L.money(v, c);
  console.log('    ' + c + '   ' + s);
});
/* ⚠️ the rule, asserted: the currency groups, and the reader does not move it */
must('INR is lakh-grouped', /12,34,567/.test(L.money(1234567.5, 'INR')));
must('USD is three-three-three', /1,234,567/.test(L.money(1234567.5, 'USD')));
must('a dollar is NEVER lakh-grouped', !/12,34,567/.test(L.money(1234567.5, 'USD')));

console.log('\n  NUMERALS · what a customer actually said\n');
[['pathu kilo thakkali', 10], ['oru watter bottle', 1], ['dr fix oru 4 packet', 4],
 ['chicken oru 10 piece', 10], ['3 kg thakkali and 10kg onion', 10], ['thakkali venam', null]]
  .forEach(([phrase, expect]) => {
    const got = N.numeralsIn(phrase).map((x) => (x && x.value !== undefined ? x.value : x));
    const neg = N.negationIn(phrase);
    console.log('    ' + phrase.padEnd(32) + JSON.stringify(got)
      + (neg && neg.negated ? '   REFUSED' : '') + (neg && neg.ambiguous ? '   AMBIGUOUS' : ''));
    if (expect !== null) must('"' + phrase + '" yields ' + expect, got.includes(expect));
  });
/* ⚠️ the trap that justifies the whole engine */
must('"oru" is not scored as 1 in front of a numeral',
  !N.numeralsIn('dr fix oru 4 packet').map((x) => x.value).includes(1));

console.log('\n  DOCUMENT NUMBER · the country decides the shape\n');
[['IN', 'C1', 41], ['IN', 'ABCDEF', 41], ['AE', 'C1', 41], ['IN', 'C1', 9999999]].forEach(([c, pre, seq]) => {
  const sale = D.compose({ country: c, prefix: pre, seq });
  const k = D.check(sale, c);
  console.log('    ' + (c + '/' + pre + '/' + seq).padEnd(20) + sale.padEnd(20)
    + (k.ok ? '✓ ' + sale.length : '✗ ' + k.reason.slice(0, 52)));
});
must('a 6-character till id is refused in India',
  !D.check(D.compose({ country: 'IN', prefix: 'ABCDEF', seq: 41 }), 'IN').ok);
must('an unstudied country gets no Indian financial year',
  !/26-27/.test(D.compose({ country: 'AE', prefix: 'C1', seq: 41 })));

/* ⚠️ and the page must actually offer these — a Run button on a case nobody wired is a dead control */
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'testing.html'), 'utf8');
['RULE-05', 'RULE-06', 'RULE-03', 'ENG-01'].forEach((k) => {
  must(k + ' is wired to a runner', page.indexOf("'" + k + "':") > 0);
});
/* ⚠ the source writes the triangle as a ▶ escape, so searching for the literal glyph found nothing and
   reported a missing button that is perfectly present. */
must('the case header offers a Run button', /u25b6 Run|▶ Run/.test(page));

console.log('\n  ' + bad + ' problems\n');
process.exitCode = bad ? 1 : 0;
