'use strict';
/**
 * scalecode.test.js — A BARCODE A WEIGHING SCALE PRINTED ([TILL-185]).
 *
 * The grocery baseline the backlog has carried as a red blocker since it was written: *"Weighing scale +
 * price-embedded barcodes (EAN-13 carrying weight/price)… Produce and deli need it."*
 *
 * ⭐ THE SHAPE OF THE SOLUTION IS THE INTERESTING PART. The backlog also said *"decoding the barcode needs to
 * know how that scale encodes it — a question for the day the scale is in front of us, not a guess now."* It is
 * still not a guess: the shop declares a MASK and this decodes it, so no scale vendor is hard-wired anywhere.
 *
 * Run: node tests/scalecode.test.js   · no DB, no browser, no network.
 */
const assert = require('assert');
const S = require('../lib/scalecode');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** build a valid label for a mask, so no test hard-codes a check digit it worked out by hand */
function label(mask, item, value) {
  let body = '', i = 0, w = 0;
  const iS = String(item), vS = String(value);
  const nI = (mask.match(/I/g) || []).length;
  const nV = (mask.match(/[WP]/g) || []).length;
  const it2 = iS.padStart(nI, '0'), vl = vS.padStart(nV, '0');
  for (let k = 0; k < mask.length - 1; k++) {
    const c = mask[k];
    if (/[0-9]/.test(c)) body += c;
    else if (c === 'I') body += it2[i++];
    else if (c === 'W' || c === 'P') body += vl[w++];
    else body += '0';
  }
  return body + String(S.checkDigit(body));
}

const WEIGHT = { preset: 'weight_13' };
const PRICE = { preset: 'price_13' };

console.log('\nAN ORDINARY BARCODE IS NOT ONE OF THESE\n');

/**
 * ⚠️⚠️ THE COMMON CASE, AND IT MUST COST NOTHING. A shop scans a thousand normal products a day; every one of
 * them passes through this. Returning null is not a failure and must never be reported as one.
 */
it('⚠️⚠️ a normal product scan returns null, not an error', () => {
  assert.strictEqual(S.read('8901234567894', WEIGHT), null);
  assert.strictEqual(S.read('012345678905', WEIGHT), null, 'a 12-digit UPC was claimed');
  assert.strictEqual(S.read('', WEIGHT), null);
  assert.strictEqual(S.read('TOMATO', WEIGHT), null, 'letters were treated as a label');
});

it('and a shop with no scale never sees any of it', () => {
  assert.strictEqual(S.read(label('21IIIIIWWWWWC', 42, 750), {}), null);
  assert.strictEqual(S.read('2100042075004', null), null);
});

console.log('\nWEIGHT IN THE BARCODE\n');

it('⭐ the item and the weight come out', () => {
  const code = label('21IIIIIWWWWWC', 42, 750);
  const r = S.read(code, WEIGHT);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.item, '42', 'leading zeros were kept, so no item will ever match');
  assert.strictEqual(r.qty, 750);
  assert.strictEqual(r.unit, 'gram');
});

/**
 * ⭐ THE DIVISOR IS THE SHOP'S. A scale printing grams and one printing hundredths of a kilo emit the same five
 * digits for completely different amounts, and nothing in the barcode says which.
 */
it('⭐ a shop whose scale prints kilos says so, and no code changes', () => {
  const code = label('21IIIIIWWWWWC', 42, 750);
  const r = S.read(code, { mask: '21IIIIIWWWWWC', weighs: 'kg', divisor: 1000 });
  assert.strictEqual(r.qty, 0.75);
  assert.strictEqual(r.unit, 'kg');
});

it('and a weight of nothing is refused, not sold', () => {
  const r = S.read(label('21IIIIIWWWWWC', 42, 0), WEIGHT);
  assert.strictEqual(r.ok, false);
  assert.ok(/Weigh it again/.test(r.why), r.why);
});

console.log('\nPRICE IN THE BARCODE\n');

/**
 * ⚠️⚠️ A PRICE LABEL SETS THE MONEY, NOT THE QUANTITY. The scale already multiplied weight by rate; a counter
 * that then multiplied again by its own rate would charge the customer twice over.
 */
it('⚠️⚠️ a price label carries an amount and a quantity of one', () => {
  const r = S.read(label('22IIIIIPPPPPC', 7, 14550), PRICE);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.amount, 145.5, 'paise were not converted');
  assert.strictEqual(r.qty, 1);
  assert.strictEqual(r.unit, undefined, 'a price label claimed a unit it does not carry');
});

it('and its prefix keeps it apart from a weight label', () => {
  /* ⭐ a weight label must not be read by a shop configured for prices, or every amount would be a weight */
  assert.strictEqual(S.read(label('21IIIIIWWWWWC', 42, 750), PRICE), null);
});

console.log('\nTHE CHECK DIGIT\n');

/**
 * ⚠️⚠️⚠️ A LABEL THAT MATCHES THE PREFIX AND FAILS ITS CHECK IS A FAILURE, LOUDLY. Quietly falling back to
 * "ordinary barcode" would send the counter looking up an item code that happens to exist — and sell the wrong
 * vegetable at the wrong weight, with nobody told.
 */
it('⚠️⚠️⚠️ a misread label is refused, never passed through as ordinary', () => {
  const good = label('21IIIIIWWWWWC', 42, 750);
  const bad = good.slice(0, -1) + String((Number(good[good.length - 1]) + 1) % 10);
  const r = S.read(bad, WEIGHT);
  assert.notStrictEqual(r, null, 'a damaged scale label was treated as an ordinary product');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.scale, true);
  assert.ok(/did not scan cleanly/.test(r.why), r.why);
});

it('and the check digit itself is the GS1 one', () => {
  /* a known EAN-13: 590123412345 → 7 */
  assert.strictEqual(S.checkDigit('590123412345'), 7);
  /* ⚠️ MY ARITHMETIC, NOT THE CODE'S: this one ends in 0, and the first draft asserted 4 from memory. */
  assert.strictEqual(S.checkDigit('890123456789'), 0);
});

console.log('\nTHE SHOP\'S OWN PATTERN\n');

it('a mask is checked when it is typed, not at a till three weeks later', () => {
  assert.strictEqual(S.checkMask('21IIIIIWWWWWC').ok, true);
  assert.ok(/only 0-9 and the letters/.test(S.checkMask('21III@@WWC').why));
  assert.ok(/at least one I/.test(S.checkMask('21WWWWWWWWWWWC').why));
  assert.ok(/weight or a price, not both/.test(S.checkMask('21IIIWWPPPPPPC').why));
  assert.ok(/W digits \(weight\) or P digits/.test(S.checkMask('21IIIIIIIIIIIC').why));
  assert.ok(/between 8 and 18/.test(S.checkMask('21IWC').why));
  assert.ok(/Type the pattern/.test(S.checkMask('').why));
});

/**
 * ⚠️ IT MUST START WITH LITERAL DIGITS. Without a fixed prefix there is nothing to tell a scale label from an
 * ordinary product barcode of the same length, and every scan would be decoded as a weight.
 */
it('⚠️ a pattern with no fixed prefix is refused', () => {
  assert.ok(/digits your scale always prints/.test(S.checkMask('IIIIIIIWWWWWC').why));
});

/** ⚠️ and a broken setting must not break SCANNING — an ordinary sale carries on */
it('⚠️ a bad mask disables the feature rather than the counter', () => {
  assert.strictEqual(S.read('2100042075004', { mask: 'nonsense' }), null);
});

it('⭐ and the settings screen can show what a label would read as', () => {
  const e = S.example(WEIGHT);
  assert.ok(e && e.code && e.code.length === 13, JSON.stringify(e));
  assert.ok(e.reads && e.reads.ok, 'the example it shows does not itself decode');
  assert.strictEqual(S.example({}), null, 'a shop with no scale was shown an example anyway');
});

console.log('\nAND IT KNOWS NOTHING ABOUT A SCREEN OR A SCALE VENDOR\n');

/** ⭐⭐⭐ a branch per vendor is a file that grows for ever and is wrong for the next shop */
it('⭐⭐⭐ no scale brand is named anywhere in the engine', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'scalecode.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'fetch('].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/scalecode.js mentions ' + w);
  });
  /* ⚠️ WHOLE WORDS. The first draft searched for the substring 'digi' and found it inside 'digit' — a guard
     that fails on the thing it is written in is the same prose-as-code trap as one-name-one-function. */
  ['essae', 'avery', 'bizerba', 'digi', 'mettler'].forEach((b) => {
    assert.ok(!new RegExp('\b' + b + '\b', 'i').test(body), 'a scale brand (' + b + ') is hard-wired into the engine');
  });
});

console.log('\n' + pass + ' checks passed\n');
