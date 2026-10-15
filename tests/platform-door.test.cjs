'use strict';
/**
 * tests/platform-door.test.cjs — THE PLATFORM ROLE IS ONE DOOR (W1-SET · GOV2, 2026-10-15).
 *
 * "Only the platform role may register a platform source." POST /api/governance/source minted a PLATFORM entity (lib/source.js:
 * owner_scope 'platform') for any signed-in shop — the comment above it said "production would gate this". The same test,
 * `req.identity.owner_scope !== 'platform'`, was spelled inline three more times (governance create · re-attest · entities erase).
 *
 * ⭐ ONE DOOR: lib/platformroot.isPlatform(req) = a platform-scoped login OR the root entity (the operator — lib/testboard already
 * calls the root "the platform role"); refuseUnlessPlatform(req, res) answers 403 { code: 'NOT_PLATFORM', may, why, message } and
 * the route touches nothing first. The SERVER decides; the screen branches on the code, never on the sentence.
 *
 * Run: node tests/platform-door.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/** comments blanked, so a rule named in prose never counts as code */
const code = (file) => fs.readFileSync(path.join(API, file), 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
/** the handler body of `router.<verb>('<route>'` — up to the next router line */
function handler(src, verb, route) {
  const at = src.indexOf('router.' + verb + "('" + route + "'");
  assert.ok(at >= 0, verb.toUpperCase() + ' ' + route + ' is gone');
  const next = src.indexOf('\nrouter.', at + 1);
  return src.slice(at, next < 0 ? src.length : next);
}

console.log('\nTHE ROUTES ASK THE ONE DOOR, BEFORE ANY READ OR WRITE\n');
const GOV = code('routes/governance.js'), ENT = code('routes/entities.js');
const GATED = [[GOV, 'post', '/source', "require('../lib/source')"], [GOV, 'post', '/entities', 'loadActiveConstitution('],
  [GOV, 'post', '/entities/:id/reattest', 'query('], [ENT, 'patch', '/:id/erase', 'query(']];
for (const [src, verb, route, firstTouch] of GATED) {
  it('⚠️⚠️ ' + verb.toUpperCase() + ' ' + route + ' refuses a non-platform caller before it touches anything', () => {
    const body = handler(src, verb, route);
    const gate = body.indexOf('refuseUnlessPlatform(req, res)');
    assert.ok(gate > 0, 'no refuseUnlessPlatform in the handler');
    const touch = body.indexOf(firstTouch);
    assert.ok(touch < 0 || touch > gate, 'the handler reaches ' + firstTouch + ' at ' + touch + ', the door is asked at ' + gate);
  });
}
it('no inline owner_scope test is left in a route (one door, one name)', () => {
  const hits = [];
  for (const f of fs.readdirSync(path.join(API, 'routes'))) if (/owner_scope\s*[!=]==?\s*'platform'/.test(code('routes/' + f))) hits.push(f);
  assert.deepStrictEqual(hits, [], 'a route still spells the platform test itself: ' + hits.join(', '));
});

console.log('\nTHE DOOR ITSELF — lib/platformroot.isPlatform / refuseUnlessPlatform\n');
/** reload platformroot under a given root (it reads PLATFORM_ROOT_ENTITY at require time) */
function fresh(rootId) {
  const prev = process.env.PLATFORM_ROOT_ENTITY;
  if (rootId) process.env.PLATFORM_ROOT_ENTITY = rootId; else delete process.env.PLATFORM_ROOT_ENTITY;
  delete require.cache[require.resolve(path.join(API, 'lib', 'platformroot.js'))];
  const mod = require(path.join(API, 'lib', 'platformroot.js'));
  if (prev == null) delete process.env.PLATFORM_ROOT_ENTITY; else process.env.PLATFORM_ROOT_ENTITY = prev;
  return mod;
}
/** a stand-in res that remembers the one answer it was given */
function fakeRes() {
  const out = { status: null, body: null };
  out.res = { status(n) { out.status = n; return this; }, json(b) { out.body = b; return this; } };
  return out;
}
const ROOT = '33333333-3333-4333-8333-333333333333', SHOP = '11111111-1111-4111-8111-111111111111', STAFF = '44444444-4444-4444-8444-444444444444';

it('a platform-scoped login holds the role, root configured or not', () => {
  assert.strictEqual(fresh(null).isPlatform({ identity: { identity_id: SHOP, owner_scope: 'platform' } }), true);
  assert.strictEqual(fresh(ROOT).isPlatform({ identity: { identity_id: SHOP, owner_scope: 'platform' } }), true);
});
it('⭐ the root entity holds the role, and so does a co-assist acting for the root', () => {
  const pr = fresh(ROOT);
  assert.strictEqual(pr.isPlatform({ identity: { identity_id: ROOT, owner_scope: 'entity' } }), true);
  assert.strictEqual(pr.isPlatform({ identity: { identity_id: STAFF, parent_entity_id: ROOT, owner_scope: 'actor' } }), true);
});
it('⚠️⚠️ a shop, its staff, an anonymous request and a missing identity are refused — never "maybe"', () => {
  const pr = fresh(ROOT);
  assert.strictEqual(pr.isPlatform({ identity: { identity_id: SHOP, owner_scope: 'entity' } }), false);
  assert.strictEqual(pr.isPlatform({ identity: { identity_id: STAFF, parent_entity_id: SHOP, owner_scope: 'actor' } }), false);
  assert.strictEqual(pr.isPlatform({}), false);
  assert.strictEqual(pr.isPlatform(null), false);
  assert.strictEqual(fresh(null).isPlatform({ identity: { identity_id: ROOT } }), false, 'no root configured must not admit the would-be root');
});
it('the refusal is a 403 with a CODE the screen branches on, the may/why pair, and a sentence — and the door says false', () => {
  const pr = fresh(ROOT), r = fakeRes();
  assert.strictEqual(pr.refuseUnlessPlatform({ identity: { identity_id: SHOP, owner_scope: 'entity' } }, r.res), false);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'NOT_PLATFORM');
  assert.strictEqual(r.body.may, false);
  assert.strictEqual(r.body.why, 'NOT_PLATFORM');
  assert.ok(/platform/i.test(r.body.message) && r.body.message.split(/\s+/).length <= 20, 'the sentence is missing or over the 20-word budget');
});
it('an admitted caller gets no answer written (the route goes on)', () => {
  const pr = fresh(ROOT), r = fakeRes();
  assert.strictEqual(pr.refuseUnlessPlatform({ identity: { identity_id: ROOT } }, r.res), true);
  assert.strictEqual(r.status, null);
});

console.log('\n  ' + pass + ' passed' + (process.exitCode ? ' · FAILURES above' : '') + '\n');
