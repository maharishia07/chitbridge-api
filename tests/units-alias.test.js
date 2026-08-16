/**
 * UNIT ALIASES — the tests that keep a RENAME from becoming a CONVERSION.
 *
 * ⚠️ The failure this guards against does not look like a failure. If an alias table ever gains an entry that
 * changes a quantity's meaning (crate → kg), every total downstream stays plausible and is wrong, and nothing
 * in the UI can tell. So the last test asserts the negative: units that need a factor are NOT folded together.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { normUnit, sameUnit, aliasesOf } = require('../lib/units');

test('the live failures from the group-sum pane now fold', () => {
  // 0 bunch + 20 கட்டு + 5 kattu  ← one unit, three spellings
  assert.strictEqual(normUnit('கட்டு'), 'bunch');
  assert.strictEqual(normUnit('kattu'), 'bunch');
  assert.ok(sameUnit('bunch', 'கட்டு') && sameUnit('கட்டு', 'kattu'));
  // 0 kg + 8 கிலோ
  assert.strictEqual(normUnit('கிலோ'), 'kg');
  // 37 litre + 10 லிட்டர்
  assert.strictEqual(normUnit('லிட்டர்'), 'litre');
});

test('canonical names map to themselves, and folding is case/space/punctuation tolerant', () => {
  assert.strictEqual(normUnit('kg'), 'kg');
  assert.strictEqual(normUnit('  KG  '), 'kg');
  assert.strictEqual(normUnit('Kilos'), 'kg');
  assert.strictEqual(normUnit('KG.'), 'kg');
});

test('an unknown unit SURVIVES — it is never mapped to a guess or dropped', () => {
  // ⚠️ the honest outcome for an unseen unit is that it stays itself and the totalling path flags it
  assert.strictEqual(normUnit('gunny'), 'gunny');
  assert.strictEqual(normUnit('மூட்டை'), 'மூட்டை');
  assert.strictEqual(normUnit(''), '');
  assert.strictEqual(normUnit(null), '');
  assert.strictEqual(normUnit(undefined), '');
});

test('⚠️ NO ALIAS IS A CONVERSION — units needing a factor stay separate', () => {
  // Each pair is a real unit relationship that requires a NUMBER. None may ever collapse.
  const mustStaySeparate = [
    ['kg', 'gram'], ['kg', 'tonne'], ['litre', 'ml'], ['piece', 'dozen'],
    ['crate', 'kg'], ['bag', 'kg'], ['box', 'piece'], ['sack', 'kg'], ['bunch', 'kg'],
  ];
  for (const [a, b] of mustStaySeparate) {
    assert.ok(!sameUnit(a, b), `${a} and ${b} must NOT fold together — that would invent a conversion`);
  }
});

test('every alias resolves to a canonical name that is itself canonical (no chains, no orphans)', () => {
  const { ALIASES } = require('../lib/units');
  for (const canon of Object.keys(ALIASES)) {
    assert.strictEqual(normUnit(canon), canon, `${canon} must be its own canonical form`);
    for (const a of aliasesOf(canon)) {
      assert.strictEqual(normUnit(a), canon, `${a} should fold to ${canon}`);
    }
  }
});

test('no spelling is claimed by two different canonical units', () => {
  const { ALIASES } = require('../lib/units');
  const seen = new Map();
  for (const canon of Object.keys(ALIASES)) {
    for (const a of aliasesOf(canon)) {
      const prev = seen.get(normUnit(a));
      // ⚠️ a duplicate would make the winner depend on key order — silent, and different per Node version
      assert.ok(prev === undefined || prev === canon, `"${a}" claimed by both ${prev} and ${canon}`);
      seen.set(normUnit(a), canon);
    }
  }
});
