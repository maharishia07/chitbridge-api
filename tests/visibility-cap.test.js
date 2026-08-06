'use strict';
/**
 * visibility-cap.test.js — a choice, bounded by a cap.
 *
 * The load-bearing tests are the two that could each cause an outage in opposite directions: an operator cap that
 * an entity can shrug off, and an ABSENT declaration that closes every shop on the platform.
 */
const assert = require('assert');
const V = require('../lib/visibility-cap');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const MENU = { free: { public_facing: false }, pro: { public_facing: true } };

console.log('\nvisibility-cap · the operator who provisioned it');

t('★ an operator cap of private CANNOT be undone from the entity\'s own profile', () => {
  // Athi: "say it is done from the networking side — the entity should be private, not public."
  const cap = V.capOf({ plan: 'pro', planMenu: MENU, paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  assert.strictEqual(cap.max, 'private');
  assert.strictEqual(cap.by, 'operator');
  const r = V.check('public', cap);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 403);
  assert.ok(/network operator/i.test(r.message), 'a refusal a person cannot attribute reads as a bug');
});
t('the operator cap beats a plan that WOULD allow public', () => {
  const cap = V.capOf({ plan: 'pro', planMenu: MENU, paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  assert.strictEqual(cap.max, 'private', 'the most specific statement wins');
});
t('an operator cap of PUBLIC is not a licence — the plan still applies', () => {
  const cap = V.capOf({ plan: 'free', planMenu: MENU, paramsOverride: { caps: { catalogue_visibility: 'public' } } });
  assert.strictEqual(cap.max, 'private');
  assert.strictEqual(cap.by, 'plan');
});

console.log('\nvisibility-cap · the plan');

t('a plan that forbids public refuses, and names the plan', () => {
  const cap = V.capOf({ plan: 'free', planMenu: MENU });
  assert.strictEqual(cap.max, 'private');
  assert.ok(/free plan/.test(cap.reason));
  assert.strictEqual(V.check('public', cap).status, 403);
});
t('a plan that allows public allows it', () => {
  const cap = V.capOf({ plan: 'pro', planMenu: MENU });
  assert.strictEqual(cap.max, 'public');
  assert.strictEqual(V.check('public', cap).ok, true);
});

console.log('\nvisibility-cap · what an ABSENT declaration must not do');

t('★★ an unknown plan does NOT close every shop on the platform', () => {
  // entitlements.planFor() default-denies an unknown plan — right for a quota, catastrophic here. Every live entity
  // carries plan 'free'; if the constitution's plan_menu has no `free` entry, a strict reading would close the
  // whole platform the moment this is wired, and it would arrive as a silent outage.
  const cap = V.capOf({ plan: 'free', planMenu: { pro: { public_facing: true } } });
  assert.strictEqual(cap.max, 'public', 'an absent declaration is not a denial');
  assert.strictEqual(V.check('public', cap).ok, true);
});
t('★ …but it SAYS it is not enforcing', () => {
  const cap = V.capOf({ plan: 'free', planMenu: { pro: {} } });
  assert.strictEqual(cap.enforced, false, 'an unenforced cap reporting itself as enforced is decoration');
  assert.ok(/not being enforced/.test(cap.reason));
});
t('no constitution at all → allowed, unenforced', () => {
  const cap = V.capOf({ plan: 'free' });
  assert.strictEqual(cap.max, 'public');
  assert.strictEqual(cap.enforced, false);
});
t('strict mode flips absence into a denial, for an installation that wants it', () => {
  const cap = V.capOf({ plan: 'free', planMenu: { pro: {} }, strict: true });
  assert.strictEqual(cap.max, 'private');
  assert.strictEqual(cap.enforced, true);
});
t('⚠ an operator cap is enforced even with NO constitution — it is not a plan question', () => {
  const cap = V.capOf({ paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  assert.strictEqual(cap.max, 'private');
  assert.strictEqual(cap.enforced, true);
});

console.log('\nvisibility-cap · the shape of the rule');

t('★ a cap bounds how OPEN you may be, never how closed', () => {
  const cap = V.capOf({ plan: 'free', planMenu: MENU });
  assert.strictEqual(V.check('private', cap).ok, true, 'going private must always be allowed');
});
t('garbage is refused as a bad request, not as a governance failure', () => {
  const r = V.check('sort-of-public', V.capOf({}));
  assert.strictEqual(r.status, 400);
});
t('effective() is the narrower of chosen and allowed', () => {
  const capped = V.capOf({ paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  assert.strictEqual(V.effective('public', capped), 'private', 'a stored public must still READ as private');
  assert.strictEqual(V.effective('public', V.capOf({})), 'public');
  assert.strictEqual(V.effective(null, V.capOf({})), 'private', 'absent means not published');
});
t('★ effective() protects a catalogue whose flag was set BEFORE the cap existed', () => {
  // The dangerous case: an entity published itself, and only later was capped. The stored value still says public.
  const cap = V.capOf({ paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  assert.strictEqual(V.effective('public', cap), 'private', 'the cap must win at READ time, not only at write time');
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/visibility-cap'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
