'use strict';
/**
 * till-bind.test.cjs — the counter follows the shop signed in now; only a FIXED counter holds a lock (Athi 21 Nov).
 * SPEC-counter-identity G1. Lifts the page's own functions into a sandbox and drives them — no DB, no network.
 *   T1 signed in to B on a device last used for A (a person for A, or a key for A not set up as fixed) -> the hand-over to B is offered
 *   T2 A's unsent sale is parked: B reads its own store only, and the one-line notice shows
 *   T3 a fixed counter stays on its shop: no hand-over; the flag has one writer (becomeShop) and is set only for a fixed key
 * Run: node tests/till-bind.test.cjs
 * CARD      09-counter/counters-and-keys-pair-enrol-open-release
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0;
const it = (what, run) => Promise.resolve().then(run).then(() => { pass++; console.log('  ok  ' + what); }, (e) => { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; });
function fn(sig) { const at = PAGE.indexOf(sig); assert.ok(at >= 0, sig + ' is gone'); const end = PAGE.indexOf('\n}\n', at); return PAGE.slice(at, end + 3); }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tok = (ent) => 'h.' + b64({ parent_entity_id: ent, identity_id: 'id-' + ent, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

function world(opts) {
  const store = Object.assign({}, opts.ls || {}), flashes = [];
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), JSON, Date, String, Number, Object, console,
    CloudHost: { key: opts.key || null, person: opts.person || null },
    cbQuiet() {}, OWNER: opts.owner || null,
    flash: (i, w) => flashes.push(w), fromMenu() {}, openStorage() {},
    otherCounters: async () => opts.others || [],
    shopLs: (k) => k + '@x',
  };
  ctx.ls = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = String(v); return true; } };
  vm.createContext(ctx);
  ['function appSessionRead(', 'function appSessionClaims(', 'function appSessionHandoff(', 'function tillFixed(', 'function keyShopHeld(', 'async function tillParkedSay('].forEach((s) => vm.runInContext(fn(s), ctx));
  return { ctx, store, flashes };
}
const run = (w, code) => vm.runInContext(code, w.ctx);
const sess = (ent) => JSON.stringify({ token: tok(ent), role: 'entity', name: 'Shop ' + ent, entityId: ent });

(async () => {
  console.log('\ntill-bind · the counter follows the shop signed in now\n');
  await it('T1 person A on the device, app signed in as B -> the hand-over to B is offered', () => {
    const w = world({ ls: { cb_sess: sess('B') }, person: { token: 't', entity_id: 'A' } });
    const h = run(w, 'appSessionHandoff(CloudHost.person, keyShopHeld())');
    assert.ok(h && h.idn.entity_id === 'B' && h.token, 'no hand-over for shop B');
  });
  await it('T1 a key for A (not fixed, marker A), app signed in as B -> hand-over offered; the key is left untouched', () => {
    const w = world({ key: 'k-A', ls: { cb_sess: sess('B'), 'cb_till_shop@x': 'A' } });
    assert.strictEqual(run(w, 'tillFixed()'), false);
    const h = run(w, 'appSessionHandoff(CloudHost.person, keyShopHeld())');
    assert.ok(h && h.idn.entity_id === 'B', 'no hand-over for shop B');
    assert.strictEqual(w.ctx.CloudHost.key, 'k-A');
  });
  await it('T1 a key that already opens B, app signed in as B -> no hand-over (the key store keeps its bills)', () => {
    const w = world({ key: 'k-B', ls: { cb_sess: sess('B'), 'cb_till_shop@x': 'B' } });
    assert.strictEqual(run(w, 'appSessionHandoff(CloudHost.person, keyShopHeld())'), null);
  });
  await it('T1 a key whose shop is not known -> no shop named, so nothing is guessed', () => {
    const w = world({ key: 'k-?', ls: { cb_sess: sess('B') } });
    assert.strictEqual(run(w, 'keyShopHeld()'), '');
  });
  await it('T2 A\'s unsent sale parked: the notice shows once with the count; B\'s own store and a moved copy are not counted', async () => {
    const w = world({ owner: 'B', others: [{ name: 'cb-till-A', owner: 'A', queue: 2 }, { name: 'cb-till-A2', owner: 'A', queue: 5, moved: { to: 'x' } }, { name: 'cb-till-B2', owner: 'B', queue: 3 }] });
    const n = await run(w, 'tillParkedSay()');
    assert.strictEqual(n, 2); assert.strictEqual(w.flashes.length, 1);
    assert.ok(/2 unsent sale\(s\) from another shop are parked/.test(w.flashes[0]) && /not sent here/.test(w.flashes[0]), w.flashes[0]);
  });
  await it('T2 nothing parked -> no line', async () => {
    const w = world({ owner: 'B', others: [{ name: 'cb-till-A', owner: 'A', queue: 0 }] });
    assert.strictEqual(await run(w, 'tillParkedSay()'), 0); assert.strictEqual(w.flashes.length, 0);
  });
  await it('T2 B never posts A\'s sale: a person store is per shop, and drain refuses a row stamped for another shop', () => {
    assert.ok(/String\(bill\._shop\) !== String\(OWNER\)\) \{\s*FOREIGN\+\+/.test(PAGE), 'the foreign-row gate in drain is gone');
    assert.ok(/'cb-till-' \+ String\(CloudHost\.person\.entity_id\)/.test(fn('function tillStore(')), 'a person store is no longer per shop');
    assert.ok(/tillParkedSay\(\)/.test(fn('async function load(')), 'load() does not say what is parked');
  });
  await it('T3 a fixed counter keeps its lock: the flag is written only by becomeShop for a fixed key, and pickHost respects it', () => {
    const w = world({ key: 'k-A', ls: { cb_till_fixed: '1', cb_sess: sess('B'), 'cb_till_shop@x': 'A' } });
    assert.strictEqual(run(w, 'tillFixed()'), true);
    const ph = fn('async function spendAppSession('), bs = fn('async function becomeShop(');
    assert.ok(/if \(!CloudHost\.key \|\| !tillFixed\(\)\) \{/.test(ph), 'pickHost spends the app session over a fixed counter');
    assert.ok(/if \(key && to\.fixed\) ls\.set\('cb_till_fixed', '1'\)/.test(bs), 'becomeShop does not set the flag for fixed');
    const addr = fn('async function takeKeyFromAddress(');
    assert.ok(/fixed: wantFixed/.test(addr) && /hv\('fixed'\) === '1'/.test(addr), 'the address flag is not read');
    assert.strictEqual(PAGE.split("ls.set('cb_till_fixed'").length - 1, 1, 'more than one writer of the flag');
  });
  console.log('\n' + pass + ' passed' + (process.exitCode ? ', some FAILED' : ''));
})();
