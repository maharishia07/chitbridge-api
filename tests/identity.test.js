'use strict';
/**
 * identity.test.js — which line is this, and which product does it belong to?
 *
 * The load-bearing tests are the ones about NOT knowing: a partial identity is not an identity, an undeclared
 * catalogue behaves exactly as it does today, and a declaration naming a field that does not exist is refused
 * rather than quietly producing a catalogue where nothing can be matched.
 */
const assert = require('assert');
const I = require('../lib/identity');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

// One paint, three pack sizes — the exact case the Medusa mapping test flattened into three unrelated rows.
const PAINT = [
  { sku: 'RP-1L',  product: 'tussar', name: 'Tussar', size: '1L',  price: 950 },
  { sku: 'RP-4L',  product: 'tussar', name: 'Tussar', size: '4L',  price: 3400 },
  { sku: 'RP-10L', product: 'tussar', name: 'Tussar', size: '10L', price: 7900 },
  { sku: 'IK-1L',  product: 'ikkat',  name: 'Ikkat',  size: '1L',  price: 1100 },
];
const ID = I.resolve({ identity: { key: ['sku'], group: 'product', options: ['size'] } });

console.log('\nidentity · the declaration');

t('★ a catalogue that declares NOTHING behaves exactly as it does today', () => {
  const id = I.resolve(null);
  assert.deepStrictEqual(id.key, ['sku'], 'sku stays the default — this is not a breaking change');
  assert.strictEqual(id.group, null);
  assert.strictEqual(id.variants, false, 'no group means no variants and nothing to group');
  assert.strictEqual(id.declared, false);
});
t('a trade can identify a line by something other than sku', () => {
  const id = I.resolve({ identity: { key: ['batch_no'] } });
  assert.deepStrictEqual(id.key, ['batch_no'], 'pharma identifies a lot by its batch, not by a shop code');
});
t('a COMPOSITE key is allowed — one field is not always enough', () => {
  const id = I.resolve({ identity: { key: ['hs_code', 'origin_country'] } });
  assert.deepStrictEqual(id.key, ['hs_code', 'origin_country']);
});
t('★ a composite key cannot collide by concatenation', () => {
  const id = I.resolve({ identity: { key: ['a', 'b'] } });
  assert.notStrictEqual(I.identityOf({ a: 'AB', b: 'x' }, id), I.identityOf({ a: 'A', b: 'Bx' }, id),
    'joining the parts with nothing between them would make these the same product');
});
t('⚠ a field that is not a property of the product cannot identify it', () => {
  const id = I.resolve({ identity: { key: ['quantity'], group: 'price', options: ['available_qty'] } });
  assert.deepStrictEqual(id.key, ['sku'], 'quantity is the customer\'s, at order time');
  assert.strictEqual(id.group, null, 'a price is not a product');
  assert.deepStrictEqual(id.options, [], 'stock on hand does not distinguish one variant from another');
});
t('a field cannot both identify a line and distinguish it', () => {
  const id = I.resolve({ identity: { key: ['sku'], options: ['sku', 'size'] } });
  assert.deepStrictEqual(id.options, ['size'], 'the key wins; a field cannot do both jobs');
});

console.log('\nidentity · which line is this');

t('the identity is the key values', () => {
  assert.strictEqual(I.identityOf(PAINT[0], ID), 'RP-1L');
});
t('★ a PARTIAL identity is not an identity', () => {
  const id = I.resolve({ identity: { key: ['hs_code', 'origin_country'] } });
  assert.strictEqual(I.identityOf({ hs_code: '3208' }, id), null,
    'matching on half a key would patch the wrong product');
});
t('a line with no key value cannot be matched', () => {
  assert.strictEqual(I.identityOf({ name: 'Tussar' }, ID), null);
});

console.log('\nidentity · variants — one product, several lines');

t('★ three pack sizes become ONE product with three lines', () => {
  const gs = I.group(PAINT, ID);
  assert.strictEqual(gs.length, 2, 'a paint with three sizes and a second paint is two products, not four');
  assert.strictEqual(gs[0].label, 'Tussar');
  assert.strictEqual(gs[0].lines.length, 3);
  assert.deepStrictEqual(gs[0].options.size, ['1L', '4L', '10L']);
});
t('each line keeps its own identity and its own price', () => {
  const g = I.group(PAINT, ID)[0];
  assert.deepStrictEqual(g.lines.map((l) => l.identity), ['RP-1L', 'RP-4L', 'RP-10L']);
  assert.deepStrictEqual(g.lines.map((l) => l.item.price), [950, 3400, 7900]);
});
t('the variant label is what distinguishes it, for a person', () => {
  const id = I.resolve({ identity: { key: ['sku'], group: 'product', options: ['size', 'sheen'] } });
  assert.strictEqual(I.variantLabel({ size: '1L', sheen: 'Matt' }, id), '1L · Matt');
});
t('★ ORDER IS PRESERVED — a merchant arranged their sheet for a reason', () => {
  // Re-sorting here would be the jsonb column-order bug again in a different costume.
  const shuffled = [PAINT[3], PAINT[1], PAINT[0], PAINT[2]];
  const gs = I.group(shuffled, ID);
  assert.strictEqual(gs[0].label, 'Ikkat', 'groups appear in the order their first line does');
  assert.deepStrictEqual(gs[1].lines.map((l) => l.identity), ['RP-4L', 'RP-1L', 'RP-10L'],
    'lines keep the order they were given, not an order we imposed');
});
t('an UNGROUPED catalogue is every line as its own product — not one giant group', () => {
  const id = I.resolve(null);
  const gs = I.group(PAINT, id);
  assert.strictEqual(gs.length, 4, 'with no group declared, nothing is grouped and today\'s behaviour holds');
});
t('a line missing its group value is not silently swept in with another product', () => {
  const gs = I.group([...PAINT, { sku: 'X1', name: 'Orphan', price: 10 }], ID);
  const orphan = gs.find((g) => g.label === 'Orphan');
  assert.ok(orphan, 'it stands alone rather than joining whichever group happened to be first');
  assert.strictEqual(orphan.lines.length, 1);
});

console.log('\nidentity · the same line twice');

t('★ duplicates are found by the DECLARED key, not by sku', () => {
  const id = I.resolve({ identity: { key: ['batch_no'] } });
  const d = I.duplicates([{ batch_no: 'B1' }, { batch_no: 'B2' }, { batch_no: 'B1' }], id);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].identity, 'B1');
  assert.deepStrictEqual(d[0].indexes, [0, 2]);
});
t('variants are NOT duplicates — they differ by their key', () => {
  assert.deepStrictEqual(I.duplicates(PAINT, ID), [], 'three sizes of one paint are three lines, not three mistakes');
});
t('a line with no identity is not counted as a duplicate of another', () => {
  assert.deepStrictEqual(I.duplicates([{ name: 'a' }, { name: 'b' }], ID), [],
    'two unidentifiable lines are a different problem, reported elsewhere');
});

console.log('\nidentity · a declaration that cannot work');

t('★ a declaration naming a column the catalogue does not have is REFUSED', () => {
  // Worse than no declaration: every line would fail to identify, so every upload would look like a catalogue full
  // of brand new products.
  const problems = I.check(ID, ['sku', 'name', 'price']);
  assert.strictEqual(problems.length, 2);
  assert.ok(problems.some((p) => /product/.test(p)));
  assert.ok(problems.some((p) => /size/.test(p)));
});
t('a declaration that matches the catalogue has nothing to say', () => {
  assert.deepStrictEqual(I.check(ID, ['sku', 'product', 'size', 'name', 'price']), []);
});
t('with no columns to check against, it does not invent problems', () => {
  assert.deepStrictEqual(I.check(ID, []), []);
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/identity'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
