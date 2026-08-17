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

test('⚠️⚠️ THE LANGUAGE TAG IS FOR READING, NOT MATCHING', () => {
  const { LANGS, aliasesIn } = require('../lib/units');
  // Every language folds, always — a screen showing Hindi must not stop Tamil resolving.
  assert.strictEqual(normUnit('கிலோ'), 'kg', 'Tamil');
  assert.strictEqual(normUnit('किलो'), 'kg', 'Hindi');
  assert.strictEqual(normUnit('kilos'), 'kg', 'English');
  // aliasesIn is a VIEW helper: it narrows what is listed and nothing else.
  assert.ok(aliasesIn('kg', 'hi').includes('किलो'));
  assert.ok(!aliasesIn('kg', 'hi').includes('கிலோ'), 'a language view lists only that language');
  assert.ok(aliasesOf('kg').includes('கிலோ') && aliasesOf('kg').includes('किलो'),
    'the flat list still spans every language');
  assert.ok(LANGS.length >= 3 && LANGS.every((l) => l.code && l.label));
});

test('⚠️ पेटी IS DELIBERATELY NOT AN ALIAS OF box', () => {
  // peti commonly means a CRATE, which holds a different quantity. Folding it onto `box` would be inventing a
  // conversion rather than recording a rename — the one thing this table may never do.
  assert.strictEqual(normUnit('पेटी'), 'पेटी');
  assert.ok(!aliasesOf('box').includes('पेटी'));
});

test('no spelling is claimed by two units, ACROSS languages', () => {
  const { ALIASES } = require('../lib/units');
  const seen = new Map();
  for (const canon of Object.keys(ALIASES)) {
    for (const lang of Object.keys(ALIASES[canon])) {
      for (const a of ALIASES[canon][lang]) {
        const k = normUnit(a);
        const prev = seen.get(k);
        assert.ok(prev === undefined || prev === canon, `"${a}" claimed by both ${prev} and ${canon}`);
        seen.set(k, canon);
      }
    }
  }
});

test('⚠️⚠️ AN ENTITY MAY TEACH A WORD, NEVER REDEFINE ONE', () => {
  // AI-proposed spellings, once a human confirms them, reach normUnit as `extra`. They must be able to add
  // vocabulary the platform lacks — and must NOT be able to re-point a unit the platform already knows.
  // Otherwise one accepted proposal quietly shifts every total on that account with nothing to show for it.
  const mine = { 'മൂട്ട': 'kg', 'petti': 'box', 'kg': 'gram' };
  assert.strictEqual(normUnit('മൂട്ട'), 'മൂട്ട', 'unknown without the entity map');
  assert.strictEqual(normUnit('മൂട്ട', mine), 'kg', 'taught by the entity');
  assert.strictEqual(normUnit('petti', mine), 'box');
  assert.strictEqual(normUnit('kg', mine), 'kg', 'the curated table WINS — kg cannot become gram');
});

test('⚠️ an entity word pointing at a unit we do not know resolves to nothing', () => {
  // A confirmed spelling whose target is junk must not invent a unit; it stays itself and remains un-summable.
  assert.strictEqual(normUnit('zzz', { zzz: 'not-a-unit' }), 'zzz');
  assert.strictEqual(normUnit('zzz', { zzz: '' }), 'zzz');
});

test('the extra map never changes behaviour when absent — the default path is untouched', () => {
  for (const w of ['kg', 'கிலோ', 'किलो', 'gunny', '']) {
    assert.strictEqual(normUnit(w), normUnit(w, undefined));
    assert.strictEqual(normUnit(w), normUnit(w, {}));
  }
});
