'use strict';
/**
 * network-build.test.js — what Build would do, decided before anything exists.
 *
 * The load-bearing tests are the ones marked ★★: a partner is never created, and a partner's children are never
 * named. Those two are the whole answer to REVIEW-2026-08-06 §6, and if either regresses the `network` visibility
 * tier stops being safe.
 */
const assert = require('assert');
const NB = require('../lib/network-build');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const ROOT = { key: 'r', name: 'Athi', root: true, owned: true, parent_key: null, holds: [] };
const owned = (key, name, extra) => Object.assign({ key, name, parent_key: 'r', owned: true, holds: ['catalogue'] }, extra || {});
const run = (nodes, taken) => NB.plan({ rootHandle: 'athi', nodes: [ROOT, ...nodes], taken: taken || [] });

console.log('\nnetwork build · the plan');

t('★ an owned node becomes athi.<name>', () => {
  const p = run([owned('a', 'Clothing')]);
  assert.strictEqual(p.create.length, 1);
  assert.strictEqual(p.create[0].handle, 'athi.clothing');
  assert.strictEqual(p.create[0].name, 'Clothing');
});

t('★ the same convention at every level, parents first', () => {
  const p = run([owned('a', 'Clothing'), owned('b', 'Mens', { parent_key: 'a' })]);
  assert.deepStrictEqual(p.create.map((c) => c.handle), ['athi.clothing', 'athi.clothing.mens']);
  // Order is not cosmetic: the executor places each node under its parent, so the parent must exist first.
  assert.ok(p.create.findIndex((c) => c.key === 'a') < p.create.findIndex((c) => c.key === 'b'));
});

console.log('\nnetwork build · exposure');

t('★ a designed storefront carries its exposure; protected → network', () => {
  const p = run([
    owned('a', 'Clothing',  { holds: ['catalogue', 'storefront'], exposure: 'public' }),
    owned('b', 'Warehouse', { holds: ['catalogue', 'storefront'], exposure: 'protected' }),
  ]);
  assert.strictEqual(p.create.find((c) => c.key === 'a').visibility, 'public');
  assert.strictEqual(p.create.find((c) => c.key === 'b').visibility, 'network');
});

t('★★ no storefront designed → private, never public', () => {
  // A back-office node that quietly became a public shop is the one mistake here that cannot be taken back:
  // it publishes a catalogue nobody meant to publish.
  assert.strictEqual(run([owned('a', 'Back office')]).create[0].visibility, 'private');
  assert.strictEqual(NB.visibilityOf({ holds: ['storefront'], exposure: 'nonsense' }), 'private');
  assert.strictEqual(NB.visibilityOf({}), 'private');
});

console.log('\nnetwork build · partners are invited, not created');

t('★★ a partner is NEVER created', () => {
  const p = run([{ key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, partner_ref: 'ravi.timbers', holds: ['catalogue'] }]);
  assert.strictEqual(p.create.length, 0, 'a partner must not appear in create');
  assert.deepStrictEqual(p.invite, [{ key: 'p', name: 'Ravi Timbers', ref: 'ravi.timbers' }]);
});

t('★ a partner with no handle cannot be invited — and is told so', () => {
  const p = run([{ key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, holds: [] }]);
  assert.strictEqual(p.invite.length, 0);
  assert.ok(/add their handle/i.test(p.problems[0].reason));
});

t('★★ a partner\'s children are NOT named or created', () => {
  // Otherwise the operator could mint `athi.ravi-timbers.warehouse` — a store inside someone else's business,
  // sitting on the operator's own tree, and therefore readable at `network` visibility. That is the §6 attack.
  const p = run([
    { key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, partner_ref: 'ravi.timbers', holds: [] },
    owned('w', 'Warehouse', { parent_key: 'p' }),
  ]);
  assert.strictEqual(p.create.length, 0);
  assert.ok(p.problems.some((x) => /a partner's own structure is theirs/i.test(x.reason)));
});

console.log('\nnetwork build · refusals');

t('★ a name already taken by someone else is refused, not suffixed', () => {
  const p = run([owned('a', 'Clothing')], ['athi.clothing']);
  assert.strictEqual(p.create.length, 0);
  assert.ok(/already taken/.test(p.problems[0].reason));
});

t('★ two siblings that would collide are caught BEFORE anything is created', () => {
  const p = run([owned('a', 'Clothing'), owned('b', 'clothing')]);
  assert.strictEqual(p.create.length, 1, 'the first one is fine');
  assert.ok(/would both be called/.test(p.problems[0].reason));
});

t('an unusable name blocks that node and its children, nothing else', () => {
  const p = run([owned('a', '!!!'), owned('b', 'Mens', { parent_key: 'a' }), owned('c', 'Pharmacy')]);
  assert.deepStrictEqual(p.create.map((c) => c.handle), ['athi.pharmacy'], 'the good branch still builds');
  assert.strictEqual(p.problems.length, 2);
  assert.ok(/parent could not be built/.test(p.problems.find((x) => x.key === 'b').reason));
});

t('an unusable ROOT stops the plan and says which name is wrong', () => {
  const p = NB.plan({ rootHandle: 'cb12345678', nodes: [ROOT, owned('a', 'Clothing')] });
  assert.strictEqual(p.create.length, 0);
  assert.ok(/network name is not usable/.test(p.problems[0].reason));
});

console.log('\nnetwork build · running it twice');

t('★★ a built node is skipped, not created again', () => {
  const p = run([owned('a', 'Clothing', { built: { bridge_id: 'CBAAAAAAAA', user_id: 'athi.clothing' } })]);
  assert.strictEqual(p.create.length, 0);
  assert.strictEqual(p.skip.length, 1);
});

t('★ a new child under an ALREADY-BUILT parent still gets the right handle', () => {
  // The parent's handle has to come from what was actually built, not from re-deriving it — a node renamed after
  // its build would otherwise silently reparent its children under a handle that does not exist.
  const p = run([
    owned('a', 'Clothes now', { built: { bridge_id: 'CBAAAAAAAA', user_id: 'athi.clothing' } }),
    owned('b', 'Mens', { parent_key: 'a' }),
  ]);
  assert.strictEqual(p.create[0].handle, 'athi.clothing.mens');
});

t('an empty design is a valid plan that does nothing', () => {
  const p = run([]);
  assert.deepStrictEqual(p.counts, { create: 0, invite: 0, skip: 0, problems: 0 });
});

t('TIER A · depends on nothing but handle.js', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/network-build'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./handle']);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
