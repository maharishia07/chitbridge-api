/**
 * CONSOLIDATE × UNIT ALIASES — the wiring, and the line it must not cross.
 *
 * Athi approved the two-line engine change on 2026-08-17. These tests exist because that change touches the
 * MONEY PATH: consolidate.js decides what a trader sources. Its governing rule — NEVER INVENT A CONVERSION —
 * predates the aliases and must survive them.
 *
 * ⚠️ The distinction the whole thing rests on:
 *     கிலோ → kg    a RENAME.      Same quantity, different script. Safe to fold, changes no number.
 *     sack → kg    a CONVERSION.  Needs a factor, the factor is entity-specific, and it stays REFUSED
 *                                 unless that entity DECLARED it on the item.
 * A regression here does not throw and does not look wrong — it produces a plausible total that is incorrect,
 * and someone buys to it. That is why the refusal is asserted as hard as the fold.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const consolidate = require('../lib/consolidate');
const itemmatch = require('../lib/itemmatch');

const norm = itemmatch.norm;
const keyOf = (n, v) => norm(n) + '|' + norm(v || '');
/* A catalogue in the shape loadCatalogue produces, without a database. */
const cat = (items) => ({ items: items.map((d) => ({
  name: d.name, variant: d.variant || '', unit: d.unit || '', price: d.price,
  conversions: d.conversions || {}, synonyms: (d.synonyms || []).map(norm),
  key: keyOf(d.name, d.variant), status: null, status_text: null, status_note: null,
})) });

const DATE = '2026-08-20';
const req = (chit, lines) => ({ store_id: 's-' + chit, store_name: 'Store ' + chit, chit_id: chit, fulfil_date: DATE, lines });
const CAT = cat([
  { name: 'Drumstick', unit: 'kg' },
  { name: 'Curry Leaves', unit: 'bunch' },
  { name: 'Onion', unit: 'kg', conversions: { crate: 20 } },
]);

test('⭐ THE LIVE BUG: 8 கிலோ + 3 kg totals to 11 kg, with no split', () => {
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Drumstick', qty: 8, unit: 'கிலோ' }]),
    req('c2', [{ particulars: 'Drumstick', qty: 3, unit: 'kg' }]),
  ], CAT);
  const l = out.lines[0];
  assert.strictEqual(l.total, 11);
  assert.strictEqual(l.canonical_unit, 'kg');
  assert.strictEqual(l.unit_split, undefined, 'the same unit in two scripts is not a split');
  assert.strictEqual(out.flags.unit_split.length, 0);
});

test('three spellings of one unit fold together — 0 bunch + 20 கட்டு + 5 kattu', () => {
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Curry Leaves', qty: 20, unit: 'கட்டு' }]),
    req('c2', [{ particulars: 'Curry Leaves', qty: 5, unit: 'kattu' }]),
    req('c3', [{ particulars: 'Curry Leaves', qty: 2, unit: 'bunch' }]),
  ], CAT);
  assert.strictEqual(out.lines[0].total, 27);
  assert.strictEqual(out.flags.unit_split.length, 0);
});

test('⚠️ THE LINE HOLDS: an undeclared conversion is still REFUSED', () => {
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Onion', qty: 5, unit: 'kg' }]),
    req('c2', [{ particulars: 'Onion', qty: 2, unit: 'sack' }]),   // nobody said how much a sack is
  ], CAT);
  const l = out.lines[0];
  assert.strictEqual(l.total, 5, 'only the canonical-unit quantity is totalled');
  assert.ok(l.flagged && /no conversion defined/.test(l.flagged));
  assert.deepStrictEqual(l.unit_split, [{ unit: 'kg', qty: 5 }, { unit: 'sack', qty: 2 }]);
  assert.strictEqual(out.flags.unit_split.length, 1, 'and it is reported, not swallowed');
});

test('a DECLARED conversion still applies, and still records how it was reached', () => {
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Onion', qty: 5, unit: 'kg' }, { particulars: 'Onion', qty: 2, unit: 'crate' }]),
  ], CAT);
  const l = out.lines[0];
  assert.strictEqual(l.total, 45);                       // 5 + (2 × 20)
  assert.deepStrictEqual(l.conversions_applied, [
    { from_unit: 'crate', qty: 2, factor: 20, to_unit: 'kg', became: 40 },
  ]);
});

test('a conversion declared under a SPELLING of a unit still resolves', () => {
  /* ⚠️ Conversion keys are written by the entity, so they are spelled however that entity spells them. Now that
     the incoming unit arrives folded, an exact-match-only lookup could MISS a factor that used to resolve. The
     lookup tries the exact key first and only then the folded one — additive, never subtractive. */
  const C = cat([{ name: 'Rice', unit: 'kg', conversions: { 'மூட்டை': 25 } }]);
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Rice', qty: 2, unit: 'மூட்டை' }]),
  ], C);
  assert.strictEqual(out.lines[0].total, 50);
});

test('an unknown unit is untouched and still un-summable', () => {
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Drumstick', qty: 4, unit: 'kg' }]),
    req('c2', [{ particulars: 'Drumstick', qty: 1, unit: 'gunny' }]),
  ], CAT);
  assert.strictEqual(out.lines[0].total, 4);
  assert.ok(out.lines[0].unit_split.some((s) => s.unit === 'gunny'), 'an unseen unit keeps its own name');
});

test('folding units does NOT fold item names — the alias table never touches a product', () => {
  /* ⚠️ The reason aliases live in lib/units.js instead of inside norm(): norm() also folds item names, and a
     unit vocabulary leaking into product matching would silently merge two different products. */
  const C = cat([{ name: 'Kilo Bar', unit: 'piece' }, { name: 'Kg Cable', unit: 'piece' }]);
  const out = consolidate.consolidate([
    req('c1', [{ particulars: 'Kilo Bar', qty: 1, unit: 'piece' }]),
    req('c2', [{ particulars: 'Kg Cable', qty: 1, unit: 'piece' }]),
  ], C);
  assert.strictEqual(out.lines.length, 2, 'two products named like units must stay two products');
});
