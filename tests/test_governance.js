'use strict';
// Runnable spec: `node tests/test_governance.js`. Plain node assert — no jest needed.
// Mirrors the GV-01..GV-14 acceptance set. Exit code 0 = all green.

const assert = require('assert');
const { resolve, driftStatus, GovernanceError } = require('../governance/resolver');
const { mintEntity, reattest, freezeForChit } = require('../governance/mint');
const { planFor, checkCount, checkRate, checkCapability } = require('../governance/entitlements');

const PLAN_MENU = {
  free:       { max_entities: 5,    chits_per_day: 10,   max_networks: 1,    network_depth: 1,    public_facing: false, mode: 'b2b_only' },
  pro:        { max_entities: 50,   chits_per_day: 500,  max_networks: 10,   network_depth: 3,    public_facing: true,  mode: 'b2b_b2c' },
  enterprise: { max_entities: null, chits_per_day: null, max_networks: null, network_depth: null, public_facing: true,  mode: 'b2b_b2c' },
};
const V01 = {
  version: '0.1',
  defaults: { currency_code: 'INR', default_language: 'en', exposure_default: 'private', region: 'IN', default_timezone: 'Asia/Kolkata' },
  allowed:  { languages: ['en'], exposure_tiers: ['private', 'restricted', 'public'], regions_reference: ['IN', 'LK', 'AE'] },
  policy:   { override_rule: 'tighten_only' },
  plan_menu: PLAN_MENU,
};
const V02 = { ...V01, version: '0.2',
  defaults: { ...V01.defaults, currency_code: 'USD' },
  allowed:  { ...V01.allowed, languages: ['en', 'ta', 'hi'] } };

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n         ${e.message}`); fail++; }
}
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof GovernanceError && e.code === code);

console.log('GV — governance inheritance + entitlements');

t('GV-01 currency inheritance under v0.1 -> INR', () =>
  assert.strictEqual(resolve(V01, {}).effective.currency_code, 'INR'));
t('GV-02 currency inheritance under v0.2 -> USD', () =>
  assert.strictEqual(resolve(V02, {}).effective.currency_code, 'USD'));
t('GV-03 drift: minted 0.1 vs active 0.2 -> true; 0.2 vs 0.2 -> false', () => {
  assert.strictEqual(driftStatus('0.1', '0.2'), true);
  assert.strictEqual(driftStatus('0.2', '0.2'), false);
});
t('GV-04 chit freeze: a chit frozen under v0.1 stays INR after re-attest to v0.2', () => {
  const chit = freezeForChit(resolve(V01, {}).effective, '2026-06-19T12:00:00Z');
  reattest(V02, {}); // entity moves on
  assert.strictEqual(chit.currency_code, 'INR');
});
t('GV-05 language: "ta" refused under v0.1, accepted under v0.2', () => {
  assert.strictEqual(resolve(V01, {}).effective.allowed_languages.includes('ta'), false);
  assert.strictEqual(resolve(V02, {}).effective.allowed_languages.includes('ta'), true);
  throwsCode(() => resolve(V01, { allowed_languages: ['ta'] }), 'B_CAPABILITY');
});
t('GV-06 tighten-only: loosening exposure rejected; narrowing language allowed', () => {
  throwsCode(() => resolve(V01, { exposure_default: 'public' }), 'A_INVARIANT');
  assert.deepStrictEqual(resolve(V02, { allowed_languages: ['en'] }).effective.allowed_languages, ['en']);
});
t('GV-07 Class C: out-of-reference region allowed but flagged', () => {
  const r = resolve(V01, { region: 'US' });
  assert.strictEqual(r.effective.region, 'US');
  assert.strictEqual(r.exceptions.length, 1);
  assert.strictEqual(r.exceptions[0].klass, 'C_ADVISORY');
});
t('GV-08 re-attest clears drift', () => {
  const m = mintEntity(V01, 'root-1', {});
  const ra = reattest(V02, m.params_override);
  assert.strictEqual(ra.constitution_version, '0.2');
  assert.strictEqual(driftStatus(ra.constitution_version, V02.version), false);
});
t('GV-09 quota: 6th entity rejected on free (5/5), 5th allowed (4/5)', () => {
  const p = planFor(V01, 'free');
  assert.strictEqual(checkCount(p, 'max_entities', 4).ok, true);
  assert.strictEqual(checkCount(p, 'max_entities', 5).ok, false);
});
t('GV-10 rate: 11th chit/day rejected on free (10/10)', () => {
  const p = planFor(V01, 'free');
  assert.strictEqual(checkRate(p, 'chits_per_day', 9).ok, true);
  assert.strictEqual(checkRate(p, 'chits_per_day', 10).ok, false);
});
t('GV-11 capability: public_facing false on free, true on pro', () => {
  assert.strictEqual(checkCapability(planFor(V01, 'free'), 'public_facing').ok, false);
  assert.strictEqual(checkCapability(planFor(V01, 'pro'), 'public_facing').ok, true);
});
t('GV-12 network depth: depth 2 rejected on free, depth 3 allowed on pro', () => {
  assert.strictEqual(checkCount(planFor(V01, 'free'), 'network_depth', 1).ok, false); // wants depth 2
  assert.strictEqual(checkCount(planFor(V01, 'pro'), 'network_depth', 2).ok, true);   // wants depth 3
});
t('GV-13 default-deny: unknown plan grants nothing', () => {
  const p = planFor(V01, 'ghost');
  assert.strictEqual(p._unknown, true);
  assert.strictEqual(checkCount(p, 'max_entities', 0).ok, false);
});
t('GV-14 no-orphan invariant: no constitution -> hard reject', () =>
  throwsCode(() => resolve(null, {}), 'A_INVARIANT'));
t('GV-15 enterprise unlimited: 1000th entity still allowed', () =>
  assert.strictEqual(checkCount(planFor(V01, 'enterprise'), 'max_entities', 1000).ok, true));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
