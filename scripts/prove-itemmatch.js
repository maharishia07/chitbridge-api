'use strict';
// prove-itemmatch.js — THE matcher, and the bug that invented money.
//
// ⚠️ THE REGRESSION THIS EXISTS FOR (found 2026-08-12 on a real Tamil order, screenshot from Athi):
// `norm()` was `[^a-z0-9 ]`, so every non-Latin script collapsed to a single space. A bare space then
// substring-matched the first catalogue item — "example product".includes(" ") is TRUE — and all seven lines of a
// Tamil vegetable order resolved to a junk row called "Example product" at ₹100. The chit displayed a confident
// ₹6,800 total that was pure fiction. Nothing flagged it: as far as the matcher knew, every line had matched.
//
// A wrong match is worse than no match, because a gap gets checked and a confident number does not.
//
// Run: node scripts/prove-itemmatch.js
const im = require('../lib/itemmatch');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

/* ⚠️ THE KEY IS BUILT BY THE PRODUCT'S OWN keyOf(), NOT REBUILT HERE. This fixture used to compute it from
   the name alone — before Object.assign applied the variant — so every variant of one product shared a key and a
   picker choosing Hybrid would have resolved to Native. A fixture that models identity differently from the code
   proves the wrong thing, confidently. */
const item = (name, o = {}) => { const it = Object.assign({ name, variant: '', unit: 'kg', price: 10, synonyms: [], conversions: {}, status: 'available' }, o);
  it.key = im.keyOf(it.name, it.variant); return it; };
const mkCat = (items) => {
  const variantsOf = {};
  items.forEach((it) => { (variantsOf[im.norm(it.name)] = variantsOf[im.norm(it.name)] || new Set()).add(it.variant || ''); });
  return { items, variantsOf };
};
const named = (m) => (m && m.item) ? m.item.name : ('unmatched:' + (m && m.reason));

console.log('\n── itemmatch ────────────────────────────────────────────────────────────────\n');

console.log('1 · ⭐ THE RED CASE — a script we cannot read must NOT match anything');
{
  /* Alpha Timers' real catalogue on the day: junk rows, no Tamil anywhere. */
  const cat = mkCat([item('Example product', { price: 100, unit: 'piece' }), item('product1', { price: 250, unit: 'piece' })]);
  ['தக்காளி', 'வெங்காயம்', 'உருளைக்கிழங்கு', 'பீன்ஸ்', 'ஊட்டி கேரட்'].forEach((p) => {
    const m = im.match(p, '', cat);
    ok('"' + p + '" does NOT match "Example product"', !m.item, 'MATCHED ' + named(m) + ' — and would have taken its price');
  });
  const m = im.match('தக்காளி', '', cat);
  eq('…it is reported as unmatched, so it gets FLAGGED and EXCLUDED', m.unmatched, true);
}

console.log('\n2 · …but the SAME word matches once the catalogue knows it');
{
  const cat = mkCat([item('Example product', { price: 100 }), item('Tomato', { price: 30, synonyms: ['thakkali', 'தக்காளி'] })]);
  eq('Tamil, declared as a synonym', named(im.match('தக்காளி', '', cat)), 'Tomato');
  eq('Tanglish, same item', named(im.match('thakkali', '', cat)), 'Tomato');
  eq('English, same item', named(im.match('tomato', '', cat)), 'Tomato');
  /* ⚠️ THE POINT OF THE WHOLE LANGUAGE LAYER: three scripts, one item, one total. If these ever disagree the
     forecast fragments and he under-sources. */
  const all = ['தக்காளி', 'thakkali', 'Tomato', 'TOMATO'].map((p) => named(im.match(p, '', cat)));
  eq('all four spellings collapse to ONE item', [...new Set(all)], ['Tomato']);
}

console.log('\n3 · Tamil vowel signs survive normalisation');
{
  /* ⚠️ \p{M} matters: ா ெ ூ are MARKS, not letters. Keeping only \p{L}\p{N} would silently rewrite every Tamil
     word into a different word — the same class of bug, harder to see. */
  ok('"தக்காளி" keeps its marks', im.norm('தக்காளி') === 'தக்காளி', JSON.stringify(im.norm('தக்காளி')));
  ok('"வெங்காயம்" keeps its marks', im.norm('வெங்காயம்') === 'வெங்காயம்', JSON.stringify(im.norm('வெங்காயம்')));
  ok('two different Tamil words stay different', im.norm('தக்காளி') !== im.norm('வெங்காயம்'));
}

console.log('\n4 · nothing survives normalisation → "no item phrase", never a match');
{
  const cat = mkCat([item('Example product', { price: 100 })]);
  ['...', '!!!', '   ', '₹₹', '—'].forEach((p) => {
    const m = im.match(p, '', cat);
    eq('"' + p + '" → no item phrase', m.reason, 'no item phrase');
  });
  eq('norm() returns EMPTY, not a space — so the guard actually fires', im.norm('...'), '');
}

console.log('\n5 · a substring floor — "a" is inside "banana"');
{
  const cat = mkCat([item('Banana'), item('Cabbage')]);
  ok('a 2-letter phrase does not substring-match', !im.match('ab', '', cat).item);
  ok('a 1-letter phrase does not substring-match', !im.match('a', '', cat).item);
  eq('but a real 3+ substring still works', named(im.match('banan', '', cat)), 'Banana');
}

console.log('\n6 · the rules that were already right, still right');
{
  const cat = mkCat([
    item('Tomato', { synonyms: ['thakkali', 'tomatto'] }),
    item('Orange', { variant: 'grade 1', price: 90 }),
    item('Orange', { variant: 'grade 2', price: 60 }),
  ]);
  eq('a misspelling still resolves', named(im.match('tomator', '', cat)), 'Tomato');
  const o = im.match('orange', '', cat);
  ok('⚠️ a named-nothing variant is FLAGGED, never auto-picked', o.variant_unspecified === true, JSON.stringify(o));
  eq('…and the grades are offered', (o.variants || []).sort(), ['grade 1', 'grade 2']);
  eq('an inline variant resolves', im.match('orange grade 2', '', cat).item.price, 60);
  eq('the comment is searched too', im.match('orange', 'grade 1 please', cat).item.price, 90);
  ok('an unknown item is unmatched', !im.match('dragonfruit', '', cat).item);
}

console.log('\n7 · ⭐ A VARIANT NAMED IN ANOTHER LANGUAGE IS STILL NAMED');
{
  /* ⚠️ Found seeding a real Tamil catalogue. Variants are recorded in English (big/small/nattu) but customers
     name them in their own words (periya/chinna/நாட்டு). decideVariant asks whether the text contains the
     variant WORD, so "periya vengayam" — which says BIG about as plainly as it can be said — came back as
     "grade not named" and refused to price. On a Tamil catalogue that is EVERY variant line. */
  const cat = mkCat([
    item('Onion', { variant: 'big',   price: 40, synonyms: ['vengayam', 'periya vengayam', 'big onion'] }),
    item('Onion', { variant: 'small', price: 68, synonyms: ['vengayam', 'chinna vengayam', 'shallot'] }),
  ]);
  /* A synonym carried by exactly ONE variant means the customer named it. */
  eq('"periya vengayam" prices as big', im.match('periya vengayam', '', cat).item.price, 40);
  eq('"chinna vengayam" prices as small', im.match('chinna vengayam', '', cat).item.price, 68);
  eq('"shallot" too — the language does not matter, the uniqueness does', im.match('shallot', '', cat).item.price, 68);
  /* ⚠️ AND THE RULE STILL HOLDS WHERE IT MATTERS: a synonym on BOTH variants names neither. */
  const gen = im.match('vengayam', '', cat);
  ok('⚠️ a generic term shared by both variants still FLAGS, never picks', gen.variant_unspecified === true, JSON.stringify(gen));
  eq('…and offers both', (gen.variants || []).sort(), ['big', 'small']);
}

console.log('\n8 · ⭐ A REFUSAL MUST HAND BACK ITS SHORTLIST');
{
  /* Athi, 2026-08-13: *"we need provision to pick up the right price from the two or three similar items which
     are ambiguous."* Refusing to guess was always right; refusing and then DISCARDING the two items it was
     choosing between made the refusal unresolvable — the screen could say "matches 2 catalogue lines" and offer
     nothing to click. A refusal that keeps its evidence is a question; one that throws it away is a dead end. */
  const cat = mkCat([
    item('Tomato', { variant: 'Native', price: 30, unit: 'kg', synonyms: ['thakkali'] }),
    item('Tomato', { variant: 'Hybrid', price: 36, unit: 'kg', synonyms: ['thakkali'] }),
    item('Tomato Crate', { price: 450, unit: 'crate', synonyms: ['thakkali'] }),
  ]);
  const amb = im.match('thakkali', '', cat);
  ok('a synonym on three names is still AMBIGUOUS — the shortlist does not soften the refusal',
    amb.ambiguous === true && !amb.item, JSON.stringify(amb).slice(0, 160));
  ok('⭐ …and the candidates travel with it', (amb.candidates || []).length === 3, JSON.stringify(amb.candidates));
  ok('every candidate carries a key, a price and a status — enough to decide from',
    (amb.candidates || []).every((c) => c.key && c.price != null && c.status),
    JSON.stringify(amb.candidates));
  eq('the count still reports the NAMES in play, not the rows', amb.matches, 2);

  /* The other cause of the same question: the grade was never named. One picker must answer both. */
  const vcat = mkCat([
    item('Orange', { variant: 'grade 1', price: 80 }),
    item('Orange', { variant: 'grade 2', price: 60 }),
  ]);
  const v = im.match('orange', '', vcat);
  ok('a variant-unspecified line ALSO hands back candidates', (v.candidates || []).length === 2, JSON.stringify(v.candidates));
  eq('…and keeps `variants` for the readers that print names', (v.variants || []).sort(), ['grade 1', 'grade 2']);
  ok('⚠️ a clean match carries NO candidates — a picker must not appear where there is nothing to decide',
    im.match('orange grade 1', '', vcat).candidates === undefined);
}

console.log('\n9 · ⭐ FIXING THE BASE — what the item WAS at this moment');
{
  /* Athi, 2026-08-13: *"the boat is moving and we are trying to fix the base, and it always slips. So the first
     thing is, at any point in time, what is the reference at this point in time — that fixes the base."*
     An id says WHICH row. The row keeps moving. The stamp says what it SAID when the chit was made, so drift
     becomes a checkable fact instead of an argument. */
  const base = { name: 'Tomato', variant: 'Hybrid', unit: 'kg', price: 36, sku: 'VEG-02', status: 'available' };
  const h = im.stampOf(base);
  ok('the same row stamps the same, every time', im.stampOf({ ...base }) === h);
  ok('⭐ a REPRICE changes the stamp — the whole point', im.stampOf({ ...base, price: 40 }) !== h);
  ok('⭐ a RENAME changes it', im.stampOf({ ...base, name: 'Tomato Local' }) !== h);
  ok('⭐ going out of stock changes it', im.stampOf({ ...base, status: 'unavailable' }) !== h);
  ok('a changed unit changes it', im.stampOf({ ...base, unit: 'crate' }) !== h);

  /* ⚠️ THE SEPARATOR BUG THIS ALMOST SHIPPED WITH. Joining the fields on a SPACE — a character these values
     legitimately contain — makes two genuinely different rows stamp identically, which is the one thing a stamp
     must never do. Found by writing this assertion, not by reading the code. */
  ok('⚠️ "Tomato Hybrid"+"" and "Tomato"+"Hybrid" are DIFFERENT rows and must not share a stamp',
    im.stampOf({ ...base, name: 'Tomato Hybrid', variant: '' }) !== im.stampOf(base));

  /* ⚠️ A STAMP MUST NEVER BE ABLE TO TAKE THE RAISE PATH DOWN. money.amountOf THROWS on a legacy bare price with
     no currency — correct when money is being committed, catastrophic in a hashing helper. */
  let threw = null;
  try { im.stampOf({ name: 'X', variant: '', unit: 'kg', price: 36, sku: null, status: 'available' }); }
  catch (e) { threw = e.message; }
  ok('⚠️ a legacy bare price does NOT throw — evidence is not a transaction', threw === null, threw);
  ok('…nor does a missing price', (() => { try { return !!im.stampOf({ name: 'X', variant: '', unit: '', price: null, sku: null, status: 'available' }); } catch (_) { return false; } })());

  /* Same price, two shapes — the migration must not look like a change. */
  eq('a stamped {amount,currency} stamps identically to the bare number it replaced',
    im.stampOf({ ...base, price: { amount: 36, currency: 'INR' } }), h);
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
