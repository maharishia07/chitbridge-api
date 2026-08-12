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

const item = (name, o = {}) => Object.assign({ name, variant: '', unit: 'kg', price: 10, synonyms: [], conversions: {}, key: im.norm(name) + '|' }, o);
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

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
