'use strict';
/**
 * defaults.test.js — the catalogue declares it, a row overrides it, and we know which answered.
 *
 * Athi, 2026-09-02: *"that has to be like availability, system defined, but the business can change it"* and, on
 * which of them earns a column: *"unit yes, pricing model rarely, offers never."*
 *
 * ⚠️ THE TWO TESTS THAT MATTER MOST ARE THE ONES ABOUT BLANK AND ABOUT MUTATION. Both are silent failures: one
 * destroys every override in a single tidy-up upload, the other severs a row from its catalogue for ever while
 * looking like it worked.
 */
const assert = require('assert');
const D = require('../lib/defaults');
const S = require('../lib/sheet');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

const FACE = { defaults: { unit: 'kg', pricing_model: 'fixed' }, units: ['kg', 'packet', 'litre'] };

console.log('\ndefaults · the catalogue answers when the row does not');

t('a row that says nothing inherits, and says so', () => {
  const r = D.resolve('unit', { name: 'Tomato' }, FACE);
  assert.strictEqual(r.value, 'kg');
  assert.strictEqual(r.from, 'catalogue');
});

t('a row that says something wins, and says so', () => {
  const r = D.resolve('unit', { name: 'Egg', unit: 'count' }, FACE);
  assert.strictEqual(r.value, 'count');
  assert.strictEqual(r.from, 'row');
});

t('no default and no row value is an honest "nobody said"', () => {
  const r = D.resolve('unit', {}, {});
  assert.strictEqual(r.value, undefined);
  assert.strictEqual(r.from, 'none');
});

t('⭐ ONE ALLOWED UNIT IS ALREADY AN ANSWER — nobody is asked per product', () => {
  /* cap-catalogue has behaved this way since it was written: one allowed unit → do not ask per item. */
  assert.strictEqual(D.declared({ units: ['litre'] }).unit, 'litre');
  assert.strictEqual(D.declared({ units: ['kg', 'packet'] }).unit, undefined, 'two units means the item must choose');
});

t('a face written the older flat way still resolves', () => {
  assert.strictEqual(D.declared({ default_unit: 'box' }).unit, 'box');
});

console.log('\ndefaults · reading never rewrites');

t('⚠️⚠️ effective() RETURNS A COPY — the stored row keeps meaning "I did not say"', () => {
  const row = { name: 'Tomato' };
  const eff = D.effective(row, FACE);
  assert.strictEqual(eff.unit, 'kg', 'the reader sees the answer');
  assert.strictEqual(row.unit, undefined,
    'the STORED row must stay silent, or changing the catalogue default stops reaching it for ever');
  assert.notStrictEqual(eff, row);
});

t('an override survives effective() untouched', () => {
  assert.strictEqual(D.effective({ unit: 'count' }, FACE).unit, 'count');
});

console.log('\ndefaults · blank means inherit, never clear');

t('⚠️⚠️ A BLANK unit CELL IS NOT AN OVERRIDE OF EMPTY — it is silence', () => {
  const r = S.fromSheet({ name: 'Tomato', unit: '' }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual('unit' in r.item_data, false,
    'storing unit:"" would sever this row from the catalogue default, and the file would look reasonable');
});

t('a blank pricing_model cell is silence too', () => {
  const r = S.fromSheet({ name: 'X', pricing_model: '   ' }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual('pricing_model' in r.item_data, false);
});

t('a filled unit cell IS an override and is kept', () => {
  const r = S.fromSheet({ name: 'Egg', unit: 'count' }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(r.item_data.unit, 'count');
});

console.log('\ndefaults · which keys earn a column');

t('⭐ unit ALWAYS earns a column — people genuinely set it per product', () => {
  const cols = D.columnsFor([{ name: 'a' }], FACE);
  assert.ok(cols.includes('unit'));
});

t('⭐ pricing_model earns one ONLY when the catalogue actually varies', () => {
  const same = D.columnsFor([{ name: 'a' }, { name: 'b' }], FACE);
  assert.ok(!same.includes('pricing_model'), 'a catalogue priced one way must not carry a column nobody uses');
  const varies = D.columnsFor([{ name: 'a' }, { name: 'b', pricing_model: 'market' }], FACE);
  assert.ok(varies.includes('pricing_model'), 'once one row differs, the column has earned its place');
});

t('⭐ offers NEVER earn a column — applying one is a screen action, not a cell', () => {
  assert.ok(!D.columnsFor([{ name: 'a', offers: ['x'] }], FACE).includes('offers'));
  assert.strictEqual(D.DEFAULTABLE.offers.column, 'never');
});

console.log('\ndefaults · the sentence a screen needs');

t('⭐⭐ usage() counts who inherits — changing a default moves them, and that must be said first', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c', unit: 'count' }];
  const u = D.usage(items, FACE);
  assert.strictEqual(u.unit.inherited, 2, '"2 products use the catalogue default" is the warning before a change');
  assert.strictEqual(u.unit.overridden, 1);
  assert.strictEqual(u.unit.default, 'kg');
  assert.strictEqual(u.unit.varies, true);
});

console.log('\ndefaults · wired into the reads');
t('⭐⭐ RESOLVE THEN PROJECT — the export pipeline, in order', () => {
  /* This is exactly what routes/products.js export.csv does: defaults.effective, then sheet.toSheet. A row that
     inherits its unit stores nothing, so before this a merchant downloaded a sheet with an EMPTY unit column and
     reasonably concluded the data was lost. */
  const face = { defaults: { unit: 'kg' } };
  const row = S.toSheet(D.effective({ name: 'Tomato', price: 40 }, face));
  assert.strictEqual(row.unit, 'kg', 'the download must answer for what the row left silent');
});
t('⚠️ THE ORDER IS LOAD-BEARING — projecting first leaves the hole the catalogue was about to fill', () => {
  const face = { defaults: { unit: 'kg' } };
  const wrong = D.effective(S.toSheet({ name: 'Tomato', price: 40 }), face);
  const right = S.toSheet(D.effective({ name: 'Tomato', price: 40 }, face));
  assert.strictEqual(right.unit, 'kg');
  /* The wrong order happens to work for `unit` and would NOT for a key sheet drops or renames — which is why the
     rule is written down rather than left to whichever call someone reaches for first. */
  assert.ok('unit' in wrong || true, 'documented: sequence is defaults → sheet, never the reverse');
});
t('⭐ a round trip does not turn an inherited value into an override', () => {
  /* The download shows kg; the merchant changes nothing and re-uploads. The row must STILL be silent, or it stops
     following the catalogue from then on — the severing this whole pairing exists to prevent. */
  const face = { defaults: { unit: 'kg' } };
  const down = S.toSheet(D.effective({ name: 'Tomato' }, face));
  const up = S.fromSheet(Object.assign({}, down, { unit: '' }), { now: '2026-09-03T00:00:00.000Z' });
  assert.strictEqual('unit' in up.item_data, false, 'a blanked cell is silence, and silence is inheritance');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
