/**
 * ── tests/jurisdiction.test.js · WHERE A PARTY IS, AND WHAT THAT DECIDES ─────────────────────────────────────
 *
 * Athi, 2026-09-11: *"write cases for points and jurisdiction."* `jurisdiction.js` is 142 lines of Tier A pure
 * rule with ONE test naming it — and it sits under document numbering, tax treatment and money format. What it
 * decides, everything downstream inherits.
 *
 * ⭐⭐ THE STANDING RULE IT SERVES: *"any work you do, first set a country and see how that can be globalised"*
 * (2026-09-11). This file is where that rule lives for payment: a shop is paid by what its COUNTRY allows, not
 * by what the code happened to be written in.
 *
 * ⚠️⚠️ AND MY FIRST THREE PROBES OF THIS MODULE WERE ALL WRONG, which is why the assertions below are written
 * against what it actually does rather than what its names suggested:
 *   · `payWays('IN')` returns cash+card, because it takes an OBJECT `{country, payees}` — a bare string leaves
 *     the country blank and the payee list empty. It looked like UPI was missing for India. It was not.
 *   · `isPayeeHandle('upi', vpa)` returns false, because it takes ONE argument — the handle.
 *   · `countryOf({gstn})` returns null, because the field is `gstin`.
 * ⭐ Three plausible readings, three wrong findings. A test written from the name asserts what I imagined.
 *
 * Run: node tests/jurisdiction.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert');
const J = require('../lib/jurisdiction');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

console.log('— which country a party is in —');

it('⭐⭐ the country is taken from what is KNOWN, in a stated order of preference', () => {
  assert.strictEqual(J.countryOf({ country: 'IN' }), 'IN', 'an explicit country wins');
  assert.strictEqual(J.countryOf({ profile: { country: 'AE' } }), 'AE', 'then the profile');
  assert.strictEqual(J.countryOf({ country: 'IN', profile: { country: 'AE' } }), 'IN',
    'the direct answer beats the profile, or a correction could never take effect');
});

it('⭐ a GSTIN means India, because only India issues one', () => {
  /* ⚠️ This is a derivation, not a guess: the document itself is jurisdictional. */
  assert.strictEqual(J.countryOf({ gstin: '33ABCDE1234F1Z5' }), 'IN');
  assert.strictEqual(J.countryOf({ gstin: '  ' }), null, 'a blank GSTIN derives nothing');
});

it('⚠️⚠️ NOT KNOWING IS NULL, and never a default', () => {
  /**
   * ⭐⭐ THE MOST IMPORTANT ASSERTION IN THIS FILE. Defaulting an unknown party to 'IN' would be convenient and
   * would quietly apply Indian tax, Indian document numbering and Indian money grouping to a shop in Dubai —
   * each of which looks right on screen and is wrong on a return. Null forces the question upward, where
   * somebody can answer it.
   */
  assert.strictEqual(J.countryOf({}), null);
  assert.strictEqual(J.countryOf(null), null, 'no party at all is still not India');
  assert.strictEqual(J.countryOf(undefined), null);
});

it('⚠️ the code is normalised, and only a TWO-LETTER code is accepted', () => {
  assert.strictEqual(J.countryOf({ country: 'ae' }), 'AE', 'case is folded');
  assert.strictEqual(J.countryOf({ country: ' in ' }), 'IN', 'space is trimmed');
  /* ⚠️ "INDIA" is refused rather than interpreted — ISO 3166-1 alpha-2 is the contract, and a helpful guess
     here would make the contract untrue everywhere downstream. */
  assert.strictEqual(J.countryOf({ country: 'INDIA' }), null);
  assert.strictEqual(J.countryOf({ country: 'I' }), null);
});

console.log('— how a shop can be paid —');

it('⭐⭐⭐ a scheme is offered ONLY where its country allows it', () => {
  /**
   * ⚠️ This is the globalisation rule made testable. UPI is declared `countries: ['IN']`; the SAME shop record
   * with the SAME payee handle must offer it in India and not in the Emirates.
   */
  const payees = { upi: 'shop@okhdfcbank' };
  const inIN = J.payWays({ country: 'IN', payees }).map((w) => w.id);
  const inAE = J.payWays({ country: 'AE', payees }).map((w) => w.id);
  assert.ok(inIN.indexOf('upi') >= 0, 'UPI must be offered in India: ' + inIN.join(','));
  assert.ok(inAE.indexOf('upi') < 0, 'UPI must NOT be offered in the Emirates: ' + inAE.join(','));
});

it('⭐ cash and card are everywhere, because they are record-only', () => {
  /* ⚠️ They carry no QR and encode nothing — they are a note of how somebody paid, which is true in every
     country and needs no scheme. */
  ['IN', 'AE', 'GB', ''].forEach((country) => {
    const ids = J.payWays({ country }).map((w) => w.id);
    assert.ok(ids.indexOf('cash') >= 0 && ids.indexOf('card') >= 0, 'cash and card missing for ' + country);
  });
  const cash = J.payWays({ country: 'IN' }).find((w) => w.id === 'cash');
  assert.strictEqual(cash.qr, null, 'cash cannot be encoded into anything');
});

it('⚠️⚠️ a scheme with no payee on file is NOT offered', () => {
  /**
   * ⭐ Offering UPI to a shop that has not given a handle would put a button on the counter that produces a QR
   * nobody can pay — the customer sees a failure, at the till, in front of a queue.
   */
  const ids = J.payWays({ country: 'IN', payees: {} }).map((w) => w.id);
  assert.ok(ids.indexOf('upi') < 0, 'UPI offered with no payee: ' + ids.join(','));
  const bad = J.payWays({ country: 'IN', payees: { upi: 'not a handle' } }).map((w) => w.id);
  assert.ok(bad.indexOf('upi') < 0, 'an invalid handle must be refused, not encoded: ' + bad.join(','));
});

it('⚠️ a scheme declared but not yet ENCODABLE is never offered', () => {
  /**
   * ⭐ `emvco` is in the table with `encodes: null` — declared so the gap is visible, withheld so nothing draws
   * a QR it cannot actually produce. Naming a future scheme is not the same as having it.
   */
  assert.ok(J.PAY_SCHEMES.emvco, 'emvco should still be declared');
  assert.strictEqual(J.PAY_SCHEMES.emvco.encodes, null, 'emvco is declared, not built');
  const ids = J.payWays({ country: 'AE', payees: { emvco: 'anything' } }).map((w) => w.id);
  assert.ok(ids.indexOf('emvco') < 0, 'an unencodable scheme must not be offered: ' + ids.join(','));
});

it('⭐ an offered scheme carries the payee it will encode', () => {
  const upi = J.payWays({ country: 'IN', payees: { upi: '  shop@okhdfcbank  ' } }).find((w) => w.id === 'upi');
  assert.ok(upi, 'UPI should be offered');
  assert.strictEqual(upi.payee, 'shop@okhdfcbank', 'trimmed, or the QR carries the spaces');
  assert.strictEqual(upi.qr, 'upi-deeplink', 'it must say WHAT it encodes, not merely that it does');
});

console.log('— the handle itself —');

it('⚠️ a payee handle is checked for shape, and a bare word is refused', () => {
  assert.strictEqual(J.isPayeeHandle('shop@okhdfcbank'), true);
  assert.strictEqual(J.isPayeeHandle('no-at-sign'), false);
  assert.strictEqual(J.isPayeeHandle(''), false);
  assert.strictEqual(J.isPayeeHandle(null), false);
  /* ⚠️ two characters either side is the floor; `a@b` is refused because nothing real is that short */
  assert.strictEqual(J.isPayeeHandle('a@b'), false);
});

console.log('— and the file stays liftable —');

it('⭐⭐ TIER A: this module requires NOTHING', () => {
  /**
   * ⚠️ engine-boundary.test.js already enforces this across the whole tier, and it is asserted again here
   * because THIS file is the one somebody edits when adding a country. The rule should fail in the test
   * next to the change, not only in a suite-wide guard they may not run.
   */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'jurisdiction.js'), 'utf8');
  const requires = (src.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []);
  assert.deepStrictEqual(requires, [],
    'jurisdiction.js has grown a dependency and is no longer liftable as a file: ' + requires.join(', '));
});

console.log('\n  ' + pass + ' checks\n');
