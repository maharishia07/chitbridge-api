'use strict';
/**
 * gs1.test.js — the check digit, and the judgement around it.
 *
 * The interesting assertions are not "a valid GTIN validates". They are: an internal SKU must NOT be called
 * invalid, a transposition must be caught, and a green tick must never be reported as "GS1 verified".
 */
const assert = require('assert');
const GS1 = require('../lib/gs1');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

console.log('\ngs1');

// ── real GTINs, computed by hand from the spec ──────────────────────────────────────────────────────────────
t('GTIN-13 · 4006381333931 (the GS1 worked example)', () => assert.strictEqual(GS1.isValidGTIN('4006381333931'), true));
t('GTIN-13 · 5901234123457', () => assert.strictEqual(GS1.isValidGTIN('5901234123457'), true));
t('GTIN-12 · 036000291452', () => assert.strictEqual(GS1.isValidGTIN('036000291452'), true));
t('GTIN-8  · 96385074', () => assert.strictEqual(GS1.isValidGTIN('96385074'), true));

t('the check digit is computed from the RIGHT — the part implementations get wrong', () => {
  assert.strictEqual(GS1.checkDigit('400638133393'), 1);
  assert.strictEqual(GS1.checkDigit('590123412345'), 7);
  assert.strictEqual(GS1.checkDigit('03600029145'), 2);
});

// ── the failures that matter ────────────────────────────────────────────────────────────────────────────────
t('a TRANSPOSED digit is caught — the commonest typing error', () => {
  assert.strictEqual(GS1.isValidGTIN('4006381333931'), true);
  assert.strictEqual(GS1.isValidGTIN('4006381333391'), false, 'digits 9 and 3 swapped must not validate');
});
t('a single wrong digit is caught', () => assert.strictEqual(GS1.isValidGTIN('4006381333932'), false));
t('the wrong length is refused even if the digits are right', () => {
  assert.strictEqual(GS1.isValidGTIN('400638133393'), false, '12 digits of a 13-digit GTIN is not a GTIN-12');
});
t('a formatted GTIN is NOT silently accepted', () => {
  assert.strictEqual(GS1.isValidGTIN('4006-3813-3393-1'), false,
    'stripping punctuation would let two spellings of one product become two keys');
});
t('whitespace IS tolerated — scanners and spreadsheets both add it', () => {
  assert.strictEqual(GS1.isValidGTIN('  4006381333931 '), true);
});

// ── the judgement call: an internal SKU is not a broken GTIN ────────────────────────────────────────────────
t('an internal SKU classifies as sku, NOT invalid', () => {
  assert.strictEqual(GS1.classify('RP-TEX-4L-W'), 'sku');
  assert.strictEqual(GS1.classify('12345'), 'sku', 'five digits is a short code, not a failed GTIN');
});
t('gtin-invalid is reserved for something that LOOKS like a GTIN and fails', () => {
  assert.strictEqual(GS1.classify('4006381333932'), 'gtin-invalid');
  assert.strictEqual(GS1.classify('4006381333931'), 'gtin-13');
  assert.strictEqual(GS1.classify('96385074'), 'gtin-8');
});
t('empty is its own case, not a failure', () => assert.strictEqual(GS1.classify(''), 'empty'));

// ── describe(): a verdict a person can act on ───────────────────────────────────────────────────────────────
t('describe names the EXPECTED digit, so the row is fixable', () => {
  const d = GS1.describe('4006381333932');
  assert.strictEqual(d.valid, false);
  assert.strictEqual(d.reason, 'check-digit');
  assert.strictEqual(d.expected, 1);
  assert.strictEqual(d.found, 2);
  assert.match(d.message, /should be 1/);
});
t('describe distinguishes bad-length from bad-check-digit', () => {
  assert.strictEqual(GS1.describe('12345').reason, 'bad-length');
  assert.strictEqual(GS1.describe('4006381333932').reason, 'check-digit');
});
t('describe explains non-numeric rather than just refusing', () => {
  const d = GS1.describe('4006-3813-3393-1');
  assert.strictEqual(d.reason, 'not-numeric');
  assert.match(d.message, /strip any hyphens/);
});
t('a bad-length message suggests the likely truth — that it is a SKU', () => {
  assert.match(GS1.describe('123456').message, /internal SKU/);
});

// ── canonical form ──────────────────────────────────────────────────────────────────────────────────────────
t('toGTIN14 pads, so a GTIN-13 and its GTIN-14 form are ONE key', () => {
  assert.strictEqual(GS1.toGTIN14('4006381333931'), '04006381333931');
  assert.strictEqual(GS1.toGTIN14('96385074'), '00000096385074');
});
t('toGTIN14 refuses an invalid code rather than padding nonsense', () => {
  assert.strictEqual(GS1.toGTIN14('4006381333932'), null);
});

// ── the overclaim guard ─────────────────────────────────────────────────────────────────────────────────────
t('⚠ a valid check digit is NOT "GS1 verified", and the file says so', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/gs1'), 'utf8');
  assert.match(src, /does not prove the product exists/);
  assert.match(src, /WHAT THIS IS NOT/);
});
t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/gs1'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)].map(() => 1).slice(0, 1), [],
    'gs1.js must stay importable on its own');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
