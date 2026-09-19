'use strict';
/**
 * till-shop-folder.test.js — ONE FOLDER PER SHOP, PER SERVER ([TILL-120]).
 *
 * ── ⭐⭐⭐ WHAT ATHI ASKED FOR ────────────────────────────────────────────────────────────────────────────────
 *
 * *"can you create a separate directory for the counter app and for each shop there can be a folder in the name
 * of entity id or bridge id, in that way we can distinguish, this cannot be mixed?"*
 *
 * and, a few minutes later, the half that is easy to miss:
 *
 * *"each should sit separately in the system irrespective of the sandbox environment, you may be doing in the
 * test, i would have created shop in live"*
 *
 * ── ⚠️⚠️ WHAT IT WAS BEFORE ─────────────────────────────────────────────────────────────────────────────────
 *
 * `const DIR = path.join(path.dirname(cfgFile), 'till-data')` — ONE folder, for whatever key happened to be in
 * connector.json. Re-point the kit at a second shop and that shop opened the FIRST one's snapshot, its bill
 * series, its day's bills — and its UNSENT QUEUE, which would then be posted under the new shop's key. The
 * browser half has been namespaced by key since [ISO-01]; the desktop half, which is the one that actually
 * holds the money, never was.
 *
 * ⭐ THE NAME COMES OFF THE KEY, NOT OFF THE NETWORK — routes/keys.js:88 puts bridge_id in the token — so a
 * counter can pick its folder at boot with the line down, which is the only timing that works here.
 *
 * Run: node tests/till-shop-folder.test.js   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/**
 * ⚠️ THE SHIPPED FUNCTIONS, NOT COPIES OF THEM. till.js is a program, not a module, so each function is lifted
 * out of the source and evaluated — the same trick till-agent-says.test.js uses, and for the same reason: a
 * guard holding its own copy of the logic passes forever after the real one changes.
 */
function lift(name) {
  const at = SRC.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' is gone from till.js — this guard is measuring nothing');
  const end = SRC.indexOf('\n}', at) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(SRC.slice(at, end) + '; return ' + name + ';')();
}
const keyShop = lift('keyShop');
const serverFolder = lift('serverFolder');
/* shopFolder calls keyShop, so it is given it rather than being lifted alone */
const shopFolder = (function () {
  const at = SRC.indexOf('function shopFolder(');
  assert.ok(at > 0, 'shopFolder is gone from till.js');
  const end = SRC.indexOf('\n}', at) + 2;
  // eslint-disable-next-line no-new-func
  return new Function('keyShop', SRC.slice(at, end) + '; return shopFolder;')(keyShop);
})();

/** a token shaped exactly like routes/keys.js mints one — header.payload.signature, base64url */
function token(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload) + '.' + 'notasignature';
}

console.log('\nONE FOLDER PER SHOP ([TILL-120])\n');

it('the folder is the bridge_id, which is the name a person can read', () => {
  assert.strictEqual(shopFolder(token({ bridge_id: 'CB-4K2P9', identity_id: 'uuid-1' })), 'CB-4K2P9');
});

it('no bridge_id falls back to the entity id rather than to a hash', () => {
  assert.strictEqual(shopFolder(token({ identity_id: 'abc-123' })), 'abc-123');
});

/**
 * ⚠️⚠️ THE ONE THAT MATTERS. Two shops must never land in the same folder, whatever their keys look like —
 * this is the whole reason the change exists.
 */
it('TWO SHOPS NEVER SHARE A FOLDER', () => {
  const a = shopFolder(token({ bridge_id: 'CB-AAAAA', identity_id: 'u1' }));
  const b = shopFolder(token({ bridge_id: 'CB-BBBBB', identity_id: 'u2' }));
  assert.notStrictEqual(a, b, 'two shops resolved to the same folder — bills would mix');
});

it('two keys for the SAME shop share it — a re-issued key is the same shop, not a new one', () => {
  const a = shopFolder(token({ bridge_id: 'CB-SAME', identity_id: 'u1', jti: 'first' }));
  const b = shopFolder(token({ bridge_id: 'CB-SAME', identity_id: 'u1', jti: 'second' }));
  assert.strictEqual(a, b, 're-issuing a key stranded the shop history in the old folder');
});

it('no key at all still yields somewhere to write', () => {
  assert.strictEqual(shopFolder(null), '_unpaired');
  assert.strictEqual(shopFolder(''), '_unpaired');
});

/**
 * ⚠️ A FOLDER NAME IS NOT FREE TEXT. The payload is attacker-shaped input in the general case; only a safe
 * alphabet may reach the disk, and `..` must never survive as a traversal.
 */
it('a hostile payload cannot escape the folder', () => {
  const f = shopFolder(token({ bridge_id: '../../../windows/system32' }));
  assert.ok(!f.includes('/') && !f.includes('\\'), 'a separator survived into the folder name: ' + f);
  assert.ok(!/^\.+$/.test(f), 'the folder name is nothing but dots: ' + f);
});

it('a key that is not a JWT still separates shops, just unreadably', () => {
  const a = shopFolder('not-a-jwt-at-all');
  const b = shopFolder('also-not-a-jwt');
  assert.ok(/^key-/.test(a), 'expected the hash fallback, got ' + a);
  assert.notStrictEqual(a, b, 'two unreadable keys collapsed into one folder');
});

console.log('\nTEST AND LIVE ARE TWO WORLDS ([TILL-120])\n');

/**
 * ⚠️⚠️ Athi: *"you may be doing in the test, i would have created shop in live."* A test bill in the live day's
 * takings, or a live bill posted into a sandbox that discards it, is silent either way.
 */
it('THE SAME SHOP ON TEST AND ON LIVE DOES NOT SHARE A TREE', () => {
  const key = token({ bridge_id: 'CB-SAME', identity_id: 'u1' });
  const live = path.join(serverFolder('https://chitbridge-api-production.up.railway.app'), shopFolder(key));
  const test = path.join(serverFolder('http://127.0.0.1:3000'), shopFolder(key));
  assert.notStrictEqual(live, test, 'a test counter and a live counter shared a folder');
});

it('the server folder is the host, and is safe for a disk', () => {
  assert.strictEqual(serverFolder('https://chitbridge-api-production.up.railway.app'),
    'chitbridge-api-production.up.railway.app');
  assert.strictEqual(serverFolder('http://127.0.0.1:3000'), '127.0.0.1-3000');
  const f = serverFolder('https://x/../../etc');
  assert.ok(!f.includes('/') && !f.includes('\\'), 'a separator survived: ' + f);
});

it('no api configured still yields a folder rather than an empty path segment', () => {
  assert.ok(serverFolder(null).length > 0);
  assert.ok(serverFolder('').length > 0);
});

console.log('\nTHE KEY DESCRIBES ITSELF, OFFLINE ([TILL-121])\n');

it('keyShop reads the shop off the token with no network', () => {
  const k = keyShop(token({ bridge_id: 'CB-9', identity_id: 'u9', display_name: 'Anitha Stores', scopes: ['till'] }));
  assert.strictEqual(k.bridge_id, 'CB-9');
  assert.strictEqual(k.name, 'Anitha Stores');
  assert.deepStrictEqual(k.scopes, ['till']);
});

it('keyShop refuses rubbish quietly rather than throwing at boot', () => {
  assert.strictEqual(keyShop('rubbish'), null);
  assert.strictEqual(keyShop(null), null);
});

/**
 * ⚠️⚠️ THE GUARD THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. A source-level check, because the defect was not in
 * a function's behaviour — it was that DIR ignored the key entirely.
 */
console.log('\nTHE SHIPPED PATH ACTUALLY USES THEM\n');

it('DIR is built from the server AND the shop, not from a bare till-data', () => {
  assert.ok(!/const DIR = path\.join\(path\.dirname\(cfgFile\), 'till-data'\);/.test(SRC),
    'DIR is back to one flat till-data folder — every shop on this PC shares it again');
  assert.ok(/const SHOP_DIR = path\.join\(serverFolder\(cfg\.api\), shopFolder\(cfg\.key\)\)/.test(SRC),
    'SHOP_DIR no longer combines the server and the shop');
});

it('/api/state tells the page whether it is paired — the page cannot work it out alone', () => {
  assert.ok(/paired: !!cfg\.key/.test(SRC),
    '/api/state stopped reporting `paired`; the page falls back to HOST.key, which AgentHost has never had');
});

console.log('\n' + pass + ' checks passed\n');
