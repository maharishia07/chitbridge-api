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
it('⚠️⚠️ groupsRaw() keeps a draft groupsOf() would drop — authoring and selling ask different questions', () => {
  const draft = [{ name: 'Spice', required: false, max: 1, options: [] }];   /* named, no options yet */
  assert.strictEqual(V.groupsOf({ modifiers: draft }).length, 0, 'groupsOf must still refuse an unfinished group');
  assert.strictEqual(V.groupsRaw({ modifiers: draft }).length, 1, 'groupsRaw must still show it to whoever is finishing it');
  assert.strictEqual(V.groupsRaw({ item_data: { modifiers: draft } }).length, 1, 'reads the item_data shape too, same as groupsOf');
  assert.strictEqual(V.groupsRaw(null).length, 0);
  assert.strictEqual(V.groupsRaw({ modifiers: 'nonsense' }).length, 0);
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

/**
 * ── ⭐⭐⭐ AUTHORING — A CAPABILITY, NOT A SCREEN ─────────────────────────────────────────────────────────
 * Every verb: input a groups array (however it got here), output a fresh one in the exact stored shape.
 * Pure, so these run with no DOM and no host at all — proof that a screen is not required to use this.
 */
console.log('\n— authoring: input a groups array, output the stored shape, always —');
/**
 * ⚠️⚠️⚠️ EVERY EXPORTED NAME MUST ACTUALLY BE A FUNCTION ON V — a name used only by its OWN callers inside
 * this file (addGroup etc. all call normalize() internally) can pass every test above while being missing
 * from EXPORTS entirely; a host calling V.normalize() directly gets `undefined is not a function`, or worse,
 * a defensive `typeof V.normalize==='function'` guard elsewhere silently skips cleaning and saves the raw,
 * unstripped input instead. This is the test that would have caught exactly that.
 */
it('⚠️⚠️⚠️ every documented verb is actually reachable on V, not only used internally', () => {
  ['groupsOf', 'groupsRaw', 'missing', 'words', 'wordsPlain', 'byGroup', 'normalize', 'validate',
   'addGroup', 'removeGroup', 'moveGroup', 'setGroup', 'addOption', 'removeOption', 'moveOption', 'setOption',
   'toggle', 'summary']
    .forEach((name) => assert.strictEqual(typeof V[name], 'function', 'V.' + name + ' is not exported as a function'));
});
it('normalize() is callable directly, not only through the verbs that use it internally', () => {
  assert.deepStrictEqual(V.normalize([{ name: 'Spice', options: [{ name: 'Hot', price: '5', cost: 99, supplier: 'X' }] }]),
    [{ name: 'Spice', required: false, max: 1, options: [{ name: 'Hot', price: 5 }] }],
    'a field outside the stored shape survived — the exact leak this function exists to close');
});
it('addGroup starts empty, required off, max 1 — a group with nothing to say yet', () => {
  const g = V.addGroup([], 'Spice level');
  assert.deepStrictEqual(g, [{ name: 'Spice level', required: false, max: 1, options: [] }]);
});
it('addOption then setOption — a name and a price, nothing else survives', () => {
  let g = V.addGroup([], 'Bread');
  g = V.addOption(g, 0, 'Naan', 0);
  g = V.setOption(g, 0, 0, { price: 25, cost: 8, supplier_code: 'X9' });
  assert.deepStrictEqual(g[0].options[0], { name: 'Naan', price: 25 },
    'a field outside {name,price} rode along — the shape-guard let it through');
});
/**
 * ⚠️⚠️⚠️ THE BUG "+ ADD AN OPTION" SHIPPED WITH. cleanOption() used to return null for a blank name, and
 * addOption() fed that straight into cleanGroup()'s own .filter(Boolean) — so the option just appended was
 * gone again before the SAME call returned, and the button visibly did nothing on both app.html's Modifiers
 * tab and the Offer Lab's modifier lab. Caught by e2e/offer-lab-next-modlab.cjs, not by looking.
 */
it('⚠️⚠️⚠️ addOption() with no name yet still actually adds a row — it must survive to be typed into', () => {
  let g = V.addGroup([], 'Bread');
  g = V.addOption(g, 0, '', 0);
  assert.strictEqual(g[0].options.length, 1, 'the option vanished in the same call that added it');
  assert.strictEqual(g[0].options[0].name, '');
  g = V.setOption(g, 0, 0, { name: 'Naan' });   /* the row is still there afterwards to actually name */
  assert.strictEqual(g[0].options[0].name, 'Naan');
});
it('a blank option name is still reported by validate(), just no longer silently erased', () => {
  let g = V.addOption(V.addGroup([], 'Bread'), 0, '', 0);
  const r = V.validate(g);
  assert.ok(r.errors.some((e) => /still needs a name/.test(e.message)), 'no warning for the unnamed option: ' + JSON.stringify(r.errors));
});
/** ⚠️ ONLY GARBAGE IS DROPPED — a genuinely malformed array entry, never a person's own unfinished row */
it('a non-object entry in options is still dropped as garbage, unlike a blank-named real one', () => {
  const g = V.normalize([{ name: 'Bread', options: [null, 'not an object', { name: 'Naan', price: 0 }] }]);
  assert.deepStrictEqual(g[0].options, [{ name: 'Naan', price: 0 }]);
});
it('setGroup only touches what it is given — a price patch on option 0 leaves group settings alone', () => {
  let g = V.addGroup([], 'Spice');
  g = V.setGroup(g, 0, { required: true, max: 2 });
  assert.strictEqual(g[0].name, 'Spice');
  assert.strictEqual(g[0].required, true);
  assert.strictEqual(g[0].max, 2);
});
it('removeOption and removeGroup actually shrink the array, by index', () => {
  let g = V.addGroup([], 'Spice');
  g = V.addOption(g, 0, 'Hot', 0);
  g = V.addOption(g, 0, 'Mild', 0);
  g = V.removeOption(g, 0, 0);
  assert.strictEqual(g[0].options.length, 1);
  assert.strictEqual(g[0].options[0].name, 'Mild');
  g = V.removeGroup(g, 0);
  assert.strictEqual(g.length, 0);
});
it('moveGroup and moveOption reorder, and clamp rather than throw past either end', () => {
  let g = V.addGroup(V.addGroup([], 'A'), 'B');
  g = V.moveGroup(g, 0, 5);                     /* far past the end — clamps to the last slot */
  assert.strictEqual(g[g.length - 1].name, 'A');
  g = V.addOption(V.addOption(g, 0, 'X', 0), 0, 'Y', 0);
  g = V.moveOption(g, 0, 1, -5);                 /* far before the start — clamps to the first slot */
  assert.strictEqual(g[0].options[0].name, 'Y');
});
it('⚠️⚠️ max is always a whole number, at least 1, however it was typed', () => {
  const g = V.setGroup(V.addGroup([], 'X'), 0, { max: '3.7' });
  assert.strictEqual(g[0].max, 3);
  const g2 = V.setGroup(V.addGroup([], 'X'), 0, { max: 0 });
  assert.strictEqual(g2[0].max, 1, 'a max under 1 must never mean "choose nothing"');
  const g3 = V.setGroup(V.addGroup([], 'X'), 0, { max: 'not a number' });
  assert.strictEqual(g3[0].max, 1);
});
/**
 * ⚠️⚠️⚠️ MOVED, NOT DELETED — this used to assert a blank-named option was dropped on the spot; that turned
 * out to be the exact bug "+ Add an option" shipped with (see the dedicated test further down): the option
 * addOption() had JUST appended was gone again before the same call returned, so the button did nothing. The
 * name still trims to whitespace-free ('   ' → ''); what changed is that a real, still-unfinished row now
 * survives to be typed into, same as a nameless GROUP already did.
 */
it('a blank option name still trims to empty, but the row itself now survives to be finished', () => {
  const g = V.addOption(V.addGroup([], 'X'), 0, '   ', 5);
  assert.strictEqual(g[0].options.length, 1, 'the row must still be there to type a name into');
  assert.strictEqual(g[0].options[0].name, '');
});
it('validate: a duplicate group name, an empty group, and a duplicate option are each named', () => {
  let g = V.addGroup(V.addGroup([], 'Spice'), 'Spice');   /* two groups, same name */
  g = V.addOption(g, 0, 'Hot', 0);
  g = V.addOption(g, 0, 'Hot', 0);                        /* same option twice in one group */
  const r = V.validate(g);
  assert.strictEqual(r.ok, false);
  const msgs = r.errors.map((e) => e.message).join(' | ');
  assert.ok(/used twice/.test(msgs), 'a duplicate group name went unreported: ' + msgs);
  assert.ok(/no options yet/.test(msgs), 'the second, empty "Spice" went unreported: ' + msgs);
  assert.ok(/repeated/.test(msgs), 'the duplicate option went unreported: ' + msgs);
});
it('validate: a clean, well-formed set of groups reports ok with no errors', () => {
  let g = V.addOption(V.addGroup([], 'Spice'), 0, 'Hot', 0);
  const r = V.validate(g);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
});
it('⚠️⚠️⚠️ WHAT AUTHORING WRITES, groupsOf() READS BACK — the same module, so they cannot disagree', () => {
  let g = V.addGroup([], 'Spice');
  g = V.setGroup(g, 0, { required: true, max: 1 });
  g = V.addOption(g, 0, 'Hot', 0);
  assert.strictEqual(V.groupsOf({ modifiers: g }).length, 1, 'authoring produced a shape the reader rejects');
  assert.deepStrictEqual(V.missing(V.groupsOf({ modifiers: g }), []), ['Spice']);
});
it('a nameless in-progress group is not lost on the NEXT edit, only dropped once something reads/saves it', () => {
  const g = V.addGroup([], '');                 /* mid-type — no name typed yet */
  const g2 = V.addOption(g, 0, 'Hot', 0);        /* still editable by index */
  assert.strictEqual(g2[0].options.length, 1);
  assert.strictEqual(V.validate(g2).groups.length, 0, 'a nameless group must never actually save');
});
/**
 * ── ⭐⭐⭐ TOGGLE — THE BEHAVIOUR AN AUTHORING PREVIEW SHOWS (Athi: "when we create modifiers, we should be
 * able to see the behaviour where we are authoring"). Same flat choice shape words()/addedPrice()/missing()
 * already read — a preview and a real chooser can share every one of these functions, not just the shape.
 */
console.log('\n— toggle: the one rule for picking an option, proven against the shape every reader expects —');
it('max 1 is radio behaviour — picking a second option replaces the first, never adds to it', () => {
  const g = { name: 'Spice', required: true, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Hot', price: 0 }] };
  let picks = V.toggle([], g, 'Mild');
  assert.deepStrictEqual(picks, [{ group: 'Spice', option: 'Mild', price: 0 }]);
  picks = V.toggle(picks, g, 'Hot');
  assert.deepStrictEqual(picks, [{ group: 'Spice', option: 'Hot', price: 0 }], 'a second pick under max 1 must replace, not add');
});
it('tapping the same option again un-picks it', () => {
  const g = { name: 'Spice', required: false, max: 1, options: [{ name: 'Hot', price: 0 }] };
  let picks = V.toggle([], g, 'Hot');
  picks = V.toggle(picks, g, 'Hot');
  assert.deepStrictEqual(picks, []);
});
it('max > 1 adds up to the limit, then drops the OLDEST pick, never refuses silently', () => {
  const g = { name: 'Extra', required: false, max: 2, options: [{ name: 'Paneer', price: 20 }, { name: 'Cheese', price: 15 }, { name: 'Mushroom', price: 10 }] };
  let picks = V.toggle([], g, 'Paneer');
  picks = V.toggle(picks, g, 'Cheese');
  assert.strictEqual(picks.length, 2);
  picks = V.toggle(picks, g, 'Mushroom');   /* third pick at max 2 — the OLDEST (Paneer) must go, not a refusal */
  assert.strictEqual(picks.length, 2, 'the limit was not enforced');
  assert.deepStrictEqual(picks.map((m) => m.option).sort(), ['Cheese', 'Mushroom']);
});
it('a choice in one group never disturbs a choice already made in another', () => {
  const spice = { name: 'Spice', max: 1, options: [{ name: 'Hot', price: 0 }] };
  const extra = { name: 'Extra', max: 1, options: [{ name: 'Paneer', price: 20 }] };
  let picks = V.toggle([], spice, 'Hot');
  picks = V.toggle(picks, extra, 'Paneer');
  assert.strictEqual(picks.length, 2);
  picks = V.toggle(picks, spice, 'Hot');   /* un-pick spice */
  assert.deepStrictEqual(picks, [{ group: 'Extra', option: 'Paneer', price: 20 }], 'Extra’s own pick was disturbed');
});
it('an option name that does not exist on the group changes nothing', () => {
  const g = { name: 'Spice', max: 1, options: [{ name: 'Hot', price: 0 }] };
  const picks = V.toggle([{ group: 'Spice', option: 'Hot', price: 0 }], g, 'Not a real option');
  assert.deepStrictEqual(picks, [{ group: 'Spice', option: 'Hot', price: 0 }]);
});
it('⚠️⚠️⚠️ what a preview shows and what missing()/words() report about it agree, because it IS the same shape', () => {
  const groups = V.setGroup(V.addOption(V.addGroup([], 'Spice'), 0, 'Hot', 0), 0, { required: true });
  let picks = [];
  assert.deepStrictEqual(V.missing(groups, picks), ['Spice'], 'an unpicked required group must be reported missing');
  picks = V.toggle(picks, groups[0], 'Hot');
  assert.deepStrictEqual(V.missing(groups, picks), [], 'picking it must clear the missing report');
  assert.strictEqual(V.words(picks, (n) => '₹' + n), 'Hot');
});
it('summary reads as a one-line fact for any host’s own outcome row', () => {
  assert.strictEqual(V.summary([]), 'No modifiers yet');
  let g = V.addOption(V.addGroup([], 'Spice'), 0, 'Hot', 0);
  g = V.addOption(g, 0, 'Mild', 0);
  assert.strictEqual(V.summary(g), '1 group · 2 options');
});
it('every verb defends against garbage input the same way groupsOf() always has', () => {
  assert.deepStrictEqual(V.addGroup(null, 'X').length, 1);
  assert.deepStrictEqual(V.removeGroup('not an array', 0), []);
  assert.deepStrictEqual(V.setOption([{ name: 'G', options: [] }], 5, 5, { price: 1 }), [{ name: 'G', required: false, max: 1, options: [] }]);
});

console.log('\n══ the variant engine · ' + pass + ' passed · ' + fail + ' failed ══');
console.log(pass + ' checks\n');
if (fail) process.exitCode = 1;
