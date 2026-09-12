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

/**
 * ⭐ The browser's catalogue model, read once. It is a script that attaches to a global rather than a module,
 * so it is required for its SIDE EFFECT — the same way policy-set.test.js already reads it.
 * ⚠️ Returns null when the web repo is not checked out, and every caller SKIPS on null rather than failing.
 */
function webModel() {
  try {
    global.CBCatalogue = null;
    require('../../chitbridge-web/public/app/catalogue-model.js');
    return global.CBCatalogue && global.CBCatalogue.UNIT_LANGS ? global.CBCatalogue : null;
  } catch (_) { return null; }
}

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

/**
 * ⚠️⚠️ THE TAGGED TABLE LIVES IN THE BROWSER NOW, AND THIS CHECK HAD NOT FOLLOWED IT.
 *
 * On 2026-09-05 lib/units.js was rewritten around codes (ours · Rec 20 · UQC) and its ALIASES flattened to one
 * array per unit: the API MATCHES, and no longer needs to know which language a spelling came from. The
 * language-tagged map and the 27-language list went to `CBCatalogue.UNIT_ALIASES` / `UNIT_LANGS` in the web
 * repo, which is where a VIEW belongs. Nothing was lost — this test simply kept asserting the old address, and
 * died on `aliasesIn is not a function` before checking anything at all.
 *
 * ⭐⭐ AND THE SPLIT CREATED A BETTER QUESTION THAN THE ONE THIS USED TO ASK. Two repos now hold one fact: the
 * browser says "किलो is Hindi for kg" and the API decides what किलो folds to. If they ever disagree, a shop
 * types a word its own screen offered and the total quietly puts it in a different bucket. That is asserted
 * below, spelling by spelling, and it could not have been asserted while both halves lived in one file.
 *
 * ⚠️ Skips rather than fails when the web repo is not checked out — the same rule policy-set.test.js follows,
 * because a cross-repo test that breaks a single-repo build gets deleted and then guards nothing.
 */
test('⚠️⚠️ THE LANGUAGE TAG IS FOR READING, NOT MATCHING', () => {
  // Every language folds, always — a screen showing Hindi must not stop Tamil resolving.
  assert.strictEqual(normUnit('கிலோ'), 'kg', 'Tamil');
  assert.strictEqual(normUnit('किलो'), 'kg', 'Hindi');
  assert.strictEqual(normUnit('kilos'), 'kg', 'English');
  assert.ok(aliasesOf('kg').includes('கிலோ') && aliasesOf('kg').includes('किलो'),
    'the flat list still spans every language');

  const M = webModel();
  if (!M) return;                                   // web repo not present → skip, never fail
  const tagged = M.UNIT_ALIASES || {};
  assert.ok((tagged.kg || {}).hi && tagged.kg.hi.includes('किलो'),
    'the browser no longer tags किलो as Hindi — the language view has lost its data');
  assert.ok(!(tagged.kg.hi || []).includes('கிலோ'), 'a language view lists only that language');
  assert.ok(M.UNIT_LANGS.length >= 3 && M.UNIT_LANGS.every((l) => l.code && l.label),
    'every offerable language needs a code and a label');

  /* ⭐ THE JOIN, WHICH IS THE POINT: every spelling the browser offers must fold to the unit it is filed under. */
  const wrong = [];
  for (const canon of Object.keys(tagged)) {
    for (const lang of Object.keys(tagged[canon])) {
      for (const word of tagged[canon][lang]) {
        if (normUnit(word) !== canon) wrong.push(word + ' (' + lang + ') is filed under ' + canon
          + ' in the browser and folds to ' + normUnit(word) + ' in the API');
      }
    }
  }
  assert.deepStrictEqual(wrong, [], 'the two halves of one fact disagree:\n  ' + wrong.join('\n  '));
});

test('⚠️ पेटी IS DELIBERATELY NOT AN ALIAS OF box', () => {
  // peti commonly means a CRATE, which holds a different quantity. Folding it onto `box` would be inventing a
  // conversion rather than recording a rename — the one thing this table may never do.
  assert.strictEqual(normUnit('पेटी'), 'पेटी');
  assert.ok(!aliasesOf('box').includes('पेटी'));
});

/**
 * ⚠️⚠️ THIS WAS REPORTING NONSENSE, WHICH IS WORSE THAN REPORTING NOTHING. It walked `ALIASES[canon][lang]`
 * over a table that is now a flat ARRAY: Object.keys gave "0", "1", "2", the inner loop iterated a STRING, and
 * it announced that the letter **"g" is claimed by both kg and gram**. A red naming a letter is a red nobody
 * can act on, and it sat in the suite looking like a unit collision.
 * ⭐ The rule it guards is worth keeping exactly as it was: one spelling, one unit, whatever language it is in.
 * Now asserted over BOTH halves — the API's flat matcher and the browser's tagged map.
 */
test('no spelling is claimed by two units, ACROSS languages', () => {
  const { ALIASES } = require('../lib/units');
  const seen = new Map();
  const claim = (word, canon, where) => {
    const k = normUnit(word);
    const prev = seen.get(k);
    assert.ok(prev === undefined || prev === canon,
      '"' + word + '" is claimed by both ' + prev + ' and ' + canon + ' (' + where + ')');
    seen.set(k, canon);
  };
  for (const canon of Object.keys(ALIASES)) for (const a of ALIASES[canon]) claim(a, canon, 'lib/units.js');

  const M = webModel();
  if (!M) return;
  const tagged = M.UNIT_ALIASES || {};
  for (const canon of Object.keys(tagged)) {
    for (const lang of Object.keys(tagged[canon])) {
      for (const a of tagged[canon][lang]) claim(a, canon, 'catalogue-model.js · ' + lang);
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
