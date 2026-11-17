#!/usr/bin/env node
/**
 * ctr-212-recheck-setting.test.cjs — CTR-212 S0: "Check prices again before every bill" is ASKED, never assumed.
 * @type regression
 * OWNS      the proof that policy_flags.recheck_prices (1) is in the one FLAGS whitelist and the one CARD, as an entity setting with its words, (2) reads through askedOf as
 *           { asked:false, value:null } when nobody answered, and an unset or junk value never serialises as 'off', (3) once answered reads 'on' / 'off' with asked:true,
 *           (4) leaves flagOf alone (it still answers the flag's def 'off' for every invoice path: the tri-state is a SEPARATE read), (5) reaches the till snapshot as
 *           policy.recheck_prices ('on' | 'off' | null) with policy.park_max_hours = 12 (one platform constant, no copy in the till), (6) reaches GET /entities/policy as
 *           asked.recheck_prices (false until answered), and (7) has its FIELDS.md rows (no ad-hoc key).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      policy.FLAGS / askedOf / askedMapOf → the snapshot's policy block (routes/till.js policyBlock) → docs/FIELDS.md
 *   node tests/ctr-212-recheck-setting.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const policy = require(path.join(HERE, 'lib', 'policy'));

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

console.log('\n== CTR-212 S0 · the recheck setting is asked, not assumed ==\n');

ok('recheck_prices is in FLAGS (enum off|on) and its card row is an entity setting with labels, a help line and the asked marker', () => {
  assert.deepStrictEqual(policy.FLAGS.recheck_prices.options, ['off', 'on']);
  const ui = policy.FLAGS.recheck_prices.ui;
  assert.strictEqual(ui.level, 'entity'); assert.strictEqual(ui.gov, 'entity'); assert.strictEqual(ui.asked, true);
  assert.ok(ui.labels.on && ui.labels.off && ui.help && ui.label);
});
ok('nobody answered: askedOf says asked:false with value null, never "off" (no stored key, an empty set, a junk value, null)', () => {
  for (const stored of [undefined, null, {}, { recheck_prices: 'maybe' }, { recheck_prices: '' }, { recheck_prices: null }, { other: 'on' }]) {
    assert.deepStrictEqual(policy.askedOf(stored, 'recheck_prices'), { asked: false, value: null }, JSON.stringify(stored));
  }
});
ok('answered: askedOf reads on and off with asked:true (off is an ANSWER, not the absence of one)', () => {
  assert.deepStrictEqual(policy.askedOf({ recheck_prices: 'on' }, 'recheck_prices'), { asked: true, value: 'on' });
  assert.deepStrictEqual(policy.askedOf({ recheck_prices: 'off' }, 'recheck_prices'), { asked: true, value: 'off' });
});
ok('flagOf is untouched: every invoice path still reads def "off" for an unset flag (the tri-state is a separate read)', () => {
  assert.strictEqual(policy.flagOf({}, 'recheck_prices', 'IN'), 'off'); assert.strictEqual(policy.flagOf({ recheck_prices: 'on' }, 'recheck_prices', 'IN'), 'on');
});
ok('askedMapOf names only the flags that ask to be answered, false until they are', () => {
  assert.deepStrictEqual(policy.askedMapOf({}), { recheck_prices: false });
  assert.deepStrictEqual(policy.askedMapOf({ recheck_prices: 'off' }), { recheck_prices: true });
});
ok('PARK_MAX_HOURS is the one platform constant, 12 (Athi D1)', () => { assert.strictEqual(policy.PARK_MAX_HOURS, 12); });
ok('a stand-alone copy of the timer is not written into the till or the till route: the snapshot policy block is the only carrier', () => {
  const route = fs.readFileSync(path.join(HERE, 'routes', 'till.js'), 'utf8');
  assert.match(route, /park_max_hours: policy\.PARK_MAX_HOURS/); assert.match(route, /recheck_prices: policy\.askedOf\(row\.policy_flags, 'recheck_prices'\)\.value/);
  assert.ok(!/recheck_prices: flags\.recheck_prices/.test(route), 'policyBlock must not read the flag with a default');
});
ok('docs/FIELDS.md carries the setting row and the PARK_MAX_HOURS row (a new key needs its dictionary entry)', () => {
  const fields = fs.readFileSync(path.join(HERE, 'docs', 'FIELDS.md'), 'utf8');
  assert.match(fields, /\| `policy_flags\.recheck_prices` \|/); assert.match(fields, /\| `policy\.park_max_hours` \(snapshot\) \|/);
});

(async () => {
  /* the snapshot and GET /entities/policy through the real routes would need the whole stand-in world; the two seams they read are the ones above, and the web-api / entities sweeps prove the shapes */
  const src = fs.readFileSync(path.join(HERE, 'routes', 'entities.js'), 'utf8');
  ok('GET /entities/policy sends asked (policy.read → askedMapOf) so Settings can say "Not answered yet"', () => { assert.match(src, /const \{ flags, country, asked \} = await policy\.read/); assert.match(src, /asked: asked \|\| \{\}/); });
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
