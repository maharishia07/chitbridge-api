/**
 * ── tests/docnumber.test.js · THE NUMBERING RULES, PER JURISDICTION ───────────────────────────────────────────
 *
 * Athi, 2026-09-11: *"so any work you do, first set a country and see how that can be globalised?"*
 *
 * ⭐⭐⭐ THE HEADLINE TEST IS NOT "DOES INDIA WORK". It is that **no Indian rule escapes into a country we have not
 * studied** — because that is the failure nobody would ever report. A shop in Dubai whose bill numbers restart
 * every April, capped at sixteen characters for reasons that are India's, does not know it is being governed by
 * the wrong rule. It just sees numbers.
 *
 * Run: node tests/docnumber.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs');
const D = require('../lib/docnumber');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const AT = new Date('2026-09-11T10:00:00Z');

console.log('— India, which is the one we have actually built against —');

it('⭐⭐ every document a counter issues fits inside 16 characters', () => {
  /**
   * ⚠️ IT DID NOT. `GRN/C1/26-27/0007` is seventeen — over the limit on the DEFAULT till id, before anybody did
   * anything unusual. The three-letter tag was the cost, and one letter buys it back without giving up the
   * separators, which are explicitly permitted and are what make the number splittable again.
   */
  ['sale', 'receipt', 'despatch'].forEach((kind) => {
    const no = D.compose({ country: 'IN', prefix: 'C1', kind, at: AT, seq: 41 });
    const c = D.check(no, 'IN');
    assert.ok(c.ok, kind + ' → ' + no + ' (' + no.length + ') — ' + c.reason);
  });
});

it('⭐⭐⭐ the series still fits at ten million bills', () => {
  /* ⚠️ padStart PADS, it does not truncate, so the number LENGTHENS rather than wrapping — and a wrap would
     reuse a number, which is the single thing a series exists to prevent. Asserted at the ceiling. */
  const no = D.compose({ country: 'IN', prefix: 'C1', at: AT, seq: 9999999 });
  assert.ok(D.check(no, 'IN').ok, 'the 9,999,999th bill is ' + no.length + ' characters: ' + no);
  assert.notStrictEqual(D.compose({ country: 'IN', prefix: 'C1', at: AT, seq: 9999 }),
    D.compose({ country: 'IN', prefix: 'C1', at: AT, seq: 10000 }), 'the sequence wrapped instead of lengthening');
});

it('⚠️ the till-id cap is DERIVED from the rule, not hard-coded', () => {
  /**
   * ⚠️ THE SETTINGS FIELD ACCEPTED SIX CHARACTERS, which puts even a plain sale at seventeen with nothing
   * anywhere saying so. Hard-coding 2 would have fixed India and quietly restricted a country that caps nothing.
   */
  assert.strictEqual(D.maxPrefix('IN', 'sale'), 2, 'India should allow a 2-character till id at the ceiling');
  const bad = D.compose({ country: 'IN', prefix: 'ABCDEF', at: AT, seq: 41 });
  const c = D.check(bad, 'IN');
  assert.ok(!c.ok && /16/.test(c.reason), 'a 6-character till id is accepted: ' + bad);
  assert.ok(D.maxPrefix('AE', 'sale') > D.maxPrefix('IN', 'sale'),
    'an unstudied country is capped as tightly as India — its limit is being borrowed from a rule that is not its own');
});

it('⭐ the financial year is April–March, and the series resets with it', () => {
  const march = D.compose({ country: 'IN', prefix: 'C1', at: new Date('2026-03-31T00:00:00Z'), seq: 1 });
  const april = D.compose({ country: 'IN', prefix: 'C1', at: new Date('2026-04-01T00:00:00Z'), seq: 1 });
  assert.notStrictEqual(march, april, 'the financial year does not turn over on 1 April');
  assert.ok(/25-26/.test(march) && /26-27/.test(april), march + ' / ' + april);
});

console.log('— and now the half that matters: what happens OUTSIDE India —');

it('⭐⭐⭐ no Indian rule reaches a country we have not studied', () => {
  /**
   * ⚠️⚠️ THE FAULT NOBODY WOULD REPORT. A shop in Dubai whose numbers restart every April and are capped at
   * sixteen characters is being governed by India's rules and cannot tell — it just sees numbers.
   */
  ['AE', 'GB', 'BR', 'US', ''].forEach((c) => {
    const r = D.rules(c);
    assert.strictEqual(r.verified, false, c + ' claims to be verified and is not');
    assert.notStrictEqual(r.resets, 'year', c + ' inherited India\'s annual reset');
    assert.strictEqual(r.yearStartMonth, 1, c + ' inherited India\'s April year start');
    assert.ok(r.maxLen > 16, c + ' inherited a 16-character cap that is India\'s rule, not its own');
    const no = D.compose({ country: c, prefix: 'C1', at: AT, seq: 41 });
    assert.ok(!/26-27/.test(no), c + ' got an Indian financial-year label: ' + no);
  });
});

it('⭐⭐ an unstudied jurisdiction says so IN THE ANSWER, not only in the rule', () => {
  /**
   * ⭐ `verified` travels with the result of check(), not just with rules(). A caller that shows a green tick
   * for Brazil is overstating what was checked, and this is what stops it doing that without knowing.
   */
  const ok = D.check('C1/0041', 'BR');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.verified, false, 'a pass in an unstudied country looks identical to a pass in India');
  assert.strictEqual(D.check('C1/26-27/0041', 'IN').verified, true);
});

it('⚠️ the default enforces only what every jurisdiction agrees on', () => {
  /* ⚠️ A GUESSED LIMIT IS WORSE THAN AN ABSENT ONE — it refuses a number that is perfectly legal where the shop
     actually is. So the fallback keeps unique + sequential and invents nothing else. */
  const r = D.rules('ZZ');
  assert.strictEqual(r.resets, 'never', 'the default resets a series on a rule we have not checked');
  assert.ok(/NOT been checked/i.test(r.says), 'the default no longer admits what it has not checked');
});

it('⚠️ an unknown country never throws — a counter must open', () => {
  [null, undefined, '', 'zz', '  in  ', 12345].forEach((c) => {
    assert.doesNotThrow(() => D.compose({ country: c, prefix: 'C1', at: AT, seq: 1 }), String(c));
    assert.doesNotThrow(() => D.check('C1/0001', c), String(c));
  });
  /* and the country is case- and space-insensitive, because it arrives from a profile field */
  assert.strictEqual(D.rules('  in  ').country, 'IN');
});

it('TIER A · zero dependencies', () => {
  const src = fs.readFileSync(require.resolve('../lib/docnumber'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], [],
    'docnumber.js grew a dependency — it is read by a route, a guard and the counter');
});

console.log('\n  ' + pass + ' checks · studied: ' + D.studied().join(', ') + '\n');
