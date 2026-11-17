/**
 * ── tests/numerals.test.js · THE CLOSED CLASS ─────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-11, on finding this engine had no guard at all: *"write the guard for numerals."*
 *
 * ⚠️⚠️ IT HAD NONE — and it is the file where `pathu kilo` came back as 5 in a live test. That is a MONEY ERROR
 * on a weighing scale: half the order, at full price, on a bill somebody pays. lib/numerals.js exists precisely
 * because that happened, and until today nothing checked that it had stopped happening.
 *
 * ⭐⭐⭐ THE ARGUMENT THE FILE MAKES, AND THEREFORE WHAT THIS HAS TO PROVE. Vocabulary splits in two and the
 * halves scale oppositely: the OPEN class (product names, dialect) is unbounded and must be learned; the CLOSED
 * class (numerals, negation) is about forty tokens per language, finite, and then done forever. Asking a model to
 * be reliable about the closed half is paying per call, forever, for something a table settles once.
 *
 * ⭐⭐ SO THE TESTS THAT MATTER ARE NOT "DOES THE TABLE CONTAIN pathu". They are:
 *
 *     1 · the `oru` rule           — a flat dictionary HALVES real orders. This is the one that justifies the file.
 *     2 · it never substitutes     — it verifies and says no; it never quietly rewrites a quantity.
 *     3 · a false alarm is a bug   — flagging a CORRECT extraction teaches people to ignore the alarm, which
 *                                    costs more than the errors it catches.
 *
 * ⚠️ Every phrase below is from Athi's own corpus or from the traps the file documents about itself. Inventing
 * test phrases would prove the table is self-consistent, which is not the question.
 *
 * Run: node tests/numerals.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs');
const N = require('../lib/numerals');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/** the numbers a phrase yields, in order */
const vals = (s) => N.numeralsIn(s).map((x) => (typeof x === 'object' ? x.value : x));

console.log('— the number that started it —');

it('⭐⭐⭐ "pathu kilo" is TEN — the live error this file was written for', () => {
  /* ⚠️ It came back as 5. On a scale that is half the goods at the full price, and the customer is the one who
     finds out. Every spelling a speaker might use, because spelling varies by speaker and not by meaning. */
  ['pathu kilo', 'paththu kilo', 'pathu kg'].forEach((p) => {
    assert.ok(vals(p).includes(10), p + ' → ' + JSON.stringify(vals(p)) + ', expected a 10');
    assert.ok(!vals(p).includes(5), p + ' came back as FIVE — the original fault is back');
  });
});

it('⚠️ spelling varies by speaker, never by meaning', () => {
  /* onnu/onru, moonu/moondru, anju/aindhu are the same number. None of them is "correct". */
  [[['onnu', 'onru', 'ondru'], 1], [['rendu', 'irandu'], 2], [['moonu', 'moondru', 'munu'], 3],
   [['naalu', 'naangu'], 4], [['anju', 'aindhu', 'ainthu'], 5]].forEach(([spellings, n]) => {
    spellings.forEach((s) => assert.ok(vals(s + ' kilo').includes(n),
      s + ' is not ' + n + ' — a speaker using this spelling is misread'));
  });
});

console.log('— the `oru` rule, which is the whole reason this is code and not a dictionary —');

it('⭐⭐⭐ "oru" is ONE only when no other numeral follows it', () => {
  /**
   * ⚠️⚠️ THE TRAP, IN ATHI'S OWN CORPUS. A flat table that scored `oru` as 1 would be confidently wrong on two
   * lines in five — and worse than no check at all, because the check would carry authority.
   */
  assert.deepStrictEqual(vals('oru watter bottle'), [1], 'oru alone is one');
  assert.deepStrictEqual(vals('oru pepsi periya bottle'), [1], 'oru with no other numeral is one');

  /* …and "a/some" when a real numeral follows */
  assert.ok(vals('dr fix oru 4 packet').includes(4), 'the 4 was lost');
  assert.ok(!vals('dr fix oru 4 packet').includes(1),
    '"oru" scored as 1 in front of a real numeral — this is the halving bug');
  assert.ok(vals('chicken oru 10 piece').includes(10), 'the 10 was lost');
  assert.ok(!vals('chicken oru 10 piece').includes(1), '"oru" scored as 1 in front of a 10');
});

console.log('— a digit glued to its unit is still a digit —');

it('⚠️ "10kg" and "500ml" are numbers, not words', () => {
  /**
   * ⚠️ Matching only bare digits made these invisible — and an invisible number is worse than an unread one:
   * "3 kg thakkali and 10kg onion" saw only [3], so the CORRECT extraction of 10 would have been flagged as
   * invented. A false alarm on a good order teaches people to ignore the alarm.
   */
  assert.ok(vals('10kg onion').includes(10), '10kg is not read as 10');
  assert.ok(vals('500ml milk').includes(500), '500ml is not read as 500');
  assert.ok(vals('2crate').includes(2), '2crate is not read as 2');
  const both = vals('3 kg thakkali and 10kg onion');
  assert.ok(both.includes(3) && both.includes(10), 'one of the two numbers is invisible: ' + JSON.stringify(both));
});

console.log('— and the rule it never breaks —');

it('⭐⭐⭐ it VERIFIES a quantity and never substitutes one', () => {
  /**
   * ⚠️⚠️ "A checker that silently overwrites the model has simply become a second, dumber model." When it
   * disagrees the answer is a refusal, never a replacement — so nothing downstream can mistake its opinion for
   * an extraction.
   */
  const wrong = N.verifyQuantity('pathu kilo thakkali', 5);
  assert.strictEqual(wrong.ok, false, 'it accepted 5 for "pathu" (ten)');
  /* the shape of a refusal: it must not hand back a corrected number as though it had extracted one */
  assert.ok(!('extracted' in wrong) || wrong.extracted !== 10,
    'it substituted its own answer — that makes it a second model, not a check');
  assert.ok(typeof wrong.reason === 'string' && wrong.reason.length,
    'a refusal with no reason cannot be acted on');
});

it('⚠️ a CORRECT extraction is never flagged — a false alarm costs more than it catches', () => {
  [['pathu kilo thakkali', 10], ['3 kg thakkali', 3], ['oru watter bottle', 1],
   ['dr fix oru 4 packet', 4], ['10kg onion', 10]].forEach(([phrase, q]) => {
    const r = N.verifyQuantity(phrase, q);
    assert.ok(r.ok, phrase + ' with the RIGHT quantity ' + q + ' was flagged: ' + JSON.stringify(r));
  });
});

it('⚠️ a phrase with no numeral is not an error — it is simply unchecked', () => {
  /* ⚠️ Returning "not ok" here would flag every line that names a quantity somewhere else, which is most of them. */
  const r = N.verifyQuantity('thakkali venum', 2);
  assert.strictEqual(r.ok, true, 'a phrase with no numeral was treated as a disagreement');
  assert.strictEqual(r.checked, false, 'it claims to have checked something it could not check');
});

console.log('— negation, which changes the meaning of the whole line —');

it('⭐⭐ "venam" is a refusal and "venum" is a request — they differ by one letter', () => {
  /* ⚠️ One letter between "I want" and "I do not want", in a message that becomes an order. */
  assert.ok(N.negationIn('thakkali venam').negated, '"venam" (do not want) read as a request');
  assert.ok(!N.negationIn('thakkali venum').negated, '"venum" (want) read as a refusal');
});

it('⚠️ "illa" is AMBIGUOUS and says so rather than guessing', () => {
  /**
   * ⭐ It means both "or" and "not" depending on the sentence. A checker that picked one would be inventing
   * intent — so it reports the ambiguity and lets a person decide.
   */
  const r = N.negationIn('thakkali illa vengayam');
  assert.ok(r.ambiguous, '"illa" was resolved one way instead of being reported as ambiguous');
  assert.ok(/or/.test(r.reason) && /not/.test(r.reason), 'the reason does not say what the two meanings are');
});

console.log('— the closed class is CLOSED —');

it('⭐ the table is finite, and every entry is a number', () => {
  /**
   * ⭐ "About forty tokens per language, finite, and then DONE FOREVER" is the argument for the whole file. A
   * table that had quietly grown into the hundreds would mean somebody was treating an open class as closed.
   */
  const n = Object.keys(N.NUMERALS).length;
  assert.ok(n > 20 && n < 400, 'the numeral table holds ' + n + ' entries — check it has not become a dictionary');
  Object.entries(N.NUMERALS).forEach(([k, v]) => {
    assert.ok(typeof v === 'number' && Number.isFinite(v), k + ' maps to ' + JSON.stringify(v) + ', not a number');
  });
});

it('⚠️ "oru" is deliberately NOT in the numeral table', () => {
  /* ⚠️ It is an article first. Putting it in NUMERALS is exactly the flat-dictionary mistake — it belongs in
     FILLERS, where the following-numeral rule can apply to it. */
  assert.ok(!Object.prototype.hasOwnProperty.call(N.NUMERALS, 'oru'),
    '"oru" is in NUMERALS — the halving bug is one lookup away');
  assert.ok(N.FILLERS.has('oru'), '"oru" is not a filler either, so it yields nothing at all');
});

it('TIER A · zero dependencies', () => {
  const src = fs.readFileSync(require.resolve('../lib/numerals'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], [],
    'numerals.js grew a dependency — it is vendored to the browser and runs at the counter');
});

console.log('\n  ' + pass + ' checks\n');
