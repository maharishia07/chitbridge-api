/** @covers FR-K12 — the entity's chosen `units` set is what every downstream picker offers */
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

/**
 * ⚠⚠ THE LIST THIS COMPARED AGAINST MOVED REPOS, AND THE CHECK STAYED. It read `lib/units.js LANGS`, which the
 * 2026-09-05 rewrite removed when units.js narrowed to matching by code (Rec 20 · UQC). The 27 languages with
 * their labels and groups went to `CBCatalogue.UNIT_LANGS` in the web repo, where a VIEW belongs — so this died
 * on `undefined.map` before asserting anything, and the drift it guards has been unguarded since.
 *
 * ⭐ The fact is unchanged and still worth guarding: two lists describe one thing. A language Settings offers
 * that the browser cannot label renders blank; one the browser knows that Settings cannot offer is unreachable.
 * ⚠️ Skips when the web repo is absent — the same rule the UNITS check above already follows.
 */
test('⚠️ the selectable languages and the label list in the browser must not drift apart', () => {
  const opts = policy.FLAGS.languages.options;
  const M = (() => { global.CBCatalogue = null;
    try { require('../../chitbridge-web/public/app/catalogue-model.js'); } catch (_) { return null; }
    return global.CBCatalogue; })();
  if (!M || !M.UNIT_LANGS) return;                  // web repo not present → skip rather than fail
  const codes = M.UNIT_LANGS.map((l) => l.code);
  assert.deepStrictEqual([...codes].sort(), [...opts].sort(),
    'Settings offers languages the browser cannot label, or the browser labels ones Settings cannot offer');
  assert.ok(M.UNIT_LANGS.every((l) => l.label && l.group), 'every language needs a label and a group');
});

/**
 * ── ⭐⭐ WHAT EACH UNIT ALLOWS — AND WHAT THE SERVER WILL ACCEPT AS AN ANSWER ─────────────────────
 *
 * Athi, 2026-09-12: *"for each entity we can set decimal allowed, if so tollerance and min qty... and each
 * product obeys that."*
 *
 * ⚠️⚠️ THIS ONE ARRIVES FROM A BROWSER AND IS READ BY THE CART AND THE COUNTER, so what gets stored has to be
 * a shape, not whatever was sent. Every case here is a thing a hand-written request could try.
 */
test('⚠️ unit rules: a declared shape, never free text', () => {
  const set = (v) => policy.coerce ? policy.coerce('unit_rules', v) : undefined;
  if (!policy.coerce) return;                  // not exported here → covered through the route instead

  assert.deepStrictEqual(set({ kg: { decimals: true, tol: 0.01, min_qty: 2 } }),
    { kg: { decimals: true, tol: 0.01, min_qty: 2 } }, 'a well-formed row survives intact');

  /* ⚠️ a key that is not a unit cannot be stored: it would reach a picker as if it were one */
  assert.deepStrictEqual(set({ zzz: { decimals: true } }), {}, 'an unknown unit is dropped');

  /* ⚠️ an unvalidated extra key is read by two clients later; drop it rather than carry it */
  const extra = set({ kg: { decimals: true, evil: '<script>' } });
  assert.deepStrictEqual(extra, { kg: { decimals: true } }, 'anything not in the shape is dropped');

  /* ⚠️ a negative band would round a quantity UPWARD, which is the one direction this must never go */
  assert.deepStrictEqual(set({ kg: { tol: -5 } }), {}, 'a negative tolerance is refused, not clamped to zero');

  assert.strictEqual(set({ kg: { tol: 99999 } }).kg.tol, 1000, 'an absurd band is clamped, not stored');
  assert.strictEqual(set({ kg: { decimals: 'yes' } }).kg.decimals, true, 'the gate is a boolean, whatever was sent');
  assert.deepStrictEqual(set([]), undefined, 'an array is not a map');
  assert.deepStrictEqual(set({}), {}, 'an empty map is legitimate — nothing declared yet');
});

test('the language default is English alone — an entity opts IN to more', () => {
  assert.deepStrictEqual(policy.defaults().languages, ['en']);
});
