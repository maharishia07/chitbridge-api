'use strict';
/**
 * catalogue-columns.test.js — the declaration and the store, bound.
 *
 * ⚠️ THE TESTS THAT MATTER HERE ARE THE REFUSALS. Auto-declaration is easy to get superficially right and
 * expensive to get wrong: a column manufactured from a typo, or from the system's own bookkeeping, is permanent
 * and — being in use by definition — unremovable. So most of this file asserts what does NOT become a column.
 */
const assert = require('assert');
const C = require('../lib/catalogue-columns');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

const DECLARED = ['name', 'unit', 'price', 'grade'];
const LABELS = { grade: 'Quality grade' };

console.log('\ncatalogue-columns · folding an incoming key');

t('an exact key folds to itself and creates nothing', () => {
  const f = C.fold('price', DECLARED, LABELS);
  assert.strictEqual(f.key, 'price');
  assert.strictEqual(f.how, 'exact');
});

t('the column\'s own LABEL folds onto its key — the merchant types what they see', () => {
  const f = C.fold('Quality grade', DECLARED, LABELS);
  assert.strictEqual(f.key, 'grade');
  assert.strictEqual(f.how, 'label');
});

t('a known synonym folds — "Rate" is not a second price column', () => {
  const f = C.fold('Rate', DECLARED, LABELS);
  assert.strictEqual(f.key, 'price');
  assert.strictEqual(f.how, 'synonym');
});

t('casing and spacing normalise onto the same column', () => {
  assert.strictEqual(C.fold('Grade', DECLARED, LABELS).key, 'grade');
  assert.strictEqual(C.fold('  grade  ', DECLARED, LABELS).key, 'grade');
});

t('⚠️ a merely SIMILAR key is declared separately and flagged, never merged', () => {
  const f = C.fold('grde', DECLARED, LABELS);
  assert.strictEqual(f.how, 'similar', 'a typo must not silently become `grade`');
  assert.strictEqual(f.key, 'grde');
  assert.strictEqual(f.near, 'grade');
});

t('⚠️ two products one character apart stay two columns — the loaded-gun case', () => {
  /* csv-preflight's own warning: "orange grade 1" and "orange grade 2" must never match each other. */
  const a = C.fold('grade_1', DECLARED, LABELS);
  const b = C.fold('grade_2', DECLARED, LABELS);
  assert.notStrictEqual(a.key, b.key);
});

t('a genuinely new key becomes a new column', () => {
  const f = C.fold('hs_code', DECLARED, LABELS);
  assert.strictEqual(f.how, 'new');
  assert.strictEqual(f.key, 'hs_code');
});

console.log('\ncatalogue-columns · what is NEVER a column');

t('system fields are stored but not declared', () => {
  for (const k of ['status', 'avail', 'categories']) {
    assert.strictEqual(C.fold(k, DECLARED, LABELS).how, 'reserved', k + ' must not be declarable');
  }
});

t('travelling copies and overlays are not columns', () => {
  for (const k of ['category_names', 'commercials', 'synonyms', 'source_ref', 'category']) {
    assert.strictEqual(C.fold(k, DECLARED, LABELS).how, 'reserved', k + ' must not be declarable');
  }
});

t('record ids and per-row control keys are refused, as they are on a file', () => {
  for (const k of ['item_id', 'entity_id', 'schema_id', 'quantity', 'is_active', 'order_input']) {
    assert.strictEqual(C.fold(k, DECLARED, LABELS).how, 'reserved', k + ' must not be declarable');
  }
});

t('a reserved key still REACHES item_data — it is not a column, it is still a value', () => {
  const p = C.planWrite({ item_data: { name: 'Tea', status: 'available' }, declared: DECLARED, labels: LABELS });
  assert.strictEqual(p.item_data.status, 'available');
  assert.ok(!p.newFields.some((f) => f.field_key === 'status'));
});

console.log('\ncatalogue-columns · planning one write');

t('⭐ THE PARITY CASE: {name, price, grade} on a catalogue without `grade` declares it', () => {
  const p = C.planWrite({ item_data: { name: 'Tea', price: 180, grade: 'A' }, declared: ['name', 'price'], labels: {} });
  assert.deepStrictEqual(p.newFields.map((f) => f.field_key), ['grade']);
  assert.strictEqual(p.newFields[0].field_type, 'text');
});

t('a number-valued new column is declared as a number', () => {
  const p = C.planWrite({ item_data: { hs_code: 902121 }, declared: ['name'], labels: {} });
  assert.strictEqual(p.newFields[0].field_type, 'number');
});

t('the merchant\'s own spelling becomes the label they will look for', () => {
  const p = C.planWrite({ item_data: { 'HS Code': '9021' }, declared: ['name'], labels: {} });
  assert.strictEqual(p.newFields[0].field_key, 'hs_code');
  assert.strictEqual(p.newFields[0].field_name, 'HS Code');
});

t('an already-declared key adds no column', () => {
  const p = C.planWrite({ item_data: { name: 'Tea', grade: 'A' }, declared: DECLARED, labels: LABELS });
  assert.strictEqual(p.newFields.length, 0);
});

t('⚠️ two spellings folding onto one column: an empty value never erases a real one', () => {
  const p = C.planWrite({ item_data: { Grade: 'A', grade: '' }, declared: DECLARED, labels: LABELS });
  assert.strictEqual(p.item_data.grade, 'A', 'key order must not decide whether data survives');
});

t('a similar key produces a warning naming its neighbour', () => {
  const p = C.planWrite({ item_data: { grde: 'A' }, declared: DECLARED, labels: LABELS });
  assert.strictEqual(p.newFields.length, 1);
  assert.ok(/grade/.test(p.warnings[0]), 'the warning must name what it resembles: ' + p.warnings[0]);
});

t('folding is reported, so a caller can say what it changed', () => {
  const p = C.planWrite({ item_data: { Rate: 10 }, declared: DECLARED, labels: LABELS });
  assert.deepStrictEqual(p.folded[0], { from: 'Rate', to: 'price', how: 'synonym' });
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
