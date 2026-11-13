'use strict';
/**
 * tests/scripts-target.test.cjs — PLT-101: NO api SCRIPT CAN REACH PRODUCTION BY FORGETTING A VARIABLE.
 *   1 no file in scripts/ names the live api host (the only home is run-target.cjs PRODUCTION_API);
 *   2 the shared apiBase(): unset → exit 2, production host → exit 3 without CB_ALLOW_PROD=1, production with it → allowed, local → allowed;
 *   3 three real scripts started with CB_API unset exit non-zero and say REFUSED before any request.
 * Offline: step 3 never reaches a network (the refusal is the first thing each script does); no database.
 * CARD      28-platform-and-operations/hosting-and-deploy
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const RT = require('./lib/run-target.cjs');
const SCRIPTS = path.join(__dirname, '..', 'scripts');
let passed = 0;
function check(what, run) { try { run(); passed++; console.log('  ok  ' + what); } catch (failure) { console.log('  FAIL ' + what + '\n      ' + failure.message); process.exitCode = 1; } }

const LIVE_HOST = /chitbridge-api-production|[a-z0-9-]+\.up\.railway\.app|\.railway\.internal/i;
const files = fs.readdirSync(SCRIPTS).filter((f) => /\.(js|cjs)$/.test(f));

check('no script in scripts/ names the production api host', () => {
  const bad = files.filter((f) => LIVE_HOST.test(fs.readFileSync(path.join(SCRIPTS, f), 'utf8')));
  assert.deepStrictEqual(bad, [], 'hard-coded production host in: ' + bad.join(', ') + ' — use require("../tests/lib/run-target.cjs").apiBase(name)');
});
const CONVERTED = [
  'scripts/_proof.js',
  'scripts/actor-harness.js',
  'scripts/akums-demo.js',
  'scripts/assimilate-standard.js',
  'scripts/cancel-request.js',
  'scripts/catalogue-persist.js',
  'scripts/conform-check.js',
  'scripts/container-model.js',
  'scripts/container-wiring.js',
  'scripts/dept-store-demo.js',
  'scripts/dispute-reads.js',
  'scripts/dispute-scope.js',
  'scripts/entity-vertical.js',
  'scripts/erp-connector.js',
  'scripts/erp-handoff.js',
  'scripts/gold-demo.js',
  'scripts/gov-cascade.js',
  'scripts/iot-assignee.js',
  'scripts/journey-document-store.js',
  'scripts/journey-supplier-hop.js',
  'scripts/lifecycle-iot.js',
  'scripts/matrix.js',
  'scripts/multi-source.js',
  'scripts/penetration.js',
  'scripts/prototype-form16-to-itr2.js',
  'scripts/prove-availability.js',
  'scripts/prove-b159-attachments.js',
  'scripts/prove-capture.js',
  'scripts/prove-commerce-standards.js',
  'scripts/prove-commerce.js',
  'scripts/prove-definer-guards.js',
  'scripts/prove-forms.js',
  'scripts/prove-idempotency.js',
  'scripts/prove-kyb.js',
  'scripts/prove-lanes.js',
  'scripts/prove-network-cap.js',
  'scripts/prove-network-search.js',
  'scripts/prove-one-roof.js',
  'scripts/prove-orderbind.js',
  'scripts/prove-private-shop.js',
  'scripts/prove-profile.js',
  'scripts/prove-readiness.js',
  'scripts/prove-reference.js',
  'scripts/prove-sectors.js',
  'scripts/prove-storefront.js',
  'scripts/prove-verify.js',
  'scripts/regional-scatter.js',
  'scripts/register-mint.js',
  'scripts/sealed-guard.js',
  'scripts/seed-2026-08-05.js',
  'scripts/seed-bulk-catalogue.js',
  'scripts/seed-test-entities.js',
  'scripts/self-copy-pref.js',
  'scripts/source-entity.js',
  'scripts/source-rules.js',
  'scripts/test-dev.js'
];   /* named so the trace row of each converted script has a test (KG1 tested-by) */
check('every converted script calls apiBase() and exists', () => {
  const bad = CONVERTED.filter((f) => !/apiBase\(/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  assert.deepStrictEqual(bad, [], 'no apiBase() in: ' + bad.join(', '));
});
const NETWORKED = /\bfetch\(|https?\.request|https?\.get\(|require\('(https?|node-fetch|axios|undici)'\)/;
check('every networked script takes its target from run-target (or _proof, which does)', () => {
  const bad = files.filter((f) => { const t = fs.readFileSync(path.join(SCRIPTS, f), 'utf8'); return NETWORKED.test(t) && !/run-target|require\('\.\/_proof'\)/.test(t) && f !== 'vendor-till.cjs'; });   /* vendor-till: 'fetch(' is service-worker text it writes out */
  assert.deepStrictEqual(bad, [], 'networked without apiBase(): ' + bad.join(', '));
});
check('a script loaded by a test (entry file outside scripts/) gets no target and is not refused', () => {
  const entry = path.join(require('os').tmpdir(), 'plt101-entry-' + process.pid + '.cjs');
  fs.writeFileSync(entry, 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(path.join(__dirname, 'lib', 'run-target.cjs')) + ').apiBase("x.js")))');
  const env = Object.assign({}, process.env); delete env.CB_API;
  const r = spawnSync(process.execPath, [entry], { env, encoding: 'utf8' });
  fs.unlinkSync(entry);
  assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(r.stdout, '""');
});
check('apiBase: unset is refused with code 2 (no default)', () => {
  const v = RT.resolveApi({}); assert.strictEqual(v.ok, false); assert.strictEqual(v.code, 2);
  assert.strictEqual(RT.resolveApi({ CB_API: '   ' }).code, 2);
  assert.strictEqual(RT.resolveApi({ CB_API: 'not a url' }).code, 2);
});
check('apiBase: the production host is refused (code 3) unless CB_ALLOW_PROD=1', () => {
  for (const h of [RT.PRODUCTION_API, RT.PRODUCTION_API + '/', 'https://other.up.railway.app']) {
    assert.strictEqual(RT.resolveApi({ CB_API: h }).code, 3, h);
    assert.strictEqual(RT.resolveApi({ CB_API: h, CB_ALLOW_PROD: 'true' }).code, 3, 'only the value 1 allows it');
  }
  assert.strictEqual(RT.resolveApi({ CB_API: RT.PRODUCTION_API, CB_ALLOW_PROD: '1' }).ok, true);
});
check('apiBase: encoded production host and userinfo are refused', () => {
  assert.strictEqual(RT.resolveApi({ CB_API: 'https://x.up.railway%2eapp' }).code, 3);
  assert.strictEqual(RT.resolveApi({ CB_API: 'http://a:b@127.0.0.1:9' }).code, 2);
});
check('apiBase: a local or SIT host is accepted, trailing slash trimmed', () => {
  assert.strictEqual(RT.resolveApi({ CB_API: 'http://127.0.0.1:9/' }).base, 'http://127.0.0.1:9');
  assert.strictEqual(RT.resolveApi({ CB_API: 'https://staging.144-24-145-121.sslip.io' }).ok, true);
});
for (const f of ['register-mint.js', 'regression.js', 'prove-lifecycle.js']) {
  check(f + ' with CB_API unset exits non-zero, REFUSED, before any request', () => {
    const env = Object.assign({}, process.env); delete env.CB_API; delete env.CB_ALLOW_PROD; delete env.API;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, f)], { env, encoding: 'utf8', timeout: 15000 });
    assert.notStrictEqual(r.status, 0, 'exit ' + r.status);
    assert.ok(/REFUSED/.test(r.stderr), r.stderr.slice(0, 200));
    assert.ok(!r.stdout.trim(), 'it printed before refusing: ' + r.stdout.slice(0, 120));
  });
}
console.log(passed + ' checks');
