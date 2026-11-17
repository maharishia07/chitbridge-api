/**
 * tests/sec131-signout.test.cjs — SEC-131: THE WEB SIGN-OUT CALLS POST /api/signin/logout (public/app/avatar.js endSession).
 *
 *   · sign out → the server is asked to revoke THIS token; the stand-in server then answers the old token 401 (the line's check; the real server half is api#688)
 *   · offline / the call fails → the device still forgets the session, and the failure is said (console), not swallowed
 *   · a browser that refuses to clear storage → said out loud (console.error + toast), result.cleared false
 *   · a tab told "another shop opened here" revokes its OWN token, never the one now in storage
 *   · a page with no app behind it (no onSignOut) signs out through the same function
 *   · ONE path: the app's logoutNow() reaches endSession and no second code path calls the logout endpoint
 *
 * No browser: a stand-in document, storage and fetch. Run: node tests/sec131-signout.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..', 'public');
const FILE = path.join(ROOT, 'app', 'avatar.js');

function store(failRemove) {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => { if (failRemove) throw new Error('storage is locked'); m.delete(k); },
    key: (i) => Array.from(m.keys())[i], get length() { return m.size; }, _m: m };
}
/** a stand-in server: a token it has been asked to revoke answers 401 afterwards */
function server(o) {
  const revoked = new Set();
  return {
    revoked, calls: [],
    fetch(url, init) {
      this.calls.push({ url, init });
      if (o.offline) return Promise.reject(new Error('Failed to fetch'));
      const token = String((init && init.headers && init.headers.Authorization) || '').replace('Bearer ', '');
      if (/\/api\/signin\/logout$/.test(url) && init.method === 'POST') { revoked.add(token); return Promise.resolve({ ok: true, status: 200 }); }
      return Promise.resolve(revoked.has(token) ? { ok: false, status: 401 } : { ok: true, status: 200, json: () => Promise.resolve({}) });
    }
  };
}
function page(o) {
  o = o || {};
  const el = () => ({ style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {}, removeAttribute() {}, classList: { add() {}, toggle() {} } });
  const srv = server(o);
  const g = { localStorage: store(o.failRemove), sessionStorage: store(), srv, toasts: [] };
  g.document = { documentElement: el(), addEventListener() {}, getElementById: () => null, createElement: el, head: { appendChild() {} } };
  g.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '16px' });
  g.location = { href: 'http://x/tasks.html', reload() {}, replace() {} };
  g.URL = URL; g.setTimeout = (fn) => { fn(); return 1; }; g.clearTimeout = () => {}; g.addEventListener = () => {};
  g.CBScreen = { APP_THEMES: { cream: { name: 'Cream', vars: {} } } };
  g.fetch = (url, init) => srv.fetch(url, init);
  g.toast = (words, bad) => g.toasts.push({ words, bad });
  if (o.token) { try { g.localStorage.setItem('cb_sess', JSON.stringify({ token: o.token })); } catch (_) { /* the test's own seed */ } }
  if (typeof globalThis.esc !== 'function') require('vm').runInThisContext(fs.readFileSync(path.join(path.dirname(FILE), 'helpers.js'), 'utf8'));
  const fn = new Function('window', 'localStorage', 'document', fs.readFileSync(FILE, 'utf8'));
  fn.call(g, g, g.localStorage, g.document);
  g.A = g.CBAvatar;
  g.A.mount({ innerHTML: '', querySelector: () => null, contains: () => false }, Object.assign({ apiBase: 'http://api', pull: false, sync: false }, o.mount || {}));
  return g;
}
/** run fn with console.error / console.warn captured */
async function quiet(fn) {
  const keep = { error: console.error, warn: console.warn }, seen = [];
  console.error = (...a) => seen.push(['error', a.join(' ')]);
  console.warn = (...a) => seen.push(['warn', a.join(' ')]);
  try { return { r: await fn(), seen }; } finally { console.error = keep.error; console.warn = keep.warn; }
}

let pass = 0, fail = 0;
const it = (what, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ok  ' + what); }, (e) => { fail++; console.log('  FAIL ' + what + '\n       ' + (e && e.message || e)); });

(async () => {
  await it('sign out asks the server to revoke the token; the old token then answers 401', async () => {
    const g = page({ token: 'tok-1' });
    const out = await g.A.endSession({ token: 'tok-1', apiBase: 'http://api' });
    assert.strictEqual(g.srv.calls.length, 1, 'one call');
    assert.strictEqual(g.srv.calls[0].url, 'http://api/api/signin/logout');
    assert.strictEqual(g.srv.calls[0].init.method, 'POST');
    assert.strictEqual(g.srv.calls[0].init.headers.Authorization, 'Bearer tok-1');
    assert.deepStrictEqual(out, { revoked: true, cleared: true });
    assert.strictEqual(g.localStorage.getItem('cb_sess'), null, 'the device forgot the session');
    const replay = await g.fetch('http://api/api/entities/me', { headers: { Authorization: 'Bearer tok-1' } });
    assert.strictEqual(replay.status, 401, 'replaying the old token');
  });
  await it('offline: the call fails, the device still forgets, and the failure is said', async () => {
    const g = page({ token: 'tok-2', offline: true });
    const { r, seen } = await quiet(() => g.A.endSession({ token: 'tok-2', apiBase: 'http://api' }));
    assert.deepStrictEqual(r, { revoked: false, cleared: true });
    assert.strictEqual(g.localStorage.getItem('cb_sess'), null);
    assert.ok(seen.some((x) => x[0] === 'warn' && /could not reach the server/.test(x[1])), 'the warning was written');
  });
  await it('a browser that refuses to clear storage is said out loud (console + toast), never silent', async () => {
    const g = page({ token: 'tok-3', failRemove: true });
    const { r, seen } = await quiet(() => g.A.endSession({ token: 'tok-3', apiBase: 'http://api' }));
    assert.strictEqual(r.cleared, false);
    assert.ok(seen.some((x) => x[0] === 'error' && /could not clear/.test(x[1])), 'console.error written');
    assert.ok(g.toasts.length === 1 && g.toasts[0].bad === true && /Could not clear/.test(g.toasts[0].words), 'the person is told');
  });
  await it('a tab told another shop opened revokes ITS OWN token, not the one now in storage', async () => {
    const g = page({ token: 'other-shop' });
    await g.A.endSession({ token: 'mine', apiBase: 'http://api' });
    assert.deepStrictEqual(Array.from(g.srv.revoked), ['mine']);
  });
  await it('an explicit empty token calls nothing (never falls back to the stored one)', async () => {
    const g = page({ token: 'stored' });
    await g.A.endSession({ token: '', apiBase: 'http://api' });
    assert.strictEqual(g.srv.calls.length, 0);
  });
  await it('a page with no app behind it signs out through the same function', async () => {
    const g = page({ token: 'tok-4', mount: { signInHref: '/index.html' } });
    g.A.signOut();
    await Promise.resolve();
    assert.deepStrictEqual(Array.from(g.srv.revoked), ['tok-4']);
    assert.strictEqual(g.localStorage.getItem('cb_sess'), null);
    assert.strictEqual(g.location.href, '/index.html');
  });
  await it('the app\'s own sign-out (onSignOut) is left to the app: no call from the menu itself', async () => {
    let asked = 0;
    const g = page({ token: 'tok-5', mount: { onSignOut: () => { asked++; } } });
    g.A.signOut();
    assert.strictEqual(asked, 1);
    assert.strictEqual(g.srv.calls.length, 0);
  });
  await it('ONE path: app.html logoutNow() reaches endSession, and nothing else in public/ calls the logout endpoint', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
    const body = app.slice(app.indexOf('function logoutNow()'), app.indexOf('const UI0 = {'));
    assert.ok(/CBAvatar\.endSession\(\{ token: SESSION\.token/.test(body), 'logoutNow calls endSession with this tab\'s token');
    const clears = body.match(/removeItem[(]'cb_sess'[)]/g) || [];
    assert.ok(clears.length === 1 && body.indexOf("removeItem('cb_sess')") > body.indexOf('} catch (failure)'), 'logoutNow clears by itself only in the fail-safe catch');
    const hits = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!/vendor|node_modules/.test(entry.name)) walk(p); }
        else if (/\.(js|html)$/.test(entry.name) && /signin\/logout/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    })(ROOT);
    assert.deepStrictEqual(hits, ['app/avatar.js'], 'callers of the logout endpoint: ' + hits.join(', '));
  });
  await it('CBAvatar absent (avatar.js did not load): logoutNow still clears cb_sess and the per-person keys', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
    const from = app.indexOf('function logoutNow()');
    const body = app.slice(from, app.indexOf('stopAutoRefresh();', from));
    const raw = store();
    const ls = new Proxy(raw, { ownKeys: () => Array.from(raw._m.keys()), getOwnPropertyDescriptor: (target, key) => (raw._m.has(key) ? { enumerable: true, configurable: true, value: raw._m.get(key) } : undefined) });
    ['cb_sess', 'cb_nav', 'cb_nav@shop1', 'cb_theme'].forEach((key) => ls.setItem(key, 'x'));
    const run = new Function('localStorage', 'SESSION', 'CFG', 'console', 'tx', '_netFlush', body.replace('function logoutNow()', 'return (function ()') + '})()');
    run(ls, { token: 't' }, { API_BASE: 'http://api' }, { error() {} }, (x) => x, undefined);
    assert.deepStrictEqual(Array.from(raw._m.keys()), ['cb_theme']);
  });
  console.log((fail ? 'FAIL' : 'PASS') + ' · SEC-131 sign-out · ' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
