'use strict';
/**
 * tests/run-target.test.cjs — THE ONE ALLOW-LIST BITES (tests/lib/run-target.cjs): production refused with no flag, an unknown host
 * refused in words, every listed SIT box accepted, the small member and the load generator refused, and the harness itself exits 3.
 * Offline: no api, no database. The SIT list is a temp copy of the docs repo's PM/SIT-SERVERS.json shape (the module never carries its own).
 * CARD 01-rail-core-the-chit/README
 */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const RT = require('./lib/run-target.cjs');
let passed = 0;
function check(what, run) { try { run(); passed++; console.log('  ok  ' + what); } catch (failure) { console.log('  FAIL ' + what + '\n      ' + failure.message); process.exitCode = 1; } }

const SERVERS = { servers: [
  { name: 'sit-root', role: 'master', api_base: 'https://staging.144-24-145-121.sslip.io' },
  { name: 'sit-in', role: 'member', api_base: 'https://staging.129-225-85-65.sslip.io' },
  { name: 'sit-au', role: 'member', api_base: 'https://staging.129-225-90-80.sslip.io' },
  { name: 'sit-grund', role: 'member', api_base: 'https://staging.140-245-252-156.sslip.io' },
  { name: 'sit-ae2', role: 'small-member', api_base: 'https://129-225-73-238.sslip.io' },
  { name: 'sit-load', role: 'load-generator', api_base: null }] };
const FILE = path.join(os.tmpdir(), 'run-target-servers-' + process.pid + '.json');
fs.writeFileSync(FILE, JSON.stringify(SERVERS));
const LOCAL_DB = 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
const BOX_DB = 'postgres://cb_app:secret@db:5432/chitbridge?sslmode=disable';
const PROD_API = 'https://chitbridge-api-production.up.railway.app';
const PROD_DB = 'postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres';
const onBox = (box, extra) => Object.assign({ CB_SIT_BOX: box, CB_SIT_SERVERS_FILE: FILE, NODE_ENV: 'staging' }, extra || {});

check('local api and the local container are accepted', () => { assert.strictEqual(RT.judge('http://127.0.0.1:3100', LOCAL_DB, {}).kind, 'local'); });
check('the production api is refused, with no flag, even with the local db', () => {
  const v = RT.judge(PROD_API, LOCAL_DB, {}); assert.strictEqual(v.ok, false); assert.ok(/production/.test(v.why), v.why);
});
check('a production api is refused even when a SIT box is named (the box name is no flag)', () => {
  for (const box of ['sit-in', 'sit-grund']) { const v = RT.judge(PROD_API, BOX_DB, onBox(box)); assert.strictEqual(v.ok, false); assert.ok(/production/.test(v.why), v.why); }
});
check('a Supabase database is refused as the database, and any railway.app host as the api', () => {
  assert.ok(/production/.test(RT.judge('http://127.0.0.1:3100', PROD_DB, {}).why));
  assert.ok(/production/.test(RT.judge('http://127.0.0.1:3100', PROD_DB, onBox('sit-in')).why));
  assert.ok(/production/.test(RT.judge('https://other-service.up.railway.app', LOCAL_DB, {}).why));
  assert.ok(/production/.test(RT.judge('http://localhost:3000', 'postgres://u:p@aws-0-ap.pooler.supabase.com:6543/postgres', onBox('sit-in')).why));
});
check('an unknown host is refused in words that name what to do', () => {
  const v = RT.judge('https://api.example.com', 'postgres://u:p@db.example.com:5432/x', {});
  assert.strictEqual(v.ok, false); assert.ok(/no SIT box is named/.test(v.why) && /CB_SIT_BOX/.test(v.why), v.why);
});
check('a name that is not in the list is refused and the list is named', () => {
  const v = RT.judge('http://localhost:3000', BOX_DB, onBox('sit-nowhere')); assert.strictEqual(v.ok, false); assert.ok(/not a SIT box/.test(v.why) && /sit-grund/.test(v.why), v.why);
});
check('every listed SIT box is accepted on its own api and its own db (sit-in, sit-au, sit-grund, sit-root)', () => {
  for (const box of ['sit-in', 'sit-au', 'sit-grund', 'sit-root']) { const v = RT.judge('http://localhost:3000', BOX_DB, onBox(box)); assert.deepStrictEqual([v.ok, v.kind, v.box], [true, 'sit', box], v.why); }
});
check("a box's own api_base is accepted, another box's is refused", () => {
  assert.strictEqual(RT.judge('https://staging.140-245-252-156.sslip.io', BOX_DB, onBox('sit-grund')).ok, true);
  assert.strictEqual(RT.judge('https://staging.129-225-85-65.sslip.io', BOX_DB, onBox('sit-grund')).ok, false);
});
check('the small member and the load generator are not run targets', () => {
  for (const box of ['sit-ae2', 'sit-load']) assert.strictEqual(RT.judge('http://localhost:3000', BOX_DB, onBox(box)).ok, false);
});
check('a box with a database that is not its own compose db, or a development NODE_ENV, is refused', () => {
  assert.strictEqual(RT.judge('http://localhost:3000', 'postgres://u:p@10.0.0.9:5432/chitbridge', onBox('sit-in')).ok, false);
  assert.ok(/NODE_ENV/.test(RT.judge('http://localhost:3000', BOX_DB, onBox('sit-in', { NODE_ENV: 'development' })).why));
});
check('sign-in: local = the fixed dev codes; a SIT box = today\'s tester code from the container template, e-mails on the tester domain', () => {
  const l = RT.signIn({ kind: 'local' }, {}); assert.deepStrictEqual([l.entityOtp, l.customerOtp, l.emailDomain], ['123456', '123123', 'local.test']);
  const s = RT.signIn({ kind: 'sit' }, { TESTER_CODE: 'abc-{yymmdd}-xyz', TESTER_CODE_TZ: 'UTC' });
  assert.ok(/^abc-\d{6}-xyz$/.test(s.entityOtp) && s.customerOtp === s.entityOtp && s.emailDomain === 'test.chitbridge', JSON.stringify(s));
});
check('the harness exits 3 on the production api and on an unknown host (REFUSED on stderr), and loads on local', () => {
  const run = (env) => spawnSync(process.execPath, ['-e', "require('./tests/lib/truth-harness.cjs')"], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { CB_SIT_BOX: '' }, env), encoding: 'utf8' });
  for (const api of [PROD_API, 'https://api.example.com']) { const r = run({ API_BASE: api }); assert.strictEqual(r.status, 3, r.stderr); assert.ok(/REFUSED/.test(r.stderr), r.stderr); }
  assert.strictEqual(run({ API_BASE: 'http://127.0.0.1:3100' }).status, 0);
  const prodDb = run({ API_BASE: 'http://127.0.0.1:3100', TRUTH_DB: PROD_DB }); assert.strictEqual(prodDb.status, 3); assert.ok(/production/.test(prodDb.stderr), prodDb.stderr);
});
fs.rmSync(FILE, { force: true });
console.log('\n  ' + passed + ' passed, ' + passed + ' checks');
