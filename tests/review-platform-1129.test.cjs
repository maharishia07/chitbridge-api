'use strict';
/**
 * review-platform-1129.test.cjs — the platform goldfish/elephant review findings that were REAL at head (walks/reviews/VERIFY-platform-2026-11-21.md).
 * Each case fails on the parent commit. No database, no network.   Run: node tests/review-platform-1129.test.cjs
 */
const assert = require('assert'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, queue = Promise.resolve();
const it = (what, fn) => { queue = queue.then(async () => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }); };

it('GF-03 M1: an array ticket (?ticket[]=X) is spent, not replayable', () => {
  const ev = require('../lib/events');
  const { ticket } = ev.ticketFor('E1');
  assert.ok(ev.spendFor([ticket]), 'first spend');
  assert.strictEqual(ev.spendFor([ticket]), null, 'second spend of the same ticket must be refused');
});

it('EL-01 F4: an exposure value the tier list does not hold breaches tighten-only', () => {
  const { resolve } = require('../governance/resolver');
  const c = { version: 1, defaults: { exposure_default: 'network' }, allowed: { exposure_tiers: ['private', 'network', 'public'] } };
  assert.throws(() => resolve(c, { exposure_default: 'wide-open' }), /tighten_only/);
  assert.doesNotThrow(() => resolve(c, { exposure_default: 'private' }));
});

it('GF-04 M20: a %00 in the path is refused by the door', () => {
  const { refuseNul } = require('../lib/input-hygiene');
  let status = null, nexted = false;
  const res = { status(s) { status = s; return res; }, set() { return res; }, type() { return res; }, json() { return res; }, send() { return res; }, end() { return res; }, setHeader() {}, getHeader() {} };
  refuseNul({ path: '/api/identity/documents/PHONE%00x', query: {}, body: {}, headers: {}, method: 'GET', originalUrl: '/x' }, res, () => { nexted = true; });
  assert.strictEqual(nexted, false, 'must not pass on');
});

it('GF-03 M3/M4: the identity-document code is counted before it is compared, and stored keyed', async () => {
  process.env.VAULT_ENC_KEY = 'ab'.repeat(32);
  for (const m of ['../lib/vaultcrypto', '../lib/iddoc-verify']) delete require.cache[require.resolve(m)];
  const iv = require('../lib/iddoc-verify');
  let saved = null;
  await iv.start({ doc: { identity_id: 'I1', scheme: 'EMAIL', value: 'a@b.test' }, store: { save: async (r) => { saved = r; } }, send: async () => ({ delivered: true }) });
  assert.ok(/^otp:[0-9a-f]{64}:\d+:0$/.test(saved));
  const row = { identity_id: 'I1', scheme: 'EMAIL', verification_ref: saved };
  /* a store whose claim() lets exactly one of N parallel attempts win, like the UPDATE ... WHERE verification_ref = $was */
  let ref = saved, compared = 0;
  const store = { claim: async (was, next) => { if (ref !== was) return false; ref = next; compared++; return true; }, save: async (r) => { ref = r; }, verified: async () => 'now' };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => iv.confirm({ doc: row, code: String(100000 + i), store })));
  assert.strictEqual(results.filter((r) => r.status === 400).length, 1, 'only the attempt that won the count may be compared');
  assert.strictEqual(results.filter((r) => r.status === 429).length, 19);
});

it('EL-01 F9: the test-DB guard also refuses a remote DB_POOLER_URL beside a local DATABASE_URL', () => {
  const run = (env) => cp.spawnSync(process.execPath, ['-e', "require('./jest.setup.js')"], { cwd: ROOT, env: Object.assign({}, process.env, { CB_ALLOW_REMOTE_TEST_DB: '' }, env) });
  const remote = run({ DATABASE_URL: 'postgres://u:p@localhost:5432/cb_test', DB_POOLER_URL: 'postgres://u:p@aws-0.pooler.example.com:6543/postgres' });
  assert.notStrictEqual(remote.status, 0, 'must refuse');
  const local = run({ DATABASE_URL: 'postgres://u:p@localhost:5432/cb_test', DB_POOLER_URL: 'postgres://u:p@localhost:5432/cb_test' });
  assert.strictEqual(local.status, 0, 'local pair passes: ' + String(local.stderr).slice(0, 200));
});

it('GF-03 M11: signForm refuses when the row was signed between the read and the write', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib/forms.js'), 'utf8');
  assert.ok(/SET signatory = \$3::jsonb, signed_at = now\(\) WHERE entity_id = \$1 AND form_id = \$2 AND signed_at IS NULL/.test(src), 'the UPDATE must carry AND signed_at IS NULL');
});

it('EL-01 F7: readBatch opens READ ONLY for a read-only request and carries UTC and the statement deadline', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'db/index.js'), 'utf8');
  const body = src.slice(src.indexOf('const readBatch = async'), src.indexOf('queryAs(identityId'));
  assert.ok(/isReadOnly\(\) \? 'BEGIN READ ONLY; '/.test(body), 'READ ONLY follows reqctx.isReadOnly()');
  assert.ok(/set_config\('TimeZone', 'UTC', true\)/.test(body) && /set_config\('statement_timeout'/.test(body), 'UTC and the deadline are set in the transaction');
});

queue.then(() => console.log(pass + ' passed' + (process.exitCode ? ', some FAILED' : '')));
