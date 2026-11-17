'use strict';
// @type: unit
/* The --remote-ok host check: the pure decision (guard.cjs remoteHostDecision) and the real refusal (lib.cjs exits 2 before any browser or sign-in).
   Red when either check is removed. Run: node e2e/proof/remote-host.test.cjs */
const assert = require('assert'), path = require('path'), { spawnSync } = require('child_process');
const { remoteHostDecision: d } = require('./guard.cjs');
const OK = 'staging.129-225-90-80.sslip.io', u = (h) => 'https://' + h;
const yes = (b, a, f) => assert.strictEqual(d(b, a, f).ok, true, 'should pass: ' + b);
const no = (b, a, f, why) => { const r = d(b, a, f); assert.strictEqual(r.ok, false, 'should refuse: ' + b + ' (' + f + ')'); if (why) assert.ok(r.why.includes(why), r.why + ' vs ' + why); };
yes(u(OK), u(OK), OK);                                   // the one valid SIT host
yes(u(OK.toUpperCase()), u(OK) + '/', OK.toUpperCase()); // case and a trailing slash do not matter
no(u('staging.129-225-85-65.sslip.io'), u('staging.129-225-85-65.sslip.io'), 'staging.129-225-85-65.sslip.io', 'gate box');   // sit-in, dashed
no(u('staging.129.225.85.65.sslip.io'), u('staging.129.225.85.65.sslip.io'), 'staging.129.225.85.65.sslip.io');                // sit-in, dotted (the denylist alone missed it; the allowlist refuses)
no(u('129-225-85-65.sslip.io'), u('129-225-85-65.sslip.io'), '129-225-85-65.sslip.io', 'gate box');
no(u('app.chitbridge.com'), u('app.chitbridge.com'), 'app.chitbridge.com', 'production');
no(u('web-production.up.railway.app'), u('web-production.up.railway.app'), 'web-production.up.railway.app', 'production');
no(u('abc.supabase.co'), u('abc.supabase.co'), 'abc.supabase.co', 'production');
no(u('staging.1-2-3-4.sslip.io'), u('staging.1-2-3-4.sslip.io'), 'staging.1-2-3-4.sslip.io', 'allowlist');                         // unknown host
no('http://' + OK, 'http://' + OK, OK, 'https');                                       // http
no(u(OK), u('staging.129-225-85-65.sslip.io'), OK, 'api');                              // api differs from base
no(u(OK), u(OK), 'staging.129-225-85-65.sslip.io', '--remote-ok');                      // flag differs from base
no(u(OK), u(OK), '', '--remote-ok');
no(u(OK) + '/app', u(OK) + '/app', OK, 'origin');
no('nonsense', 'nonsense', OK, 'URL');
// the real refusal: lib.cjs exits 2 at load (a11y.cjs requires it first thing); nothing is signed in, no browser starts
const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'a11y.cjs'), ...a], { encoding: 'utf8', timeout: 20000 });
for (const h of ['staging.129-225-85-65.sslip.io', 'staging.129.225.85.65.sslip.io', 'app.chitbridge.com']) {
  const r = run('--remote-ok', h, '--base', u(h), '--api', u(h)); assert.strictEqual(r.status, 2, 'exit 2 for ' + h + ', got ' + r.status + ' ' + r.stderr.slice(0, 120));
  assert.ok(/refused/.test(r.stderr), 'a refusal message for ' + h);
}
const r2 = run('--remote-ok', 'STAGING.129-225-85-65.SSLIP.IO', '--base', u('staging.129-225-85-65.sslip.io'), '--api', u('staging.129-225-85-65.sslip.io')); assert.strictEqual(r2.status, 2, 'upper-case flag still refused');
console.log('proof remote host: PASS');
