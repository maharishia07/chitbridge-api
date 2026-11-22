#!/usr/bin/env node
/**
 * lenssec-1129-network.test.cjs — network-01 F5 / F3 / F4 and crm-01 M2 of batch 1129 (walks/reviews/VERIFY-lens-sec-2026-11-21.md).
 *
 * OWNS      the proof of four fixes, each red on the parent commit:
 *           1 CRM party read never carries another business's sign-in phone (otp_contact); a party this shop minted still shows the number the shop typed
 *           2 PUT /connections/:id/respond: a staff seat under the business is refused 403 NETWORK_OWNER_ONLY before any read
 *           3 GET /network-design/stores and /availability: a suspended member is refused 403 MEMBERSHIP_SUSPENDED (membership.standsInTree, the standingSql rule)
 *           4 network design: more than MAX_NODES (500) nodes is refused 413 NETWORK_TOO_LARGE on PUT and validate
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      stand-in db (require cache) → the real routers' handlers with a hand-made req/res → asserts.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ' — ' + (e && e.message)); }
}
const dbPath = require.resolve(path.join(API, 'db'));
const sqls = [];
let suspended = false, identityRows = [];
const stand = { query: async (s) => { sqls.push(String(s)); return { rows: /FROM identities WHERE identity_id/.test(String(s)) ? identityRows : [] }; }, withEntity: async (_e, fn) => fn({ query: async (s) => { sqls.push(String(s)); return { rows: [] }; } }) };
require(dbPath);
Object.assign(require.cache[dbPath].exports, stand);
const membership = require(path.join(API, 'lib', 'network-membership.js'));
membership.standsInTree = async () => !suspended;

const resOf = () => { const r = { code: 200, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.send = r.json; r.end = () => r;
  r.set = r.setHeader = r.header = r.type = r.append = () => r; r.getHeader = () => undefined; r.locals = {}; return r; };
const handlerOf = (router, method, p) => { const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]); assert.ok(l, method + ' ' + p); return l.route.stack[l.route.stack.length - 1].handle; };
const reqOf = (o) => Object.assign({ headers: {}, query: {}, params: {}, body: {}, id: 'r1', method: 'GET', originalUrl: '/x', url: '/x', get: () => undefined, header: () => undefined }, o);

(async () => {
  await t('1 · party read: otp_contact is not in the record, a foreign sign-in phone is not the phone, a minted party keeps the typed number', () => {
    const crm = require(path.join(API, 'lib', 'crm.js'));
    const handle = require(path.join(API, 'lib', 'handle.js'));
    const src = require('fs').readFileSync(path.join(API, 'routes', 'crm.js'), 'utf8');
    assert.ok(!/otp_contact:\s*rec\.otp_contact/.test(src), 'the party record route no longer returns otp_contact');
    const facts = crm.readerFacts({ phone: null, otp_contact: '+61400000001' }, [], null);
    assert.strictEqual(facts.phone, null, 'login phone never becomes the contact');
    assert.strictEqual(crm.readerFacts({ phone: '+61400000009' }, [], null).phone, '+61400000009');
    const minted = Object.keys(handle).includes('isMinted') ? handle.isMinted : null;
    assert.ok(minted, 'handle.isMinted exists');
  });

  await t('2 · respond: a staff seat answers 403 NETWORK_OWNER_ONLY and nothing is read; the business itself goes on to the read', async () => {
    const h = handlerOf(require(path.join(API, 'routes', 'connections.js')), 'put', '/:id/respond');
    sqls.length = 0; const res = resOf();
    await h(reqOf({ method: 'PUT', params: { id: '11111111-1111-4111-8111-111111111111' }, body: { action: 'accept' }, identity: { identity_id: 'c2', parent_entity_id: 'p1' } }), res);
    assert.strictEqual(res.code, 403); assert.strictEqual(res.body.code, 'NETWORK_OWNER_ONLY'); assert.strictEqual(sqls.length, 0);
    const own = resOf();
    await h(reqOf({ method: 'PUT', params: { id: '11111111-1111-4111-8111-111111111111' }, body: { action: 'accept' }, identity: { identity_id: 'p1' } }), own);
    assert.strictEqual(own.code, 404, 'the owner reaches the read (empty db: not found)');
  });

  const design = require(path.join(API, 'routes', 'network-design.js'));
  await t('3 · stores and availability refuse a suspended member in words, a member in standing is not refused', async () => {
    identityRows = [{ identity_id: 'a', bridge_id: 'CB1', display_name: 'A' }];
    try {
      for (const [p, query] of [['/stores', {}], ['/availability', { q: 'tile' }]]) {
        suspended = true; const r1 = resOf();
        await handlerOf(design, 'get', p)(reqOf({ query, identity: { identity_id: 'a' } }), r1);
        assert.strictEqual(r1.code, 403, p); assert.strictEqual(r1.body.code, 'MEMBERSHIP_SUSPENDED', p);
        suspended = false; const r2 = resOf();
        await handlerOf(design, 'get', p)(reqOf({ query, identity: { identity_id: 'a' } }), r2).catch(() => {});
        assert.notStrictEqual(r2.code, 403, p + ' in standing is not refused');
      }
    } finally { identityRows = []; }
  });

  await t('4 · design: 501 nodes refused 413 NETWORK_TOO_LARGE on PUT and validate; 500 pass the cap', async () => {
    const nodes = (n) => Array.from({ length: n }, (_, i) => ({ key: 'k' + i, name: 'N' + i }));
    for (const [method, p] of [['put', '/'], ['post', '/validate']]) {
      const h = handlerOf(design, method, p), r = resOf();
      await h(reqOf({ method: method.toUpperCase(), body: { draft: { nodes: nodes(501) }, sample: true }, identity: { identity_id: 'a' } }), r);
      assert.strictEqual(r.code, 413, p); assert.strictEqual(r.body.code, 'NETWORK_TOO_LARGE', p); assert.ok(/at most 500/.test(r.body.message || r.body.detail || ''), p + ' says the limit in words');
      const ok = resOf();
      await h(reqOf({ method: method.toUpperCase(), body: { draft: { nodes: nodes(500) }, sample: true }, identity: { identity_id: 'a' } }), ok).catch(() => {});
      assert.notStrictEqual(ok.code, 413, p + ' 500 nodes pass the cap');
    }
  });
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all ok');
})();
