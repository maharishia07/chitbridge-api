'use strict';
/**
 * policy-defaults.test.js — WHAT AN ENTITY THAT NEVER OPENED SETTINGS ACTUALLY DOES.
 *
 * ⭐⭐ THE TEST THIS FILE EXISTS FOR IS THE FIRST ONE. `self_copy_pref` was declared `both` here and implemented
 * as `received` in routes/chits.js, for months. An entity that had never touched Settings was TOLD one thing and
 * BEHAVED as the other — and nothing caught it, because every spec set the value before asserting on it.
 *
 * ⚠️ A DEFAULT IS ONLY TESTED BY LEAVING IT ALONE. Any test that writes the setting first is testing the setter.
 * The unset path is the one almost every real entity is on, and it was the one path nobody exercised.
 *
 * ⚠️ AND THE FIX WAS NOT "MAKE THEM MATCH" — it was deciding WHICH IS RIGHT. The engine won because filing a
 * self-chit in Order asserts "I sent this to a counterparty", which is false. Written down here so that a future
 * change to either side has to argue with the reasoning, not just with a red test.
 *
 * ⚠️ THIS TEST MUST NOT BE WEAKENED TO A "THEY AGREE" ASSERTION. Two files agreeing on the wrong value passes
 * that test and reproduces the original bug exactly.
 *
 * Run:  node tests/policy-defaults.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const policy = require('../lib/policy');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const FLAGS = policy.FLAGS || policy.flags || null;

console.log('\npolicy · what an UNSET entity does');

t('★★ self_copy_pref defaults to `received`, the value the engine implements', () => {
  assert.ok(FLAGS, 'lib/policy.js should export its FLAGS table for this to be checkable at all');
  assert.strictEqual(FLAGS.self_copy_pref.def, 'received',
    'Settings would present a default the chit engine does not honour — the exact drift this file exists to catch');
});

/**
 * ⚠️ READS THE ENGINE'S SOURCE RATHER THAN CALLING IT. `routes/chits.js` needs a request, a session and a
 * database to run, none of which belong in a unit test — but the default is a literal in one line, and a literal
 * can be read. Crude on purpose: it fails loudly if that line is edited, which is precisely when someone needs
 * to be reminded that a second file states the same rule.
 */
t('★★ the engine still reads `received` as its fallback — the two have not drifted again', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  const m = /self_copy_pref\s*\|\|\s*'([a-z]+)'/.exec(src);
  assert.ok(m, "could not find the self_copy_pref fallback in routes/chits.js — if it moved, this test must be "
    + "pointed at the new place, NOT deleted");
  assert.strictEqual(m[1], FLAGS.self_copy_pref.def,
    `engine falls back to '${m[1]}' but Settings presents '${FLAGS.self_copy_pref.def}'`);
});

t('the declared options still contain the default', () => {
  assert.ok(FLAGS.self_copy_pref.options.indexOf(FLAGS.self_copy_pref.def) >= 0,
    'a default outside its own option list cannot be chosen back once changed');
});

console.log('\npolicy · every other flag is at least self-consistent');

t('every enum flag defaults to one of its own options', () => {
  Object.keys(FLAGS).forEach((k) => {
    const f = FLAGS[k];
    if (f.type !== 'enum') return;
    assert.ok(f.options.indexOf(f.def) >= 0, `${k}: default '${f.def}' is not in ${JSON.stringify(f.options)}`);
  });
});

t('every number flag defaults within its own min/max', () => {
  Object.keys(FLAGS).forEach((k) => {
    const f = FLAGS[k];
    if (f.type !== 'number') return;
    if (f.min !== undefined) assert.ok(f.def >= f.min, `${k}: default ${f.def} is below min ${f.min}`);
    if (f.max !== undefined) assert.ok(f.def <= f.max, `${k}: default ${f.def} is above max ${f.max}`);
  });
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
