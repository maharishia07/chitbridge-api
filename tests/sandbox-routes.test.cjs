'use strict';
/**
 * tests/sandbox-routes.test.cjs — the sandbox trial's doors exist ONLY on a local stack that is not sealed (routes/sandbox.js mount).
 * Proves: sealed → not mounted · not local (a remote database) → not mounted · " development" with a remote database (production's old
 * value) → not mounted · local development → mounted, and the page carries no secret. Also: a callback with a stranger's state is refused.
 * Run: node tests/sandbox-routes.test.cjs · no DB, no network.
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SAVED = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
const LOCAL_DB = 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
const REMOTE_DB = 'postgres://u:p@db.example.com:5432/x';
process.env.SANDBOX_SAMPLES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sandbox-'));
process.env.SANDBOX_ENV_FILE = path.join(process.env.SANDBOX_SAMPLES_DIR, 'none.env');   /* no real keys are read by this test */
process.env.QBO_CLIENT_ID = 'test-id'; process.env.QBO_CLIENT_SECRET = 'TEST-SECRET-NEVER-SHOWN'; process.env.QBO_REDIRECT_URI = 'http://localhost:3100/api/sandbox/qbo/callback';

const S = require('../routes/sandbox');
const fakeApp = () => { const used = []; return { used, use: (p) => used.push(p) }; };
function mountedWith(env, db) {
  process.env.NODE_ENV = env; process.env.DATABASE_URL = db;
  const app = fakeApp();
  const r = S.mount(app);
  return { r, used: app.used };
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('sealed (production) → not mounted', () => { const m = mountedWith('production', LOCAL_DB); assert.strictEqual(m.r, false); assert.deepStrictEqual(m.used, []); });
t('sealed with spaces (" production ") → not mounted', () => { assert.strictEqual(mountedWith(' production ', LOCAL_DB).r, false); });
t('uat / staging / live → not mounted', () => { ['uat', 'staging', 'live', 'prod'].forEach((e) => assert.strictEqual(mountedWith(e, LOCAL_DB).r, false, e)); });
t('" development" with a remote database (production\'s old value) → not mounted', () => { assert.strictEqual(mountedWith(' development', REMOTE_DB).r, false); });
t('no NODE_ENV, local database → not mounted (not a declared local stack)', () => { assert.strictEqual(mountedWith('', LOCAL_DB).r, false); });
t('local development stack → mounted at /api/sandbox', () => { const m = mountedWith('development', LOCAL_DB); assert.strictEqual(m.r, true); assert.deepStrictEqual(m.used, ['/api/sandbox']); });

t('the page names each vendor and never shows a secret', () => {
  const html = S.pageHTML(null);
  ['QuickBooks', 'Xero', 'Zoho Books'].forEach((v) => assert.ok(html.includes(v), v));
  assert.ok(!html.includes('TEST-SECRET-NEVER-SHOWN')); assert.ok(!html.includes('test-id'));
});
t('a vendor with missing keys shows a greyed Connect with the reason', () => {
  delete process.env.XERO_CLIENT_ID;
  assert.ok(/aria-disabled="true">Connect<\/span><small>Missing: client id/.test(S.pageHTML(null)));
});

/* the callback refuses a state it did not issue — drive the real router */
t('a callback with a state we never issued is refused (400) and nothing is saved', () => {
  const layer = S.router.stack.find((l) => l.route && l.route.path === '/:vendor/callback');
  let status = 0;
  const res = { status(c) { status = c; return this; }, type() { return this; }, send() { return this; }, redirect() { status = 302; } };
  layer.route.stack[0].handle({ params: { vendor: 'qbo' }, query: { state: 'forged', code: 'x' } }, res);
  assert.strictEqual(status, 400);
  assert.ok(!fs.existsSync(path.join(process.env.SANDBOX_SAMPLES_DIR, '.tokens', 'qbo.json')));
});

process.env.NODE_ENV = SAVED.NODE_ENV; process.env.DATABASE_URL = SAVED.DATABASE_URL;
console.log('sandbox-routes: ' + n + ' passed');
