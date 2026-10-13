/**
 * spin-scripts.test.cjs — ⭐⭐ THE CLOUD SPIN SCRIPTS STAY HONEST WITHOUT AN ACCOUNT (HX2). Offline: no cloud, no database, no docker.
 *
 * Fails when:
 *   1. a platform (aws · azure · gcp · railway) lacks spin.sh / test.sh / teardown.sh / README.md;
 *   2. the api environment a spin sets (deploy/spin-lib.sh spin_api_env — the ONE list) names a variable docs/HOSTING.md does not;
 *   3. a spin's plan (PLAN=1) fails, prints a secret, leaves the India region by default (Railway has none: it says so), or creates
 *      a resource without the spin's tag; a teardown's plan does not find what it deletes by that tag;
 *   4. the cloud mail sink answers without its token;
 *   5. shellcheck (when installed) finds anything in deploy/*.sh.
 * The CLIs' own check of every command (PARSE=1, no credentials) is slower and needs aws/az/gcloud: `bash deploy/spin-check.sh`.
 * Run: node tests/spin-scripts.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const bash = (args, env) => spawnSync('bash', args, { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { CB_SPIN_ID: '', GCP_PROJECT: '' }, env), timeout: 60000 });

console.log('\n══ spin scripts: one env list, tagged, India by default, no secret printed ══\n');
const PLATFORMS = { aws: 'ap-south-1', azure: 'centralindia', gcp: 'asia-south1', railway: null };

/* 1 · the files */
for (const p of Object.keys(PLATFORMS)) for (const f of ['spin.sh', 'test.sh', 'teardown.sh', 'README.md'])
  ok(p + '/' + f + ' exists', fs.existsSync(path.join(ROOT, 'deploy', p, f)));

/* 2 · the env list is the contract's */
const hosting = read('docs/HOSTING.md');
const envOut = bash(['-c', '. deploy/spin-lib.sh; CB_SPIN_ID=s123456; DATABASE_URL=x; JWT_SECRET=x; MAIL_TOKEN=x; MAIL_URL=x; WEB_URL=x; API_URL=x; CTP_PRIVATE_KEY=x; SPIN_COMMIT=x; spin_api_env; S3_ENDPOINT=x S3_BUCKET=x S3_REGION=x S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x spin_api_env']);
const names = [...new Set(envOut.stdout.split('\n').filter(Boolean).map((l) => l.split('=')[0]))];
ok('spin_api_env prints NAME=VALUE lines (' + names.length + ' names)', envOut.status === 0 && names.length >= 15, envOut.stderr);
const missing = names.filter((n) => !hosting.includes('`' + n + '`'));
ok('every variable a spin sets is in docs/HOSTING.md', missing.length === 0, missing.join(', '));
ok('a spin runs sealed: NODE_ENV=production, OTP by e-mail, no DEV_OTP', /^NODE_ENV=production$/m.test(envOut.stdout) && /^OTP_EMAIL_ENABLED=true$/m.test(envOut.stdout) && !/DEV_OTP/.test(envOut.stdout));
const platformEnvs = Object.keys(PLATFORMS).map((p) => read('deploy/' + p + '/spin.sh')).join('\n');
ok('no platform script sets an api variable of its own beyond the web\'s origin update (one list: spin_api_env)',
  !/(JWT_SECRET|DATABASE_URL|RESEND_API_KEY)=\$/.test(platformEnvs.replace(/^(OWNER_URL|DATABASE_URL)=.*$/gm, '')));

/* 3 · the plans */
const SECRETISH = /\b[0-9a-f]{48,}\b|re_spin[0-9a-f]{8,}|BEGIN PRIVATE KEY/;
const TAGGED = { aws: /create-(repository|security-group|db-instance|user|role|service)\b/, azure: /\b(group create|acr create|flexible-server create|containerapp (env )?create)\b/,
  gcp: /\b(repositories create|sql instances create|run deploy)\b/ };
for (const [p, region] of Object.entries(PLATFORMS)) {
  const s = bash(['deploy/' + p + '/spin.sh'], { PLAN: '1' });
  const out = s.stdout + s.stderr;
  ok(p + ': PLAN=1 spin.sh runs to the end', s.status === 0 && /· up: web/.test(out), out.slice(-400));
  ok(p + ': the plan prints no secret', !SECRETISH.test(out), (SECRETISH.exec(out) || [''])[0].slice(0, 20) + '…');
  if (region) ok(p + ': India by default (' + region + ')', out.includes(region));
  else ok(p + ': says it has no India region', /no India region/.test(read('deploy/railway/spin.sh')) && /no India region/i.test(read('deploy/railway/README.md')));
  if (TAGGED[p]) {
    const untagged = out.split('\n').filter((l) => /^\s+\$ /.test(l) && TAGGED[p].test(l) && !/cb-spin/.test(l));
    ok(p + ': every resource it creates carries cb-spin=<id>', untagged.length === 0, untagged.join('\n          ').slice(0, 400));
  } else ok(p + ': the project is named cbspin-<id> (its tag)', /railway init --name cbspin-/.test(out));
  const t = bash(['deploy/' + p + '/teardown.sh'], { PLAN: '1' }), tout = t.stdout + t.stderr;
  ok(p + ': PLAN=1 teardown.sh runs, finds by the tag, prints the cost', t.status === 0 && /cb-spin|cbspin-splan00/.test(tout) && /· cost: /.test(tout), tout.slice(-300));
  const x = bash(['deploy/' + p + '/test.sh'], { PLAN: '1' }), xout = x.stdout + x.stderr;
  ok(p + ': PLAN=1 test.sh = migrate · sim-load (spin rule) · health · CTP · the stack walk', x.status === 0 && /tools\/migrate\.cjs/.test(xout) && /CB_SPIN_ID=\S+ node \S+sim-load\.cjs/.test(xout) && /proof-health/.test(xout) && /proof-ctp/.test(xout) && /stack-walk\.cjs/.test(xout), xout.slice(-300));
}
const tds = Object.keys(PLATFORMS).map((p) => read('deploy/' + p + '/teardown.sh'));
ok('aws teardown lists by tag (Resource Groups Tagging API) and checks IAM tags', /resourcegroupstaggingapi get-resources/.test(tds[0]) && /list-\$1-tags/.test(tds[0]));
ok('azure teardown deletes the group only when its tag names the spin', /tags\."cb-spin"/.test(tds[1]) && /left alone/.test(tds[1]));
ok('gcp teardown lists by label', /labels\.cb-spin=/.test(tds[2]) && /userLabels\.cb-spin=/.test(tds[2]));
ok('railway teardown deletes only a project named cbspin-<id>', /= "cbspin-\$CB_SPIN_ID"/.test(tds[3]));

/* 4 · the sink's token */
(async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const sink = spawn(process.execPath, [path.join(ROOT, 'deploy', 'mail-sink.cjs')], { env: Object.assign({}, process.env, { PORT: String(port), MAIL_SINK_TOKEN: 're_spintest' }), stdio: 'ignore' });
  const ask = (opts, body) => new Promise((res) => {
    const q = http.request(Object.assign({ host: '127.0.0.1', port }, opts), (r) => { r.resume(); r.on('end', () => res(r.statusCode)); });
    q.on('error', () => res(0)); if (body) q.write(body); q.end();
  });
  let up = 0; for (let i = 0; i < 40 && !up; i++) { up = await ask({ path: '/last' }); if (!up) await new Promise((r) => setTimeout(r, 100)); }
  const mail = JSON.stringify({ to: 'a@b.example', subject: 's', html: 'code 123456' });
  ok('sink: no token → 401 (read and write)', await ask({ path: '/last?to=a@b.example' }) === 401 && await ask({ method: 'POST', path: '/emails' }, mail) === 401);
  ok('sink: a wrong token → 401', await ask({ path: '/last?to=a@b.example', headers: { authorization: 'Bearer re_wrong_____' } }) === 401);
  const auth = { authorization: 'Bearer re_spintest' };
  ok('sink: with the token the api can send and the walk can read', await ask({ method: 'POST', path: '/emails', headers: auth }, mail) === 200 && await ask({ path: '/last?to=a@b.example', headers: auth }) === 200);
  sink.kill();

  /* 5 · shellcheck */
  const sc = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  if (sc.status !== 0) console.log('   skip shellcheck (not installed here — deploy/spin-check.sh runs it)');
  else {
    const files = ['deploy/spin-lib.sh', 'deploy/spin-test.sh', 'deploy/spin-check.sh', 'deploy/proof.sh'].concat(...Object.keys(PLATFORMS).map((p) => ['spin', 'test', 'teardown'].map((f) => 'deploy/' + p + '/' + f + '.sh')));
    const r = spawnSync('shellcheck', ['-s', 'bash'].concat(files), { cwd: ROOT, encoding: 'utf8' });
    ok('shellcheck: deploy scripts clean', r.status === 0, (r.stdout || '').slice(0, 600));
  }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
