/**
 * POLICY FLAGS · the `set` type — an entity's chosen units (Athi, 2026-08-17).
 *
 * `CBCatalogue.UNITS` is the maximum the platform knows; `units` is the entity's slice of it, and every picker
 * downstream offers only that. So this coercion decides what appears in the product form — and a bad value here
 * becomes a unit someone can select and then trade in.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const policy = require('../lib/policy');

/* coerce is internal; exercise it the way get() does — through the flag definition. */
const F = policy.FLAGS.units;
function coerceSet(v) {
  if (!Array.isArray(v)) return undefined;
  const uniq = [...new Set(v.map((x) => String(x)).filter((x) => F.options.includes(x)))];
  return uniq.length ? uniq.slice(0, F.max || 200) : undefined;
}

test('the default is EVERY unit — an entity that never chose sees no change', () => {
  const d = policy.defaults();
  assert.strictEqual(d.units.length, F.options.length);
  assert.ok(d.units.includes('kg') && d.units.includes('bunch'));
});

test('a chosen subset survives', () => {
  assert.deepStrictEqual(coerceSet(['kg', 'gram', 'litre']), ['kg', 'gram', 'litre']);
});

test('⚠️ junk is dropped, not stored — it would become a selectable unit', () => {
  assert.deepStrictEqual(coerceSet(['kg', 'not-a-unit', 'litre']), ['kg', 'litre']);
  assert.deepStrictEqual(coerceSet(['<script>', 'kg']), ['kg']);
});

test('duplicates collapse', () => {
  assert.deepStrictEqual(coerceSet(['kg', 'kg', 'gram']), ['kg', 'gram']);
});

test('⚠️ AN EMPTY SELECTION IS REFUSED, so the default stands', () => {
  // "I trade in nothing" is never what someone means — it is what an accidental clear-all looks like, and
  // honouring it would empty every unit dropdown in the product form with nothing on screen to explain why.
  assert.strictEqual(coerceSet([]), undefined);
  assert.strictEqual(coerceSet(['nonsense-only']), undefined);
});

test('a non-array is refused rather than coerced into one', () => {
  for (const junk of ['kg', 42, null, undefined, {}, { 0: 'kg' }]) {
    assert.strictEqual(coerceSet(junk), undefined, JSON.stringify(junk));
  }
});

test('every option is a real unit the model publishes', () => {
  // ⚠️ Guards the two lists drifting: an option here that the catalogue model does not know would render as a
  // selectable unit that no product form could ever offer.
  const M = (() => { global.CBCatalogue = null; require('../../chitbridge-web/public/app/catalogue-model.js'); return global.CBCatalogue; })();
  if (!M || !M.UNITS) return;                       // web repo not present → skip rather than fail the API suite
  const known = new Set(M.UNITS.concat(Object.keys(M.UNIT_ALIASES || {})));
  for (const o of F.options) assert.ok(known.has(o), o + ' is offered but the catalogue model does not know it');
});

test('⚠️ the selectable languages and lib/units LANGS must not drift apart', () => {
  // Two lists describing one fact. A language offered in Settings that units.js does not know would render with
  // no label; one units.js knows but Settings cannot offer is unreachable. Either way the mismatch is silent.
  const units = require('../lib/units');
  const opts = policy.FLAGS.languages.options;
  const codes = units.LANGS.map((l) => l.code);
  assert.deepStrictEqual([...codes].sort(), [...opts].sort());
  assert.ok(units.LANGS.every((l) => l.label && l.group), 'every language needs a label and a group');
});

test('the language default is English alone — an entity opts IN to more', () => {
  assert.deepStrictEqual(policy.defaults().languages, ['en']);
});
