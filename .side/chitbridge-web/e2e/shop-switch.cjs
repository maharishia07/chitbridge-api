/**
 * e2e/shop-switch.cjs — SEC-85: A PAGE LEFT OPEN AS ONE SHOP NEVER WRITES TO IT AFTER A SIGN-IN AS ANOTHER SHOP IN ANOTHER TAB.
 *
 * PRINT-1 P3 (reproduced 22 Oct): a tab opened as shop A keeps A's token; a sign-in as shop B in a second tab rewrites cb_sess, so
 * the bar names B while the old tab's Save still writes to A. public/app/device-id.js (loaded first on every session page, and
 * already the one fetch wrapper) remembers the page's shop and stops the page when cb_sess names another. This test, with no
 * browser, runs device-id.js in a sandbox and swaps cb_sess between two shops' tokens:
 *   1  the storage event names shop B → the page stops: the Save (a POST with A's Bearer) is refused before it leaves, the
 *      sentence covers the page with Reload; a read (GET) still goes
 *   2  the event was missed (cb_sess swapped quietly) → the Save carrying A's Bearer is refused and the page stops all the same
 *   3  never stopped: a sign-in in THIS tab (its Save carries B's Bearer), a person of the same shop, a sign-out, a third party
 * Run: node e2e/shop-switch.cjs · no network, no browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LIB = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'device-id.js'), 'utf8');

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

/** a session token as the api signs it: only its claims matter here */
const token = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
const OWNER_A = token({ identity_id: 'shop-a', identity_type: 'entity' });
const OWNER_B = token({ identity_id: 'shop-b', identity_type: 'entity' });
const CLERK_A = token({ identity_id: 'person-7', identity_type: 'actor', parent_entity_id: 'shop-a' });
const session = (t) => JSON.stringify({ token: t, role: 'entity', name: 'x' });

/** a fake page: device-id.js loaded with cb_sess as given; returns the window, what reached the network, and the cover drawn */
function page(startToken) {
  const store = { cb_sess: session(startToken) };
  const sent = [];
  const listeners = {};
  const drawn = [];
  const element = () => ({ style: {}, setAttribute() {}, addEventListener() {}, focus() {}, appendChild(child) { (this.children = this.children || []).push(child); } });
  const document = { body: { appendChild: (box) => drawn.push(box) }, createElement: element, getElementById: () => (drawn.length ? drawn[0] : null), addEventListener() {} };
  const win = {
    location: { href: 'https://web.example/settings.html', origin: 'https://web.example', reload() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    atob: globalThis.atob,
    document,
    addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
    fetch: (input, init) => {
      sent.push({ input, method: (init && init.method) || 'GET' });
      return Promise.resolve({ ok: true });
    }
  };
  win.window = win;
  vm.runInNewContext(LIB, { window: win, URL: globalThis.URL, Date, Math, Object, String, JSON, Promise, Error });
  return {
    win,
    sent,
    drawn,
    /** another tab writes cb_sess (the storage event fires here) */
    otherTab: (t) => {
      if (t === null) delete store.cb_sess;
      else store.cb_sess = session(t);
      (listeners.storage || []).forEach((fn) => fn({ key: 'cb_sess', newValue: t === null ? null : session(t) }));
    },
    /** cb_sess changes with no event reaching this page (a missed event, or this tab's own sign-in) */
    quietly: (t) => (store.cb_sess = session(t))
  };
}
const save = (p, bearer) => p.win.fetch('/api/governance/profile/vault', { method: 'PUT', headers: { Authorization: 'Bearer ' + bearer } }).then(() => 'sent', (e) => e);
const read = (p, bearer) => p.win.fetch('/api/entities/me', { headers: { Authorization: 'Bearer ' + bearer } }).then(() => 'sent', (e) => e);
const textOf = (box) => (box && box.children ? box.children.map((c) => c.textContent).join(' | ') : '');

(async () => {
  console.log('\n-- 1 · another tab signs in as shop B: the page opened as A stops --');
  const p = page(OWNER_A);
  ok('the token names its shop (owner: identity_id; a person: parent_entity_id)', p.win.CBDevice.shopOf(OWNER_A) === 'shop-a' && p.win.CBDevice.shopOf(CLERK_A) === 'shop-a');
  p.otherTab(OWNER_B);
  ok('the storage event that names another shop stops the page', p.win.CBDevice.stopped());
  const refused = await save(p, OWNER_A);
  ok("the Save carrying shop A's token is refused before it leaves (SHOP_SWITCHED)", refused && refused.code === 'SHOP_SWITCHED' && !p.sent.some((c) => c.method === 'PUT'), JSON.stringify(p.sent));
  ok('the page says so, once, with Reload', p.drawn.length === 1 && textOf(p.drawn[0]) === p.win.CBDevice.SWITCHED + ' | Reload', textOf(p.drawn[0]));
  ok('a read still goes (reads are left alone)', (await read(p, OWNER_A)) === 'sent');
  ok('stopped stays stopped: even a write with the new token waits for the reload', (await save(p, OWNER_B)) !== 'sent');

  console.log('\n-- 2 · the event was missed: the write itself is checked --');
  const missed = page(OWNER_A);
  missed.quietly(OWNER_B);
  const late = await save(missed, OWNER_A);
  ok("cb_sess names B but the Save carries A's token → refused, and the page stops", late && late.code === 'SHOP_SWITCHED' && missed.win.CBDevice.stopped() && missed.drawn.length === 1);

  console.log('\n-- 3 · never stopped --');
  const own = page(OWNER_A);
  own.quietly(OWNER_B);
  ok("a sign-in in THIS tab (its Save carries B's token) goes, and the page follows B", (await save(own, OWNER_B)) === 'sent' && !own.win.CBDevice.stopped());
  own.otherTab(OWNER_B);
  ok('…so a later event naming B again does not stop it', !own.win.CBDevice.stopped());
  const same = page(OWNER_A);
  same.otherTab(CLERK_A);
  ok('a person of the same shop signing in elsewhere does not stop the page', !same.win.CBDevice.stopped() && (await save(same, OWNER_A)) === 'sent');
  const out = page(OWNER_A);
  out.otherTab(null);
  ok('a sign-out elsewhere is not a switch (avatar.js answers it)', !out.win.CBDevice.stopped());
  const stranger = page(OWNER_A);
  stranger.otherTab(OWNER_B);
  const third = await stranger.win.fetch('https://pay.example/hook', { method: 'POST' }).then(() => 'sent', (e) => e);
  ok('a stopped page still lets a call that is not the api go', third === 'sent');

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  if (fail) process.exit(1);
})();
