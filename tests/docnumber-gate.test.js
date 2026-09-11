/**
 * ── tests/docnumber-gate.test.js · THE SERVER CHECKS THE NUMBER, AND NEVER REFUSES IT ────────────────────────
 *
 * ⭐⭐⭐ THE ONE PROPERTY THAT MATTERS HERE IS A NEGATIVE: a bill is never rejected for its number.
 *
 * ⚠️⚠️ A bill number is not a request. It is already printed and already in a customer's hand by the time the
 * server sees it. Refusing it does not un-print it — it wedges the counter's queue forever and loses the sale
 * from the books, which is strictly worse than a long number. The physical world happened first and a server does
 * not get a vote on it.
 *
 * ⚠️ That is exactly the kind of rule a later "hardening" undoes in good faith, because refusing bad input is
 * normally the right instinct. This file is what stops that.
 *
 * Run: node tests/docnumber-gate.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const D = require('../lib/docnumber');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
/* the block the check lives in — bounded, so a match elsewhere in a 3,000-line file cannot fool this */
const at = route.indexOf('let number_check = null;');
const block = at > 0 ? route.slice(at, at + 1400) : '';

console.log('— it records, it does not refuse —');

it('⭐⭐⭐ a bad number never becomes an error response', () => {
  assert.ok(block, 'the number check is gone from routes/chits.js');
  assert.ok(!/res\.status\(4\d\d\)/.test(block),
    'the number check now answers with an error status — a counter whose number is too long would have its queue '
    + 'wedged forever, and the bill is already printed');
  assert.ok(!/throw |return res\./.test(block),
    'the number check returns or throws out of the handler instead of recording and carrying on');
});

it('⭐⭐ the finding is written ON THE CHIT, not only into the reply', () => {
  /* ⚠️ The counter may be offline when the answer comes back, and the person who reads the books is not the
     person who pressed the key. A finding that lives only in an HTTP response is one nobody sees again. */
  assert.ok(/business_json\.number_check = number_check/.test(route),
    'the finding no longer lands on the chit');
  assert.ok(/\.\.\.\(number_check \? \{ number_check \} : \{\}\)/.test(route),
    'the reply no longer carries the finding');
});

it('⚠️ absence means silence, not approval', () => {
  /* ⚠️ `number_check` is present only when something is WRONG. If it were always present, a caller could not tell
     "checked and fine" from "not checked at all" — and in an unstudied country those are different facts. */
  assert.ok(/present only when something is wrong/.test(route),
    'the reasoning for omitting the key when all is well has gone — somebody will make it always-present');
});

console.log('— and only for a document this rule actually governs —');

it('⭐⭐⭐ only a COUNTER document is checked', () => {
  /**
   * ⚠️ `client_ref` also carries an ERP's own reference, a WhatsApp message id and a connector's key. None are
   * document numbers, none are governed by this rule, and checking them would refuse — or here, wrongly flag —
   * perfectly good references on chits that have nothing to do with a till.
   */
  assert.ok(/_b\.till && _b\.till\.id/.test(block),
    'the check no longer requires a till id, so every client_ref on the platform is now judged as a bill number');
});

it('⚠️ the country is memoised — a sale must not pay a round trip for a constant', () => {
  /* ⚠️ San Francisco to Mumbai on every counter sale, to answer a question whose answer never changes.
     ⚠️ And five minutes rather than forever, so a shop that corrects its country need not wait for a deploy. */
  assert.ok(/_countryMemo/.test(route), 'the country lookup is no longer memoised');
  assert.ok(/Date\.now\(\) - 300000/.test(route), 'the memo no longer expires — a corrected country would never take');
});

it('⚠️ a failed country lookup never fails the bill', () => {
  const fn = route.slice(route.indexOf('async function countryOfEntity'), route.indexOf('async function countryOfEntity') + 700);
  assert.ok(/catch \(_\)/.test(fn), 'countryOfEntity can throw, and it is on the bill path');
});

console.log('— the rule it applies is the right one —');

it('⭐ an over-long Indian number is caught; the same number elsewhere is not', () => {
  /**
   * ⭐ This is the whole reason the country is looked up at all. `ABCDEF/26-27/0041` is 17 characters — over
   * India's limit, and unremarkable in a country that caps nothing. Flagging it everywhere would be exporting
   * India's rule, which is the drift this work exists to prevent.
   */
  const no = 'ABCDEF/26-27/0041';
  assert.strictEqual(D.check(no, 'IN').ok, false, 'India no longer catches a 17-character number');
  assert.strictEqual(D.check(no, 'AE').ok, true, "an unstudied country inherited India's cap");
  assert.strictEqual(D.check(no, 'AE').verified, false, 'a pass in an unstudied country looks the same as one in India');
});

it('⚠️ a normal counter number is never flagged', () => {
  /* ⚠️ The cost of a false positive here is a shop told its books are wrong when they are not, which is worse
     than the fault this catches. Asserted across the whole range a counter can reach. */
  [1, 41, 9999, 10000, 999999, 9999999].forEach((seq) => {
    ['C1', 'C9'].forEach((prefix) => {
      const no = D.compose({ country: 'IN', prefix, at: new Date('2026-09-11'), seq });
      assert.ok(D.check(no, 'IN').ok, no + ' would be flagged on a normal sale');
    });
  });
});

console.log('\n  ' + pass + ' checks\n');
