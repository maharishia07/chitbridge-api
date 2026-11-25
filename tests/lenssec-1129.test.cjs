#!/usr/bin/env node
/**
 * lenssec-1129.test.cjs — the security-lens review fixes of batch 1129 (walks/reviews/L-sec-*.md, VERIFY-lens-sec-2026-11-21.md).
 * FINDINGS  L-sec-network-01#L32 (client built/invited receipts dropped, builtPaths created_by) · LENS-SEC network-01 F1 (retest 1130 names the register id for the coverage map)
 *
 * OWNS      the proof of four fixes, each red on the parent commit:
 *           1 network-design: a `built`/`invited` receipt the CLIENT sends is dropped (receiptsOnly); builtPaths reads only stores this operator minted (created_by)
 *           2 supplies: the four write routes carry access.writeGate (a viewer or commenter seat is refused, 403 read_only/comment_only)
 *           3 attachments: a viewer seat's upload is refused by viewerGate; an editor and the owner pass
 *           4 money-check resolve: credit_note:/reissued: must name a bill of THIS shop that is not the sale itself
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      stand-in db → the real helpers and routers → asserts.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ' — ' + (e && e.message)); }
}

const run = require(path.join(API, 'lib', 'network-build-run.js'));
const access = require(path.join(API, 'lib', 'access.js'));

(async () => {
  await t('1a · a forged built receipt from the client is dropped, a saved one is kept by key', () => {
    const saved = [{ key: 'a', built: { bridge_id: 'CBREAL001', user_id: 'mine' } }, { key: 'b', invited: { to: 'x' } }];
    const sent = [
      { key: 'a', name: 'A' },
      { key: 'b', name: 'B' },
      { key: 'c', name: 'C', built: { bridge_id: 'CBVICTIM1', user_id: 'x' } },
      { key: 'a2', name: 'A2', invited: { to: 'y' }, built: { bridge_id: 'CBVICTIM2', user_id: 'y' } }
    ];
    const out = run.receiptsOnly(saved, sent);
    assert.deepStrictEqual(out[0].built, { bridge_id: 'CBREAL001', user_id: 'mine' });
    assert.deepStrictEqual(out[1].invited, { to: 'x' });
    assert.strictEqual(out[2].built, undefined, 'forged receipt on a new node');
    assert.strictEqual(out[3].built, undefined);
    assert.strictEqual(out[3].invited, undefined);
    assert.strictEqual(run.receiptsOnly(null, [{ key: 'z', built: { bridge_id: 'V' } }])[0].built, undefined);
  });

  await t('1b · builtPaths asks only for stores created_by the caller', async () => {
    let sql = '', params = null;
    const db = { query: async (s, p) => { sql = s; params = p; return { rows: [{ bridge_id: 'CBMINE001', path: 'root.mine' }] }; } };
    const m = await run.builtPaths(db, { skip: [{ key: 'k1', bridge_id: 'CBMINE001' }, { key: 'k2', bridge_id: 'CBVICTIM1' }] }, 'me-id');
    assert.ok(/created_by\s*=\s*\$2/.test(sql), 'ownership in the WHERE: ' + sql);
    assert.deepStrictEqual(params, [['CBMINE001', 'CBVICTIM1'], 'me-id']);
    assert.strictEqual(m.get('k1'), 'root.mine');
    assert.strictEqual(m.has('k2'), false, 'a store the caller did not mint gives no path to hang children on');
  });

  const gateOf = (router, method, p) => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.ok(layer, method + ' ' + p + ' exists');
    return layer.route.stack.map((s) => s.handle);
  };

  await t('2 · the four supplies writes carry access.writeGate', () => {
    const r = require(path.join(API, 'routes', 'supplies.js'));
    for (const [m, p] of [['post', '/'], ['patch', '/:id'], ['post', '/purchase'], ['post', '/:id/issue']]) {
      assert.ok(gateOf(r, m, p).includes(access.writeGate), m + ' ' + p + ' has no writeGate');
    }
  });

  await t('3 · attachments: a viewer upload is refused 403, editor and owner pass', async () => {
    const r = require(path.join(API, 'routes', 'attachments.js'));
    const gate = gateOf(r, 'post', '/').find((h) => h.name === 'viewerGate');
    assert.ok(gate, 'viewerGate on POST /');
    const go = (req) => new Promise((resolve) => {
      const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json() { resolve('refused ' + this.statusCode); return this; }, send() { resolve('refused ' + this.statusCode); return this; }, end() { resolve('refused ' + this.statusCode); } };
      gate(req, res, () => resolve('next'));
    });
    assert.ok(/^refused 403/.test(await go({ identity: { identity_type: 'actor', parent_entity_id: 'E1', access_level: 'viewer' }, headers: {}, get() { return ''; } })), 'viewer refused');
    assert.strictEqual(await go({ identity: { identity_type: 'actor', parent_entity_id: 'E1', access_level: 'editor' }, headers: {}, get() { return ''; } }), 'next');
    assert.strictEqual(await go({ identity: { identity_type: 'entity' }, headers: {}, get() { return ''; } }), 'next');
  });

  await t('4 · resolve: an invented or own-id credit note is refused; one of this shop passes', async () => {
    const dbPath = require.resolve(path.join(API, 'db'));
    const storePath = require.resolve(path.join(API, 'lib', 'books-store.js'));
    const real = { db: require.cache[dbPath], store: require.cache[storePath] };
    const SALE = '11111111-1111-4111-8111-111111111111', NOTE = '22222222-2222-4222-8222-222222222222', GHOST = '33333333-3333-4333-8333-333333333333';
    const logged = [];
    const bills = new Set([SALE, NOTE]);
    const db = { query: async (s, p) => ({ rows: bills.has(p[1]) ? [{ '?column?': 1 }] : [] }) };
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (e, fn) => fn(db), query: async () => ({ rows: [] }) } };
    require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { moneyOverrideState: async () => ({ held: true, resolved: false }), logChange: async (d, e, row) => { logged.push(row); } } };
    try {
      delete require.cache[require.resolve(path.join(API, 'lib', 'money-check.js'))];
      const mc = require(path.join(API, 'lib', 'money-check.js'));
      await assert.rejects(mc.resolve('E1', SALE, { how: 'credit_note:' + GHOST }, 'u'), /not one of this shop/);
      await assert.rejects(mc.resolve('E1', SALE, { how: 'reissued:' + SALE }, 'u'), /not one of this shop/);
      assert.strictEqual(logged.length, 0, 'nothing was logged for a refused way');
      const ok = await mc.resolve('E1', SALE, { how: 'credit_note:' + NOTE }, 'u');
      assert.strictEqual(ok.resolved, true);
      assert.strictEqual(logged.length, 1);
    } finally {
      for (const [k, p] of [['db', dbPath], ['store', storePath]]) { if (real[k]) require.cache[p] = real[k]; else delete require.cache[p]; }
      delete require.cache[require.resolve(path.join(API, 'lib', 'money-check.js'))];
    }
  });

  console.log(failed ? failed + ' FAILED' : 'all ok (5 checks)');
  process.exit(failed ? 1 : 0);
})();
