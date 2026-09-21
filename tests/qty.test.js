'use strict';
/**
 * qty.test.js — MAGNITUDE, RUN WITH NO BROWSER ([TILL-186]).
 *
 * Athi: *"no data should be tied tightly to the front end."*
 *
 * The weight and volume factors were a table inside till.html. The page's own note admitted it — *"only the
 * arithmetic is here"* — and the arithmetic came with the data. This file is the proof it moved: it runs
 * against lib/qty.js with `require`, and a guard below asserts the table is no longer in the page at all.
 *
 * Run: node tests/qty.test.js   · no DB, no browser, no network.
 */
const assert = require('assert');
const Q = require('../lib/qty');
const units = require('../lib/units');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('\n500 GRAMS OF SOMETHING SOLD BY THE KILO\n');

/** ⚠️⚠️ THE ONE THAT MATTERS: a shop prices tomato per KG, so 500 gm has to become 0.5 or the bill is a
 *  thousand times wrong. That sentence is in the page's original note and it is still the whole point. */
it('⚠️⚠️ 500 gm becomes 0.5 kg', () => {
  const r = Q.convert(500, 'gm', 'kg');
  assert.strictEqual(r.qty, 0.5);
  assert.strictEqual(r.converted, true);
});

it('and it goes the other way', () => {
  assert.strictEqual(Q.convert(1.5, 'kg', 'gram').qty, 1500);
  assert.strictEqual(Q.convert(2, 'l', 'ml').qty, 2000);
  assert.strictEqual(Q.convert(750, 'ml', 'litre').qty, 0.75);
});

it('the same unit spelt two ways is not a conversion', () => {
  const r = Q.convert(3, 'kg', 'kgs');
  assert.strictEqual(r.qty, 3);
  assert.strictEqual(r.converted, true);
  assert.strictEqual(r.why, 'the same unit');
});

/**
 * ⚠️⚠️⚠️ A BOX IS NOT A FIXED NUMBER OF ANYTHING. Asking for 500 gm of something sold by the PIECE is not a
 * conversion anybody can do, and guessing would put an invented quantity on a bill somebody pays. The number
 * is taken at face value AND the caller is told, so a screen can say which unit it used.
 */
it('⚠️⚠️⚠️ across families it refuses, and says so', () => {
  const r = Q.convert(500, 'gm', 'piece');
  assert.strictEqual(r.qty, 500, 'it invented a quantity');
  assert.strictEqual(r.converted, false);
  assert.ok(/same kind of measure/.test(r.why), r.why);
  assert.strictEqual(Q.convert(2, 'litre', 'box').converted, false);
});

it('and an unknown unit is simply not a magnitude', () => {
  assert.strictEqual(Q.measured('bundle'), false);
  assert.strictEqual(Q.measured(''), false);
  assert.strictEqual(Q.measured(null), false);
  assert.strictEqual(Q.measured('kg'), true);
  assert.strictEqual(Q.family('ml'), 'v');
  assert.strictEqual(Q.family('kg'), 'w');
  assert.strictEqual(Q.family('plate'), null);
});

console.log('\nTHE VOCABULARY IS THE PLATFORM\'S\n');

/**
 * ⭐⭐ ONE VOCABULARY, NOT TWO. lib/units.js carries every spelling in English, Tamil and Hindi with its UN/ECE
 * and GST codes. This file must key on what THAT resolves to, or a unit spelt one way on the counter and
 * another in the catalogue becomes two different units. [[feedback-no-duplicate-functions]]
 */
it('⭐⭐ a Tamil kilo is a kilo', () => {
  assert.strictEqual(Q.convert(2, 'கிலோ', 'gram', units).qty, 2000);
  assert.strictEqual(Q.convert(500, 'கிராம்', 'kg', units).qty, 0.5);
});

it('and a Hindi one too', () => {
  assert.strictEqual(Q.convert(1, 'किलो', 'gram', units).qty, 1000);
});

it('⚠️ without the vocabulary the bare spellings still work', () => {
  /* ⚠️ a counter whose CBUnits failed to load must still bill 500 gm correctly — the common spellings are
     in the table itself, and only the translated ones need the platform. */
  assert.strictEqual(Q.convert(500, 'gm', 'kg').qty, 0.5);
  assert.strictEqual(Q.convert(500, 'கிராம்', 'kg').converted, false, 'it claimed a translation it cannot do');
});

console.log('\nBIGGER AND SMALLER THAN A SHOP USUALLY NEEDS\n');

it('a quintal and a tonne are weights', () => {
  assert.strictEqual(Q.convert(1, 'quintal', 'kg').qty, 100);
  assert.strictEqual(Q.convert(1, 'tonne', 'kg').qty, 1000);
  assert.strictEqual(Q.convert(1, 'kg', 'quintal').qty, 0.01);
});

/** ⚠️ two decimal places, like every other quantity on a counter — and that is a rounding, not a truncation */
it('⚠️ it rounds to two places, as the counter does everywhere', () => {
  assert.strictEqual(Q.convert(1, 'gram', 'kg').qty, 0);
  assert.strictEqual(Q.convert(5, 'gram', 'kg').qty, 0.01);
  assert.strictEqual(Q.convert(1, 'mg', 'gram').qty, 0);
});

console.log('\nAND THE TABLE IS NO LONGER IN THE PAGE\n');

/**
 * ⭐⭐⭐ THE POINT OF THE WHOLE FILE. Athi: *"no data should be tied tightly to the front end."* If the factors
 * ever reappear in the rendering file, this is the check that says so before it ships.
 */
it('⭐⭐⭐ till.html holds no conversion table of its own', () => {
  const fs = require('fs'), path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(code.indexOf('QTY_UNITS') < 0,
    'the weight/volume factors are back in till.html — data in the rendering file');
  /* ⚠️ and the numbers themselves, in case the table returns under another name */
  assert.ok(!/kg\s*:\s*\[\s*'w'\s*,\s*1000\s*\]/.test(code),
    'a factor table is in the page again, renamed');
});

it('and the engine touches no screen', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'qty.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'fetch('].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/qty.js mentions ' + w);
  });
  /* ⚠️ and it must not have grown its own copy of the spellings — that is lib/units.js's job */
  assert.ok(body.indexOf('கிலோ') < 0, 'the vocabulary has been duplicated into lib/qty.js');
});

console.log('\n' + pass + ' checks passed\n');
