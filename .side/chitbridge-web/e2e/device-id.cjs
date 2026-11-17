/**
 * e2e/device-id.cjs — K-SEC PR A: EVERY PAGE THAT HOLDS A SESSION SENDS X-Device-Id, OR NOBODY GETS A SESSION SAFELY.
 *
 * A sign-in that names its device is bound to it: every later call without X-Device-Id answers 401 DEVICE_MISMATCH. cb_sess is
 * shared by all pages, so ONE page that misses public/app/device-id.js would lock its person out the moment they signed in
 * anywhere else. This guard, with no browser:
 *   1  every page under public/ that holds a session (bar the till and the shop screen, which stamp their own) loads /app/device-id.js
 *      BEFORE any other script
 *   2  the till's own deviceId() keeps the SAME key and shape as CBDevice (until the counter area moves it onto CBDevice)
 *   3  device-id.js itself, run in a sandbox: stamps api calls (relative /api/… and window.CB_API), never a third party, keeps a
 *      header the caller set, makes the id once and keeps it, and stamps NOTHING when storage cannot keep the id
 *   4  signin-ui.js defaults a door's deviceId to CBDevice, and `deviceId: false` still opts out
 *   5  e2e/shop-switch.cjs (SEC-85): a page opened as one shop never writes to it after a sign-in as another shop in another tab
 * Run: node e2e/device-id.cjs · no network, no browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const OWN_STAMP = new Set(['till.html', 'promo.html', 'bank-demo.html']); /* the counter and the shop screen set X-Device-Id themselves; the no-login bank demo mounts the header anonymous: it reads no session and makes no call, and must load no device-id.js (e2e/bank-preview.test.cjs pins that) */
/* ⚠️ NAMED GAP (K-SEC PR A): the readability guard has no trace row for public/cmdb/*.html, so ANY edit there fails CI. Until the
   trace covers it, the CMDB record viewer is left as it was: a person with a listed session sees its "Sign in" line there only. */
const KNOWN_GAP = new Set(['cmdb/record.html']);
/* a page HOLDS A SESSION when it sends a Bearer, reads cb_sess, or loads a script that does (the shared session readers) */
const HOLDS_SESSION =
  /Bearer|cb_sess|\/app\/(core|avatar|shell|page-frame|one-person|signin-ui|rail-bell|accounts-shell|embed-host|network-app|sides|attach-ui|shop-privacy|cap-[a-z-]+)\.js|cb-offline\.js/;

let pass = 0,
  fail = 0;
const ok = (what, cond, why) => {
  if (cond) {
    pass++;
    console.log('  ok  ' + what);
  } else {
    fail++;
    console.log('  FAIL ' + what + (why ? '\n       ' + why : ''));
  }
};

/* ── 1 · every page loads it first ───────────────────────────────────────────────────────────────────────────── */
function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : pages(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}
const missing = [];
/* Home is the repo-root index.html (it deploys at /), the first sign-in door anyone sees — judged with public/'s pages */
const HOME = path.join(PUB, '..', 'index.html');
pages(PUB).concat([HOME]).forEach((file) => {
  const rel = path.relative(PUB, file).split(path.sep).join('/');
  if (OWN_STAMP.has(rel) || KNOWN_GAP.has(rel)) return;
  const html = fs.readFileSync(file, 'utf8');
  if (!HOLDS_SESSION.test(html)) return;
  const first = html.search(/<script\b/i);
  if (html.indexOf('<script src="/app/device-id.js"></script>') !== first) missing.push(rel);
});
/* a scan that finds nothing proves nothing: these session pages must be among the ones it judged (and they load the file) */
const KNOWN = ['index.html', 'public/app.html', 'public/accounts.html', 'public/crm.html', 'public/intake.html'].map((rel) => path.join(__dirname, '..', rel));
ok('the scan judges the known session pages, and each loads /app/device-id.js',
  KNOWN.every((file) => HOLDS_SESSION.test(fs.readFileSync(file, 'utf8')) && fs.readFileSync(file, 'utf8').includes('/app/device-id.js')));
ok('every page that holds a session loads /app/device-id.js before any other script', missing.length === 0, missing.join(', '));

/* ── 2 · the till names the browser the same way ─────────────────────────────────────────────────────────────── */
const lib = fs.readFileSync(path.join(PUB, 'app', 'device-id.js'), 'utf8');
const till = fs.readFileSync(path.join(PUB, 'till.html'), 'utf8');
const tillFn = (till.match(/function deviceId\(\)\{[\s\S]*?\n\}/) || [''])[0];
ok("the till's deviceId() and CBDevice keep the same key (cb_device_id)", /'cb_device_id'/.test(tillFn) && /var KEY = 'cb_device_id'/.test(lib));
ok("the till's deviceId() and CBDevice accept the same shape (the api's deviceIdOf)",
  tillFn.includes('/^[A-Za-z0-9_.:-]{8,80}$/') && lib.includes('var SHAPE = /^[A-Za-z0-9_.:-]{8,80}$/'));

/* ── 3 · the wrapper itself ──────────────────────────────────────────────────────────────────────────────────── */
function sandbox(opts) {
  const store = {};
  const calls = [];
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      if (opts.storageRefuses) throw new Error('QuotaExceededError');
      store[k] = String(v);
    }
  };
  const win = {
    CB_API: 'https://api.example',
    location: { href: 'https://web.example/app.html', origin: 'https://web.example' },
    localStorage,
    crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    URL: globalThis.URL,
    fetch: (input, init) => {
      calls.push({ input, headers: new globalThis.Headers((init && init.headers) || undefined) });
      return Promise.resolve({ ok: true });
    }
  };
  win.window = win;
  vm.runInNewContext(lib, Object.assign({ window: win, URL: globalThis.URL, Date, Math, Object, String }, {}));
  return { win, calls, store };
}
(async () => {
  const s = sandbox({});
  await s.win.fetch('/api/chits', { headers: { Authorization: 'Bearer t' } });
  await s.win.fetch('https://api.example/api/signin/verify', { method: 'POST' });
  await s.win.fetch('https://fonts.example/x.css');
  await s.win.fetch('/app/helpers.js');
  await s.win.fetch('/api/x', { headers: { 'X-Device-Id': 'till-own-0001' } });
  const id = s.store.cb_device_id;
  ok('the id is made once, in the api shape, and kept in cb_device_id', /^[A-Za-z0-9_.:-]{8,80}$/.test(id || ''));
  ok('a same-origin /api/ call carries X-Device-Id (and keeps its Authorization)',
    s.calls[0].headers.get('X-Device-Id') === id && s.calls[0].headers.get('Authorization') === 'Bearer t');
  ok('a call to window.CB_API carries it (the sign-in door included)', s.calls[1].headers.get('X-Device-Id') === id);
  ok('a third party never gets it', !s.calls[2].headers.get('X-Device-Id'));
  ok('a static file on our own origin does not get it', !s.calls[3].headers.get('X-Device-Id'));
  ok('a header the caller set is kept, never overwritten', s.calls[4].headers.get('X-Device-Id') === 'till-own-0001');
  const blocked = sandbox({ storageRefuses: true });
  await blocked.win.fetch('/api/chits');
  ok('⚠️ storage that cannot keep the id → nothing stamped (legacy sign-in, never an id that changes per page)',
    !blocked.calls[0].headers.get('X-Device-Id') && blocked.win.CBDevice.id() === null);

  /* ── 4 · the sign-in doors ─────────────────────────────────────────────────────────────────────────────────── */
  const ui = fs.readFileSync(path.join(PUB, 'app', 'signin-ui.js'), 'utf8');
  ok("signin-ui: a door with no deviceId uses CBDevice.id; 'deviceId: false' still opts out",
    /if \(d === undefined && root\.CBDevice && typeof root\.CBDevice\.id === 'function'\) d = root\.CBDevice\.id;/.test(ui));

  /* ── 5 · SEC-85, the same file's shop-switch stop: its own test, run from here so the one CI device-id step covers it ── */
  const switched = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'shop-switch.cjs')], { encoding: 'utf8' });
  ok('e2e/shop-switch.cjs: a page opened as one shop stops after a sign-in as another shop in another tab (SEC-85)', switched.status === 0,
    (switched.stdout || '').split('\n').filter((line) => /FAIL/.test(line)).join(' · ') || switched.stderr);

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  if (fail) process.exit(1);
})();
