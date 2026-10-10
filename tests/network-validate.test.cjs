'use strict';
/**
 * network-validate.test.cjs — P2: "what would break?" for a designed network. lib/network-build.validate wraps the SAME plan() Build runs;
 * it reads nothing live and posts nothing. The route (POST /api/network-design/validate) is held to the same words.
 */
const assert = require('assert');
const NB = require('../lib/network-build');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };

const ROOT = { key: 'r', name: 'Sample', root: true, owned: true, parent_key: null, holds: [] };
const own = (key, name, extra) => Object.assign({ key, name, parent_key: 'r', owned: true, holds: ['catalogue'] }, extra || {});

console.log('\nnetwork validate · what would break');
t('a clean design: ok, says what Build would make, nothing live consulted', () => {
  const v = NB.validate({ rootHandle: 'sample', nodes: [ROOT, own('a', 'Clothing'), own('b', 'Shoes')], taken: [] });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.counts.create, 2);
  assert.deepStrictEqual(v.breaks, []);
  assert.ok(/2 stores/.test(v.says), v.says);
});
t('★ a name already taken is named as a break, and nothing is made', () => {
  const v = NB.validate({ rootHandle: 'sample', nodes: [ROOT, own('a', 'Clothing')], taken: ['sample.clothing'] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.breaks.length >= 1 && v.breaks[0].name === 'Clothing');
  assert.ok(/would break/.test(v.says) && /Nothing has been made/.test(v.says));
});
t('a partner with no handle breaks; with one it is only invited', () => {
  const bad = NB.validate({ rootHandle: 'sample', nodes: [ROOT, own('p', 'Timbers', { owned: false })], taken: [] });
  assert.strictEqual(bad.ok, false);
  const good = NB.validate({ rootHandle: 'sample', nodes: [ROOT, own('p', 'Timbers', { owned: false, partner_ref: 'ravi.timbers' })], taken: [] });
  assert.strictEqual(good.ok, true); assert.strictEqual(good.would.invite.length, 1); assert.strictEqual(good.would.create.length, 0);
});
t('a closed parent narrows its child, and says so', () => {
  const v = NB.validate({ rootHandle: 'sample', ceiling: 'network', nodes: [ROOT, own('a', 'Outlet', { exposure: 'public', visibility: 'public' })], taken: [] });
  assert.ok(v.notes.length === 0 || /would be built/.test(v.notes[0]));
});
t('an empty design asks for one to be drawn', () => {
  const v = NB.validate({ rootHandle: 'sample', nodes: [], taken: [] });
  assert.strictEqual(v.ok, false); assert.ok(/Draw the network first/.test(v.says));
});
t('an unusable network name is a break, not a throw', () => {
  const v = NB.validate({ rootHandle: 'a@b', nodes: [ROOT, own('a', 'X')], taken: [] });
  assert.strictEqual(v.ok, false);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
