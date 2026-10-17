'use strict';
/**
 * tests/seed-local-refusals.test.cjs - THE LOCAL SEED NEVER REACHES ANYTHING BUT THIS MACHINE (scripts/seed-local.cjs).
 *   . an api that is not on this machine -> refused, exit 3, before one request is made
 *   . a DATABASE_URL that is not the local test database -> refused, exit 3
 * No server, no database, no browser: the seed stops before it asks anything.
 * Run: node tests/seed-local-refusals.test.cjs
 */
const assert = require('assert'), path = require('path'), { spawnSync } = require('child_process');
const SEED = path.join(__dirname, '..', 'scripts', 'seed-local.cjs');
let passed = 0;
function check(what, run) { try { run(); passed++; console.log('  ok  ' + what); } catch (failure) { console.log('  FAIL ' + what + '\n      ' + failure.message); process.exitCode = 1; } }
const seedWith = (environment, flags) => spawnSync(process.execPath, [SEED].concat(flags || []), { env: Object.assign({}, process.env, environment), encoding: 'utf8' });

check('an api on another machine is refused', () => {
  const run = seedWith({ API_BASE: 'https://api.example.com' });
  assert.strictEqual(run.status, 3);
  assert.ok(/REFUSED/.test(run.stderr), run.stderr);
});
check('a hosted database url is refused, with or without --demo-month', () => {
  for (const flags of [[], ['--demo-month']]) {
    const run = seedWith({ API_BASE: 'http://127.0.0.1:1', DATABASE_URL: 'postgres://user:secret@db.example.com:5432/postgres' }, flags);
    assert.strictEqual(run.status, 3);
    assert.ok(/local test database/.test(run.stderr), run.stderr);
  }
});
console.log('\n  ' + passed + ' passed, 2 checks');
