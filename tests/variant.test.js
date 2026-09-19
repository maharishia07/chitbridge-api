'use strict';
/**
 * ONE PRODUCT, MANY COMBINATIONS — the variant engine (CBVariant).
 *
 * Athi, 2026-09-19: *"same product, but combinations can be different. in the cart, it has to be identified as
 * a separate item… if the same choice is chosen again, it has to be added to the existing cart."*
 *
 * ⚠️⚠️ THE ONE RULE, AND BOTH HALVES OF IT ARE SILENT WHEN BROKEN:
 *   the same set of choices must ALWAYS produce the same name  — or a bill grows two identical rows;
 *   a different set must NEVER produce it                      — or two different things merge into one line
 *                                                                 and somebody receives the wrong goods.
 * Neither failure disturbs the arithmetic. The total stays right and the bill is wrong.
 *
 * Run: node tests/variant.test.js
 */
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app', 'variant.js');
(0, eval)(fs.readFileSync(SRC, 'utf8'));
const V = globalThis.CBVariant;

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
const M = (group, option, price) => ({ group, option, price: price || 0 });
const money = (v) => '₹' + Number(v).toFixed(2);

console.log('\n══ the variant engine ══\n');

console.log('— the same choices are the same variant —');
/**
 * ⚠️⚠️⚠️ THE BUG THIS ENGINE WAS EXTRACTED FOR. The signature used to be built in the order somebody tapped,
 * so inside a group allowing two extras the same pizza had two names — and two lines on one bill.
 */
it('⚠️⚠️⚠️ pick order inside a group cannot change the name', () => {
  assert.strictEqual(V.sig([M('Extra', 'Paneer', 20), M('Extra', 'Cheese', 15)]),
                     V.sig([M('Extra', 'Cheese', 15), M('Extra', 'Paneer', 20)]));
});
it('⚠️⚠️ nor can the order the GROUPS arrive in — a parked draft restores in whatever order it likes', () => {
  assert.strictEqual(V.sig([M('Spice', 'Hot'), M('Extra', 'Paneer', 20)]),
                     V.sig([M('Extra', 'Paneer', 20), M('Spice', 'Hot')]));
});
it('⭐ and same() answers the question a merge is really asking', () => {
  assert.ok(V.same([M('Spice', 'Hot'), M('Extra', 'Paneer', 20)], [M('Extra', 'Paneer', 20), M('Spice', 'Hot')]));
  assert.ok(!V.same([M('Spice', 'Hot')], [M('Spice', 'Medium')]));
});
it('⚠️ the PRICE of an option is not part of its identity — a price rise must not split a line', () => {
  assert.strictEqual(V.sig([M('Extra', 'Paneer', 20)]), V.sig([M('Extra', 'Paneer', 25)]));
});

console.log('— and different choices never collide —');
it('⭐ medium and hot are two variants', () => {
  assert.notStrictEqual(V.sig([M('Spice', 'Medium')]), V.sig([M('Spice', 'Hot')]));
});
it('⚠️ one extra is not the same as two', () => {
  assert.notStrictEqual(V.sig([M('Extra', 'Paneer', 20)]),
                        V.sig([M('Extra', 'Paneer', 20), M('Extra', 'Cheese', 15)]));
});
/**
 * ⚠️⚠️ THE SAME WORD IN TWO GROUPS IS TWO DIFFERENT CHOICES. "Large" as a size and "Large" as a portion are not
 * interchangeable, and a signature of options alone would have merged them.
 */
it('⚠️⚠️ the same option name in different groups does not collide', () => {
  assert.notStrictEqual(V.sig([M('Size', 'Large')]), V.sig([M('Portion', 'Large')]));
});

console.log('— the line identity —');
it('⭐ the key is the product code plus the choices — Athi’s "some other field"', () => {
  assert.strictEqual(V.keyOf('p1', [M('Spice', 'Hot')]), 'p1|Spice:Hot');
});
it('⚠️ a product with no choices keeps its plain id, so nothing changes for a catalogue with no variants', () => {
  assert.strictEqual(V.keyOf('p1', []), 'p1');
  assert.strictEqual(V.keyOf('p1', null), 'p1');
});
it('⚠️ a malformed choice is dropped rather than silently misfiled', () => {
  assert.strictEqual(V.keyOf('p1', [M('Spice', 'Hot'), { option: 'orphan' }, null]), 'p1|Spice:Hot');
});

console.log('— what the choices cost, and how we say them —');
it('the added price is per UNIT, never per line', () => {
  assert.strictEqual(V.addedPrice([M('Extra', 'Paneer', 20), M('Extra', 'Cheese', 15)]), 35);
  assert.strictEqual(V.addedPrice([]), 0);
});
it('⚠️ it rounds to paise — 0.1 + 0.2 must not reach a bill', () => {
  assert.strictEqual(V.addedPrice([M('a', 'x', 0.1), M('a', 'y', 0.2)]), 0.3);
});
/**
 * ⚠️ THE ENGINE NEVER FORMATS MONEY. CBMoney owns that; a second opinion about how to write ₹ is how one
 * screen comes to disagree with another.
 */
it('⚠️ money is passed IN — the engine writes no currency of its own', () => {
  assert.strictEqual(V.words([M('Spice', 'Hot'), M('Extra', 'Paneer', 20)], money), 'Hot · Paneer +₹20.00');
  assert.strictEqual(V.wordsPlain([M('Spice', 'Hot'), M('Extra', 'Paneer', 20)]), 'Hot · Paneer');
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(src.indexOf('toFixed') < 0 && src.indexOf('Intl.NumberFormat') < 0,
    'the engine formats money itself — that belongs to CBMoney');
});
it('a free option shows no price', () => {
  assert.strictEqual(V.words([M('Spice', 'Hot')], money), 'Hot');
});

console.log('— is it complete —');
const GROUPS = [
  { name: 'Spice', required: true, max: 1, options: [{ name: 'Mild' }, { name: 'Hot' }] },
  { name: 'Extra', max: 2, options: [{ name: 'Paneer', price: 20 }] }
];
it('a required group with nothing chosen is named, so a screen can say which', () => {
  assert.deepStrictEqual(V.missing(GROUPS, []), ['Spice']);
  assert.deepStrictEqual(V.missing(GROUPS, [M('Spice', 'Hot')]), []);
});
it('an optional group is never missing', () => {
  assert.deepStrictEqual(V.missing(GROUPS, [M('Spice', 'Hot')]), []);
});
it('groupsOf reads either shape, and a malformed row cannot throw a till', () => {
  assert.strictEqual(V.groupsOf({ modifiers: GROUPS }).length, 2);
  assert.strictEqual(V.groupsOf({ item_data: { modifiers: GROUPS } }).length, 2);
  assert.strictEqual(V.groupsOf({ modifiers: 'nonsense' }).length, 0);
  assert.strictEqual(V.groupsOf(null).length, 0);
  assert.strictEqual(V.groupsOf({ modifiers: [{ name: 'Empty', options: [] }] }).length, 0);
});

console.log('— reopening a chooser on an existing line —');
it('the flat list regroups, so a chooser can be seeded from a line', () => {
  const g = V.byGroup([M('Spice', 'Hot'), M('Extra', 'Paneer', 20)], GROUPS);
  assert.deepStrictEqual(Object.keys(g).sort(), ['Extra', 'Spice']);
  assert.strictEqual(g.Spice[0].option, 'Hot');
});
/**
 * ⚠️ A GROUP THE PRODUCT NO LONGER OFFERS IS DROPPED. A shop that changed its menu since the line was added
 * must not get a chooser that cannot draw itself.
 */
it('⚠️ a choice whose group has gone from the menu is dropped', () => {
  const g = V.byGroup([M('Spice', 'Hot'), M('Retired', 'Old')], GROUPS);
  assert.strictEqual(g.Retired, undefined);
  assert.strictEqual(g.Spice.length, 1);
});
it('with no groups given, everything is kept — the caller has not said what is allowed', () => {
  const g = V.byGroup([M('Anything', 'At all')], null);
  assert.strictEqual(g.Anything.length, 1);
});

console.log('\n══ the variant engine · ' + pass + ' passed · ' + fail + ' failed ══');
console.log(pass + ' checks\n');
if (fail) process.exitCode = 1;
