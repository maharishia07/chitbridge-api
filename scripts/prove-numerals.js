'use strict';
// prove-numerals.js — the closed class, proved against Athi's OWN corpus.
//
// Every phrase below is lifted from the 17 real WhatsApp messages sitting in Intake on alpha@timers.com.
// No database, no AI call — that is the point: the closed class is a table, not a judgment.
//
// Run: node scripts/prove-numerals.js
const N = require('../lib/numerals');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));
const vals = (s) => N.numeralsIn(s).map((x) => x.value);

console.log('\n── the closed class ─────────────────────────────────────────────────────────\n');

console.log('1 · ⭐ THE `oru` TRAP — the reason a flat dictionary would make things WORSE');
{
  /* Straight from the corpus. A naive table reads every one of these as 1. */
  eq('"dr fix oru 4 packet" → 4, not 1', vals('dr fix oru 4 packet'), [4]);
  eq('"chicken oru 10 piece" → 10, not 1', vals('chicken oru 10 piece'), [10]);
  /* …but alone it IS one. Both behaviours from one rule. */
  eq('"oru watter bottle" → 1', vals('oru watter bottle'), [1]);
  eq('"oru pepsi periya bottle" → 1', vals('oru pepsi periya bottle'), [1]);
  ok('⚠️ a flat table would have been wrong on 2 of these 4 — worse than not checking',
     vals('dr fix oru 4 packet')[0] === 4 && vals('oru watter bottle')[0] === 1);
}

console.log('\n2 · ⭐ THE LIVE FAILURE — `pathu kilo` was extracted as 5');
{
  const v = N.verifyQuantity('pathu kilo thakkali', 5);
  ok('the check REJECTS 5', v.ok === false, JSON.stringify(v));
  eq('…and says what the words actually said', v.expected, 10);
  ok('⚠️ it does NOT substitute 10 — the caller nulls the quantity and flags it',
     !Object.prototype.hasOwnProperty.call(v, 'corrected'));
  ok('10 is accepted', N.verifyQuantity('pathu kilo thakkali', 10).ok === true);
}

console.log('\n3 · Tanglish numerals, all the spellings people actually type');
{
  [['onnu', 1], ['rendu', 2], ['irandu', 2], ['moonu', 3], ['moondru', 3], ['naalu', 4],
   ['anju', 5], ['aindhu', 5], ['aaru', 6], ['ezhu', 7], ['ettu', 8], ['onbadhu', 9],
   ['pathu', 10], ['pathinanju', 15], ['irubadhu', 20], ['muppadhu', 30], ['nooru', 100],
  ].forEach(([w, n]) => eq('"' + w + '" = ' + n, vals(w + ' kilo'), [n]));
  eq('spelling varies, the number does not', [vals('anju kilo')[0], vals('aindhu kilo')[0]], [5, 5]);
}

console.log('\n4 · Tamil script — the same numbers, the other alphabet');
{
  eq('"பத்து கிலோ" = 10', vals('பத்து கிலோ'), [10]);
  eq('"இரண்டு கிரேட்" = 2', vals('இரண்டு கிரேட்'), [2]);
  eq('"ஐந்து" = 5', vals('ஐந்து'), [5]);
  eq('"ஒரு" alone = 1', vals('ஒரு பாட்டில்'), [1]);
  /* ⚠️ Messages 2 and 3 of the corpus are the SAME order in two scripts. If the numbers differ, the two chits
     differ, and the whole "same meaning, any script" claim fails at the first number. */
  eq('Tanglish and Tamil script agree', [vals('rendu')[0], vals('இரண்டு')[0]], [2, 2]);
}

console.log('\n5 · fractions and digits — "half box lemon"');
{
  eq('"half box lemon" = 0.5', vals('half box lemon'), [0.5]);
  eq('"arai kilo" = 0.5', vals('arai kilo'), [0.5]);
  eq('"kaal kilo" = 0.25', vals('kaal kilo'), [0.25]);
  eq('digits still count', vals('25 kg onion'), [25]);
  eq('decimals too', vals('1.5 kg'), [1.5]);
}

console.log('\n6 · several numbers on one line — a SIZE and a COUNT');
{
  /* The screw line. The model may legitimately pick either; it may not invent a third. */
  eq('"screw 5 inch 2 box" sees both', vals('screw black color 5 inch type 2 box'), [5, 2]);
  ok('2 is accepted (the count)', N.verifyQuantity('screw black color 5 inch type 2 box', 2).ok === true);
  ok('5 is accepted (the size — the checker cannot know which)', N.verifyQuantity('screw black color 5 inch type 2 box', 5).ok === true);
  const bad = N.verifyQuantity('screw black color 5 inch type 2 box', 7);
  ok('⚠️ 7 is REJECTED — it is in neither the words nor the world', bad.ok === false, JSON.stringify(bad));
  eq('…and the rejection names what was available', bad.among, [5, 2]);
}

console.log('\n7 · silence is not approval');
{
  const v = N.verifyQuantity('send tomatoes', 3);
  ok('no numeral in the phrase → the check does not fire', v.ok === true && v.checked === false);
  ok('…and it SAYS it did not check', v.reason === 'no numeral in the phrase');
  const w = N.verifyQuantity('pathu kilo', null);
  ok('⚠️ words name a number and nothing was extracted → REJECT', w.ok === false, JSON.stringify(w));
}

console.log('\n8 · ⭐ NEGATION — venam and venum differ by ONE letter and mean opposites');
{
  eq('"vengayam venam" = refused', N.negationIn('vengayam venam').negated, true);
  eq('"thakkali venum" = wanted', N.negationIn('thakkali venum').negated, false);
  eq('"வேணாம்" = refused', N.negationIn('வெங்காயம் வேணாம்').negated, true);
  eq('"வேணும்" = wanted', N.negationIn('தக்காளி வேணும்').negated, false);
  eq('nothing said either way', N.negationIn('2 kg onion').negated, null);
}

console.log('\n9 · ⭐ `illa` is KNOWN-AMBIGUOUS — always flag, never guess');
{
  /* "rendu illa moonu crate" = two OR three.  "A grade illana hybrid" = if NOT A grade.
     Same word, opposite jobs. A dictionary cannot fix this because the dictionary is what is ambiguous. */
  const a = N.negationIn('rendu crate illa moonu crate');
  ok('it refuses to decide', a.ambiguous === true, JSON.stringify(a));
  ok('…and says why', /both "or" and "not"/.test(a.reason || ''), a.reason);
  ok('the "if not" sense flags the same way', N.negationIn('A grade illana hybrid 3 crate').ambiguous === true);
  ok('⚠️ ambiguity beats negation — it is checked FIRST, so "illa" never reads as a refusal',
     N.negationIn('vengayam venam illa moonu').ambiguous === true);
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
console.log('⚠️  This proves the TABLE. It does not prove the wiring — verifyQuantity is not yet called by the\n' +
            '    extraction path. That is the next step, and it needs the line-identity work first.\n');
process.exit(fail ? 1 : 0);
