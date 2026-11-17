'use strict';
// Regression — the COLD-START RACE (fixed 2026-07-29).
//
// Railway sleeps the container when idle. On wake, the HTTP server listened immediately while createPool() was still
// resolving, so the app's first burst (/entities/me, /notifications, /network-design) failed with
// "Database not connected" — visible in the deploy log as three failures at 23:20:36 followed by "DB connected" in
// the SAME second. A request that arrives before the pool is up must now WAIT for it, bounded.
//
// Provable with NO database: point DATABASE_URL at an unroutable host and check the SHAPE of the failure —
//   • it must not fail instantly (that would mean it never waited)
//   • it must fail by the bound (that would mean it hangs a request forever on a dead DB)
//   • the error must be the SAME canonical message as before (no behaviour regression when the DB is genuinely down)
// Each case needs a fresh module load, so each runs in its own child process.
// Run:  node tests/db-coldstart.test.js
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

// child: load db/index.js, immediately issue a query (the cold-start moment), report elapsed + message as JSON.
const CHILD = `
  const t0 = Date.now();
  const db = require(${JSON.stringify(path.join(__dirname, '..', 'db', 'index.js').replace(/\\/g, '/'))});
  db.query('SELECT 1')
    .then(() => { console.log(JSON.stringify({ ok: true, ms: Date.now() - t0 })); process.exit(0); })
    .catch((e) => { console.log(JSON.stringify({ ok: false, ms: Date.now() - t0, msg: e.message })); process.exit(0); });
`;
function run(env) {
  const r = spawnSync(process.execPath, ['-e', CHILD], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test', RLS_GUARD: 'off', ...env },
  });
  const line = (r.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error('child produced no result. stdout=' + JSON.stringify((r.stdout || '').slice(-400)) + ' stderr=' + JSON.stringify((r.stderr || '').slice(-400)));
  return JSON.parse(line);
}

const UNROUTABLE = 'postgres://u:p@10.255.255.1:5432/db';   // valid DSN, black-holes on connect
const WAIT = 1200;

t('a query at cold start WAITS for the pool instead of failing instantly', () => {
  const r = run({ DATABASE_URL: UNROUTABLE, DB_BOOT_WAIT_MS: String(WAIT) });
  assert.strictEqual(r.ok, false, 'unroutable DB should still fail');
  assert.ok(r.ms >= WAIT * 0.6, `expected to wait ~${WAIT}ms, failed after only ${r.ms}ms — it did not wait`);
});

t('the wait is BOUNDED — a dead database never hangs a request forever', () => {
  const r = run({ DATABASE_URL: UNROUTABLE, DB_BOOT_WAIT_MS: String(WAIT) });
  assert.ok(r.ms < WAIT + 8000, `expected failure near the ${WAIT}ms bound, took ${r.ms}ms`);
});

t('when the DB really is down the error is UNCHANGED (no behaviour regression)', () => {
  const r = run({ DATABASE_URL: UNROUTABLE, DB_BOOT_WAIT_MS: String(WAIT) });
  assert.match(r.msg || '', /^Database not connected — check DATABASE_URL/);
});

t('a malformed DATABASE_URL still fails with the same canonical message', () => {
  const r = run({ DATABASE_URL: 'not-a-url', DB_BOOT_WAIT_MS: String(WAIT) });
  assert.strictEqual(r.ok, false);
  assert.match(r.msg || '', /^Database not connected — check DATABASE_URL/);
});

t('module load does not crash on a bad DATABASE_URL (no unhandled rejection)', () => {
  const r = spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(path.join(__dirname, '..', 'db', 'index.js').replace(/\\/g, '/'))}); setTimeout(() => { console.log('ALIVE'); process.exit(0); }, 800);`],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'not-a-url' } });
  assert.match(r.stdout || '', /ALIVE/, 'requiring db/index.js with a bad URL must not kill the process');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
