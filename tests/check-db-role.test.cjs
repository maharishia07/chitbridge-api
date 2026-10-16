'use strict';
/**
 * check-db-role.test.cjs — scripts/check-db-role.js: does the API's database role bypass Row-Level Security? (INT7d-GREEN)
 *
 * The script is read-only and needs a database; offline we prove the two ways it must FAIL CLOSED, in words, and that its verdict is the ONE
 * shared with the boot check (lib/db-role): never a silent "all fine".
 *   · no DATABASE_URL → exit 2 and the sentence says which setting is missing (never a stack trace, never exit 0)
 *   · a database that cannot be reached → exit 1 and "check failed:" with the reason
 *   · the verdict it prints comes from lib/db-role.bypassesRls — a superuser or BYPASSRLS role is a bypass
 * Run: node tests/check-db-role.test.cjs · MIN refusal-path · fail-closed
 */
const assert = require('assert'), path = require('path'), { spawnSync } = require('child_process');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-db-role.js');
const dbRole = require('../lib/db-role');

let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };
/** run the script with exactly this environment (dotenv would add nothing: no .env is read for these two cases) */
const runScript = (env) => spawnSync(process.execPath, [SCRIPT], { env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8', timeout: 20000 });

(async () => {
  await it('no DATABASE_URL: exit 2 and the sentence names the missing setting', async () => {
    const run = runScript({});
    assert.strictEqual(run.status, 2);
    assert.ok(/DATABASE_URL is not set/.test(run.stderr), run.stderr);
  });
  await it('a database that cannot be reached: exit 1 with "check failed" — never exit 0', async () => {
    const run = runScript({ DATABASE_URL: 'postgres://nobody:none@127.0.0.1:9/none' });
    assert.strictEqual(run.status, 1);
    assert.ok(/check failed:/.test(run.stderr), run.stderr);
  });
  await it('the verdict is the shared one: a superuser or a BYPASSRLS role bypasses, a plain role does not', async () => {
    assert.strictEqual(dbRole.bypassesRls({ rolsuper: true, rolbypassrls: false }), true);
    assert.strictEqual(dbRole.bypassesRls({ rolsuper: false, rolbypassrls: true }), true);
    assert.strictEqual(dbRole.bypassesRls({ rolsuper: false, rolbypassrls: false }), false);
  });
  console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
})();
