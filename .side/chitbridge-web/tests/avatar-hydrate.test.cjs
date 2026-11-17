/**
 * tests/avatar-hydrate.test.cjs — F9 (FX-UX2): THE SERVER'S ui_prefs IS THE TRUTH FOR A SIGNED-IN PERSON (public/app/avatar.js hydrate).
 *
 *   · the server cleared the edition → this device's cb_edition goes back to the default and the page redraws (editionReload)
 *   · the server holds nothing for a kind chosen OFFLINE (the pending mark, cb_prefs_pending) → kept, and pushed again
 *   · a tab held by a showing link (cb_edition_tab) is not redrawn
 *   · one rule for every kind: theme · fs · font · weight · motion · stripes the same as edition
 *   · a push the server answers ok:true clears the mark; {pending:true} (before the column) does not
 *
 * No browser: a stand-in document, storage and fetch. Run: node tests/avatar-hydrate.test.cjs
 */
'use strict';
const path = require('path');
const assert = require('assert');
const FILE = path.join(__dirname, '..', 'public', 'app', 'avatar.js');

function store() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i], get length() { return m.size; }, _m: m };
}
/** a fresh page: a new global with avatar.js loaded into it */
function page(o) {
  o = o || {};
  const el = () => ({ style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {}, removeAttribute() {}, classList: { add() {}, toggle() {} } });
  const g = { localStorage: store(), sessionStorage: store(), reloads: 0, sent: [] };
  g.document = { documentElement: el(), addEventListener() {}, getElementById: () => null, createElement: el, head: { appendChild() {} } };
  g.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '16px' });
  g.location = { href: 'http://x/tasks.html', reload: () => { g.reloads++; }, replace: () => { g.reloads++; } };
  g.URL = URL; g.setTimeout = (fn) => { fn(); return 1; }; g.clearTimeout = () => {};
  g.addEventListener = () => {};
  g.CBScreen = { APP_THEMES: { cream: { name: 'Cream', vars: {} }, dark: { name: 'Dark', vars: { '--paper': '#111' }, scheme: 'dark' } } };
  g.fetch = (url, init) => { g.sent.push({ url, body: JSON.parse(init.body) }); const a = o.answer || { ok: true }; return Promise.resolve({ ok: true, json: () => Promise.resolve(a) }); };
  Object.entries(o.ls || {}).forEach(([k, v]) => g.localStorage.setItem(k, v));
  Object.entries(o.ss || {}).forEach(([k, v]) => g.sessionStorage.setItem(k, v));
  /* T2-WEBPRIMS: every page loads app/helpers.js (the one esc) before avatar.js — its free `esc` resolves to that global */
  if (typeof globalThis.esc !== 'function') require('vm').runInThisContext(require('fs').readFileSync(path.join(path.dirname(FILE), 'helpers.js'), 'utf8'));
  const fn = new Function('window', 'localStorage', 'document', require('fs').readFileSync(FILE, 'utf8'));
  fn.call(g, g, g.localStorage, g.document);
  g.A = g.CBAvatar;
  g.A.mount({ innerHTML: '', querySelector: () => null, contains: () => false }, { apiBase: 'http://api', token: 't', pull: false });
  return g;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

let pass = 0, fail = 0;
const it = (what, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ok  ' + what); }, (e) => { fail++; console.log('  FAIL ' + what + '\n       ' + (e && e.message || e)); });

(async () => {
  await it('the server cleared the edition → the device copy resets to full and the page redraws', () => {
    const g = page({ ls: { cb_edition: 'auditor' } });
    const changed = g.A.hydrate({ theme: 'dark' });
    assert.strictEqual(changed, true);
    assert.strictEqual(g.localStorage.getItem('cb_edition'), null, 'cb_edition removed');
    assert.strictEqual(g.A.get().edition, 'full');
    assert.strictEqual(g.reloads, 1, 'editionReload ran once');
  });
  await it('an EMPTY server object (every key cleared) resets too — the old early return is gone', () => {
    const g = page({ ls: { cb_edition: 'auditor', cb_fs: 'xl' } });
    assert.strictEqual(g.A.hydrate({}), true);
    assert.strictEqual(g.A.get().edition, 'full'); assert.strictEqual(g.A.get().fs, 'm');
  });
  await it('one rule for every kind: theme · fs · font · weight · motion · stripes · kural go back to their defaults', () => {
    const g = page({ ls: { cb_theme: 'dark', cb_fs: 'l', cb_font: 'serif', cb_weight: 'bold', cb_motion: 'reduce', cb_stripes: 'off' } });
    g.A.hydrate({ edition: 'full' });
    assert.deepStrictEqual(g.A.get(), { theme: 'cream', font: 'default', fs: 'm', weight: 'normal', motion: 'auto', stripes: 'strong', edition: 'full', kural: 'auto', keys: 'on' }); /* SET-WALK1 W7 added the kural pref (default auto) */
    assert.strictEqual(g.reloads, 0, 'the edition did not change: no redraw');
  });
  await it('a value the server holds is taken (unchanged behaviour)', () => {
    const g = page();
    assert.strictEqual(g.A.hydrate({ fs: 'l', edition: 'auditor' }), true);
    assert.strictEqual(g.A.get().fs, 'l'); assert.strictEqual(g.A.get().edition, 'auditor'); assert.strictEqual(g.reloads, 1);
  });
  await it('set offline (the push never landed) → the server has nothing → KEPT, and pushed again', async () => {
    const g = page({ answer: { ok: false, pending: true } });   /* the server answers "not synced yet" */
    g.A.set('stripes', 'off');
    await tick();
    assert.deepStrictEqual(g.A.pending(), { stripes: 'off' }, 'still pending: {pending:true} is not a landing');
    g.sent.length = 0;
    g.A.hydrate({});
    assert.strictEqual(g.A.get().stripes, 'off', 'kept');
    assert.strictEqual(g.sent.length, 1, 'pushed again'); assert.strictEqual(g.sent[0].body.stripes, 'off');
  });
  await it('a push the server answers ok:true clears the mark — then a later server clear resets it', async () => {
    const g = page({ answer: { ok: true, kind: 'ui' } });
    g.A.set('fs', 'xl');
    await tick();
    assert.deepStrictEqual(g.A.pending(), {}, 'landed');
    g.A.hydrate({ theme: 'device' });
    assert.strictEqual(g.A.get().fs, 'm');
  });
  await it('a mark whose value the server already holds was landed (the answer was lost): it goes, no push', () => {
    const g = page({ ls: { cb_motion: 'reduce', cb_prefs_pending: JSON.stringify({ motion: 'reduce' }) } });
    g.A.hydrate({ motion: 'reduce' });
    assert.deepStrictEqual(g.A.pending(), {}); assert.strictEqual(g.sent.length, 0);
  });
  await it('a tab held by a showing link is not redrawn, and keeps its tab', () => {
    const g = page({ ls: { cb_edition: 'auditor' }, ss: { cb_edition_tab: 'auditor' } });
    g.A.hydrate({});
    assert.strictEqual(g.reloads, 0, 'no redraw');
    assert.strictEqual(g.sessionStorage.getItem('cb_edition_tab'), 'auditor', 'the tab keeps its rule');
  });
  await it('no prefs object at all (the read failed) → nothing touched', () => {
    const g = page({ ls: { cb_edition: 'auditor' } });
    assert.strictEqual(g.A.hydrate(null), false); assert.strictEqual(g.A.get().edition, 'auditor');
  });
  await it('an invalid server value is ignored, never stamped', () => {
    const g = page({ ls: { cb_fs: 'l' } });
    g.A.hydrate({ fs: 'huge' });
    assert.strictEqual(g.A.get().fs, 'l');
  });
  console.log((fail ? 'FAIL' : 'PASS') + ' · avatar hydrate · ' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
