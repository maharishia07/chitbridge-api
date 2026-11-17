'use strict';
/**
 * handle.test.js — a name a person can say out loud.
 *
 * The load-bearing tests are the refusals: a handle that looks like a bridge id, a handle that outgrows the column,
 * and the case-folding one — because a handle that differs only in case would look distinct and collide.
 */
const assert = require('assert');
const H = require('../lib/handle');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

console.log('\nhandle · making a name');

t('★ Athi + Clothing → athi.clothing', () => {
  assert.deepStrictEqual(H.child('athi', 'Clothing'), { handle: 'athi.clothing', label: 'clothing' });
});
t('★★ TWO LEVELS, ALWAYS — composing from a department still gives athi.mens', () => {
  // Athi: "we don't need levels naming convention… otherwise it will keep growing and it would be difficult to
  // manage if it is 10 levels, and if an employee underneath." The ltree carries depth; the name does not.
  assert.strictEqual(H.child('athi.clothing', 'Mens').handle, 'athi.mens');
  assert.strictEqual(H.child('athi', 'Mens').handle, 'athi.mens', 'same answer whichever handle you compose from');
});
t('a real shop name becomes a usable label', () => {
  assert.strictEqual(H.slug("Men's Clothing"), 'mens-clothing', 'an apostrophe must not become a dash');
  assert.strictEqual(H.slug('Pharmacy & Wellness'), 'pharmacy-wellness');
  assert.strictEqual(H.slug('  Cold  Storage  '), 'cold-storage');
});
t('★ everything is lowercased — the uniqueness index is on lower(user_id)', () => {
  // Storing mixed case would let Athi.Clothing and athi.clothing LOOK distinct while colliding: the worst of both.
  assert.strictEqual(H.child('ATHI', 'CLOTHING').handle, 'athi.clothing');
});
t('a name with nothing to slug is refused, not silently dropped', () => {
  assert.ok(H.child('athi', '!!!').error);
  assert.ok(/no letters or numbers/.test(H.child('athi', '###').error));
});

console.log('\nhandle · what it refuses');

t('★★ a handle may not look like a bridge id', () => {
  // Otherwise it could impersonate an identity in any field that accepts either — and login now accepts both.
  const r = H.check('cbm5p72hb7');
  assert.strictEqual(r.ok, false);
  assert.ok(/cannot look like a User ID/.test(r.reason));
});
t('★ reserved words are refused at the ROOT only', () => {
  assert.strictEqual(H.check('admin').ok, false, 'a top-level admin would be confusing in every URL');
  assert.strictEqual(H.check('athi.support').ok, true, 'but a department may be called support');
});
t('a handle is not an email address', () => {
  assert.strictEqual(H.check('athi@shop.com').ok, false);
});
t('dots must separate names, not decorate them', () => {
  assert.strictEqual(H.check('athi..clothing').ok, false);
  assert.strictEqual(H.check('.athi').ok, false);
  assert.strictEqual(H.check('athi.').ok, false);
});
t('a label cannot start or end with a dash', () => {
  assert.strictEqual(H.check('athi.-clothing').ok, false);
  assert.strictEqual(H.check('athi.clothing-').ok, false);
});
t('★ it cannot outgrow the column — user_id is varchar(100)', () => {
  const long = 'a'.repeat(60) + '.' + 'b'.repeat(60);
  assert.strictEqual(H.check(long).ok, false, 'a handle longer than the column would be truncated on write');
});
t('★★ a third level is REFUSED, and the message says where depth belongs', () => {
  assert.strictEqual(H.check('athi').ok, true, 'the network root itself');
  assert.strictEqual(H.check('athi.clothing').ok, true);
  const r = H.check('athi.clothing.mens');
  assert.strictEqual(r.ok, false);
  assert.ok(/network tree, not in the name/.test(r.reason));
});

t('★ a co-assist login stays sayable', () => {
  // The reason the depth cap exists: an employee is `ravi@<handle>`. Two levels keeps that at ravi@athi.mens.
  const h = H.child('athi.clothing.mens', 'Formals');   // even from an over-deep input
  assert.strictEqual('ravi@' + h.handle, 'ravi@athi.formals');
});
t('an unusable ROOT is reported as such, not as a child problem', () => {
  const r = H.child('cb12345678', 'Clothing');
  assert.ok(/network name is not usable/.test(r.error), 'the person must know WHICH name is the problem');
});

console.log('\nhandle · reading the network from the name');

t('the root is the network', () => {
  assert.strictEqual(H.rootOf('athi.clothing.mens'), 'athi');
  assert.strictEqual(H.rootOf('athi'), 'athi');
});
t('★ two members of one network share a root', () => {
  assert.strictEqual(H.sameRoot('athi.clothing', 'athi.pharmacy'), true);
  assert.strictEqual(H.sameRoot('athi.clothing', 'ravi.pharmacy'), false);
});
t('⚠ sameRoot is a DISPLAY convenience — the tree stays the authority', () => {
  // A store that joined a second network still carries its original handle, so the name can outlive the
  // relationship. Access is decided by cb_entity.path, never by string comparison.
  assert.strictEqual(H.sameRoot('athi.clothing', 'athi.clothing'), true);
  assert.strictEqual(H.sameRoot('', 'athi'), false, 'an empty handle belongs to no network');
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/handle'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log('');
console.log('handle · minted names — is there room, and can they be mixed up?');

t('⭐⭐ a minted name FITS the column in the worst case the rules allow', () => {
  /**
   * Athi, 2026-09-11: *"do we have enough room in our convention? We should not have enough char to name supplier
   * with entity-id.sup01 etc and get mixed up?"*
   *
   * The longest handle check() accepts is two labels of MAX_LABEL. Minting adds `~`, a dot, the kind and the
   * digits. Asserted rather than measured once, because MAX_LABEL and MINTED_DIGITS are both things somebody will
   * raise later — and the failure mode of getting it wrong is a silently truncated id in the database.
   */
  const longest = 'a'.repeat(H.MAX_LABEL) + '.' + 'a'.repeat(H.MAX_LABEL);
  assert.ok(H.check(longest).ok, 'the worst case is no longer a legal handle — this test needs rewriting');
  const r = H.minted(longest, 'sup', 9999);
  assert.ok(r.handle, 'the longest legal owner cannot mint at all: ' + r.error);
  assert.ok(r.handle.length <= H.MAX_TOTAL,
    'a minted name is ' + r.handle.length + ' chars and the column holds ' + H.MAX_TOTAL);
});

t('⚠⚠ running past the padding LENGTHENS the name, it never wraps or truncates', () => {
  /* ⚠ A reused ordinal attaches a new supplier to the old one's purchase history — the one outcome that must be
     impossible. Beyond the column, minting REFUSES rather than cutting the name down to fit. */
  const a = H.minted('tallytest', 'sup', 9999).handle;
  const b = H.minted('tallytest', 'sup', 10000).handle;
  assert.ok(b.length > a.length, 'the 10000th supplier did not get a longer name — an ordinal is being reused');
  const over = H.minted('a'.repeat(H.MAX_LABEL) + '.' + 'a'.repeat(H.MAX_LABEL), 'sup', 1e18);
  assert.ok(over.error && !over.handle, 'an over-long minted name was returned instead of refused');
});

t('⭐⭐⭐ a person can never REGISTER a name that reads like a minted party', () => {
  /**
   * Two halves. `~` is unforgeable because a label must start with a letter or number — that is what stops the
   * CODE confusing them. But `tallytest.sup-0001` was a perfectly legal store name sitting one tilde away from a
   * supplier somebody's purchase history hangs from, and that is what would confuse a PERSON reading a list.
   */
  assert.ok(!H.check('~tallytest.sup-0001').ok, 'a tilde handle can be registered — minted names are forgeable');
  assert.ok(!H.check('tallytest.sup-0001').ok, 'a store can be named like a minted supplier');
  assert.ok(!H.check('TALLYTEST.SUP-0001').ok, 'the shape rule missed upper case');
  /* ⚠ and it must not over-reach — these are ordinary names */
  assert.ok(H.check('tallytest.support').ok, 'a department called support was refused');
  assert.ok(H.check('athi.mens').ok);
  assert.ok(H.check('sup-0001').ok,
    'the ROOT was caught — check() also runs on handles that ALREADY EXIST (network-design reads your current',
    'User ID before building a network), so this would lock a business out of its own tree over a name we only',
    'started objecting to today');
});

t('⚠ isMinted reads the tilde, not the shape', () => {
  assert.strictEqual(H.isMinted('~tallytest.sup-0007'), true);
  assert.strictEqual(H.isMinted('tallytest.sup-0007'), false, 'a lookalike was treated as one of ours');
  assert.deepStrictEqual(H.mintedParts('~tallytest.sup-0007'), { owner: 'tallytest', kind: 'sup', n: 7 });
  assert.strictEqual(H.mintedParts('tallytest.sup-0007'), null);
});

console.log(`
  ${pass} passed, ${fail} failed
`);
process.exit(fail ? 1 : 0);
