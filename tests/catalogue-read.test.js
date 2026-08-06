'use strict';
/**
 * catalogue-read.test.js — one catalogue, many channels.
 *
 * The load-bearing tests are about what must NOT happen: a referenced line must not become editable, a source's
 * rich content must not be flattened away, and an adopted catalogue must not be invisible to its own owner.
 */
const assert = require('assert');
const R = require('../lib/catalogue-read');
const I = require('../lib/identity');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const ME = 'entity-me', BRAND = 'entity-brand';

const OWNED = [
  { item_id: 'i1', item_data: { sku: 'PB-1', name: 'Primer Base', price: { amount: 650, currency: 'INR' } } },
  { item_id: 'i2', item_data: { sku: 'RP-1L', name: 'Tussar', product: 'tussar', size: '1L', price: { amount: 950, currency: 'INR' } } },
];
const SOURCES = [{
  source_key: 'brand-paints@v1', title: 'Brand — interior finishes', owner_entity_id: BRAND,
  items: [
    { name: 'Tomato', unit: 'kg', commercials: { unit: 'kg', price: { amount: 40, currency: 'INR' } } },
    // a RICH item — the reason flattening would be wrong
    { name: 'Metallica', unit: 'litre', texture_family: 'metallic', sheen: 'satin',
      combinations: [{ name: 'Gold Dust', colours: [{ name: 'Gold', hex: '#C9A227' }] }],
      commercials: { price: { amount: 1450, currency: 'INR' } } },
  ],
}];

console.log('\ncatalogue-read · one list');

t('★ owned AND adopted lines come back in ONE list', () => {
  const ls = R.lines({ owned: OWNED, sources: SOURCES, me: ME });
  assert.strictEqual(ls.length, 4, 'two of mine and two adopted is four lines, not two lists');
});
t('owned lines come first, in the order given', () => {
  const ls = R.lines({ owned: OWNED, sources: SOURCES, me: ME });
  assert.deepStrictEqual(ls.slice(0, 2).map((l) => l.fields.sku), ['PB-1', 'RP-1L']);
});
t('every line says where it came from', () => {
  const ls = R.lines({ owned: OWNED, sources: SOURCES, me: ME });
  assert.deepStrictEqual(ls.map((l) => l.origin), ['own', 'own', 'source', 'source']);
  assert.strictEqual(ls[2].source_key, 'brand-paints@v1');
  assert.strictEqual(ls[0].source_key, null);
});

console.log('\ncatalogue-read · who may change what');

t('★ MY line is mine to edit', () => {
  const l = R.lines({ owned: OWNED, sources: [], me: ME })[0];
  assert.strictEqual(l.editable, true);
  assert.deepStrictEqual(R.lockedFields(l), [], 'nothing on my own row is locked');
});
t('★ AN ADOPTED line is NOT editable — I am showcasing their product', () => {
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[0];
  assert.strictEqual(l.editable, false);
  assert.strictEqual(l.owner_entity_id, BRAND);
});
t('★ …unless I AM the source, in which case I edit it at the source', () => {
  const l = R.lines({ owned: [], sources: SOURCES, me: BRAND })[0];
  assert.strictEqual(l.editable, true, 'the brand edits its own catalogue and it cascades to every distributor');
});
t('★ PER FIELD — the brand owns the name, I own the price, on the SAME row', () => {
  // Athi's rule, precisely: a referenced image is theirs; a price I stated is mine.
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[0];
  assert.strictEqual(l.provenance.name, 'source');
  assert.strictEqual(l.provenance.price, 'own', 'I set this price — it is my statement');
  assert.deepStrictEqual(R.editableFields(l).sort(), ['price', 'unit']);
  assert.deepStrictEqual(R.lockedFields(l), ['name']);
});
t('the overlay WINS where both carry a key, and the field becomes mine', () => {
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[0];
  assert.strictEqual(l.fields.unit, 'kg');
  assert.strictEqual(l.provenance.unit, 'own', 'the source suggested it, I confirmed it, so I own the statement');
});
t('a field the overlay leaves BLANK does not steal ownership', () => {
  const src = [{ source_key: 's', owner_entity_id: BRAND, items: [{ name: 'X', unit: 'kg', commercials: { unit: '' } }] }];
  const l = R.lines({ owned: [], sources: src, me: ME })[0];
  assert.strictEqual(l.fields.unit, 'kg');
  assert.strictEqual(l.provenance.unit, 'source', 'an empty overlay is not a statement');
});

console.log('\ncatalogue-read · what it refuses to flatten');

t('★ a rich source item keeps its content, untouched, in `detail`', () => {
  // Flattening a designer finish into a product row would discard the reason the blueprint exists.
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[1];
  assert.ok(l.detail, 'the rich half was thrown away');
  assert.strictEqual(l.detail.texture_family, 'metallic');
  assert.deepStrictEqual(l.detail.combinations[0].colours[0], { name: 'Gold', hex: '#C9A227' });
});
t('a plain source item has no detail to carry', () => {
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[0];
  assert.strictEqual(l.detail, null, 'an empty detail object would be noise on every row');
});
t('the common core is still reachable on a rich line', () => {
  const l = R.lines({ owned: [], sources: SOURCES, me: ME })[1];
  assert.strictEqual(l.fields.name, 'Metallica');
  assert.strictEqual(l.fields.price.amount, 1450);
});

console.log('\ncatalogue-read · identity and variants apply to EVERY line');

t('★ an adopted line is grouped and identified like any other', () => {
  // The whole point of one read: variants must not be a privilege of the excel path.
  const ident = I.resolve({ identity: { key: ['name'], group: 'product', options: ['size'] } });
  const ls = R.lines({ owned: OWNED, sources: SOURCES, me: ME, identity: I, ident });
  assert.strictEqual(ls[2].identity, 'Tomato', 'a referenced line must be identifiable too');
  assert.strictEqual(ls[1].identity, 'Tussar');
});
t('with no declaration, nothing is grouped and nothing breaks', () => {
  const ls = R.lines({ owned: OWNED, sources: SOURCES, me: ME });
  assert.strictEqual(ls[0].identity, undefined);
});

console.log('\ncatalogue-read · a count a person can act on');

t('★ the summary answers "how much of this is mine to change?"', () => {
  const s = R.summary(R.lines({ owned: OWNED, sources: SOURCES, me: ME }));
  assert.deepStrictEqual(s, { total: 4, own: 2, referenced: 2, editable: 2, sources: ['brand-paints@v1'] });
});
t('the brand sees its own source as editable', () => {
  const s = R.summary(R.lines({ owned: [], sources: SOURCES, me: BRAND }));
  assert.strictEqual(s.editable, 2);
});
t('an empty catalogue is an empty list, not a crash', () => {
  assert.deepStrictEqual(R.lines({}), []);
  assert.strictEqual(R.summary(null).total, 0);
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/catalogue-read'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
