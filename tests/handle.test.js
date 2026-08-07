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
t('★ the SAME convention at every level', () => {
  assert.strictEqual(H.child('athi.clothing', 'Mens').handle, 'athi.clothing.mens');
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
t('depth is bounded', () => {
  assert.strictEqual(H.check('a.b.c.d.e').ok, true);
  assert.strictEqual(H.check('a.b.c.d.e.f').ok, false);
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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
