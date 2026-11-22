/**
 * tests/lv-counter-1129.test.cjs - LV-09, LV-11 and the claim orphan (lens-verify 2026-11-22, lane fixLVcounter).
 * HAND FIGURES (written before the code):
 *   H1  counter C1 period 2026 next 41; a bill seq 40 -> mark stays 41; seq 41 -> next 42; seq 9000 (past the 5000 window) -> stays 42, not moved
 *   H2  clock a year ahead: the bill says period 2027 while the server clock is 2026-11-22 -> period and next unchanged; last_at and hw_at are never the till clock
 *   H3  period 2025 (older) bill on a 2026 counter -> unchanged; period 2027 at server 2027-01-01 (valid) -> moves to 2027, next = seq + 1
 *   H4  AE: till C1 holds block 51..100; its printed number 77 may move the mark (next 78); number 400 (outside every block of C1) does not
 *   H5  closeLease: lease of till C2 closed by a key of C1 -> 403 LEASE_NOT_YOUR_COUNTER, nothing written; by C2 -> closed; by the owner -> closed; no holder named -> refused
 *   H6  claim(): the write of key + counter FAILS after the key was minted -> the minted key is closed (till.closed_at) and the error still thrown;
 *       the open route does the same through abandonMinted, and its pending hold is freed
 * Run: node tests/lv-counter-1129.test.cjs   (no database: stand-ins in the require cache)
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(API, rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const world = { counter: null, leases: [], keyPatches: [], failWrite: false };
const fakeDb = {
  async query(sql, params) {
    if (/FROM till_invoice_lease/.test(sql)) return { rows: world.leases.filter((lease) => lease.till_id === params[1]) };
    if (/policy_flags->'counters'->\$2/.test(sql)) return { rows: [{ c: world.counter }] };
    if (/SELECT policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: { counters: { C1: world.counter || {} }, api_keys: [] } }] };
    return { rows: [] };
  }
};
stub('db/index.js', { query: async () => ({ rows: [] }), withTransaction: async (fn) => fn(fakeDb) });
stub('lib/policy.js', {
  patchKey: async (db, entity, keyPath, patch) => {
    const binding = patch.held_by && !String(patch.held_by).startsWith('pending:');
    if (world.failWrite && binding) throw new Error('write failed');
    Object.assign(world.counter, patch);
  }
});
stub('lib/schema.js', { hasTable: async () => true });
stub('middleware/auth.js', { forgetKey: () => {} });
stub('lib/api-keys.js', {
  isClosed: (key) => !!(key && key.till && key.till.closed_at),
  mint: async () => ({ jti: 'K1', key: 'secret' }),
  patchKeyWith: async (db, entity, jti, patch) => { world.keyPatches.push({ jti, patch }); }
});
const store = require('../lib/counters-store');
const lease = require('../lib/invoice-lease');

let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e));
  }
};
const reset = (record) => {
  world.counter = Object.assign({ id: 'C1', period: '2026', next: 41, hw_at: '2026-11-01T00:00:00.000Z' }, record);
  world.leases = [];
  world.keyPatches = [];
  world.failWrite = false;
};
const AT = (iso) => ({ now: () => new Date(iso) });
const ISSUER = 'e1';
const NOON = '2026-11-22T10:00:00Z';

(async () => {
  await t('H1 a forged seq outside the window is refused; honest ones move the mark', async () => {
    reset();
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 40 }, null, 'C1/0040', AT(NOON));
    assert.strictEqual(world.counter.next, 41);
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 41 }, null, 'C1/0041', AT(NOON));
    assert.strictEqual(world.counter.next, 42);
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 9000 }, null, 'C1/9000', AT(NOON));
    assert.strictEqual(world.counter.next, 42);
  });
  await t('H2 a clock a year ahead does not move the mark, and the till clock is never written', async () => {
    reset();
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2027', seq: 3 }, '2027-11-22T10:00:00Z', 'C1/0003', AT(NOON));
    assert.strictEqual(world.counter.period, '2026');
    assert.strictEqual(world.counter.next, 41);
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 41 }, '2031-01-01T00:00:00Z', 'C1/0041', AT(NOON));
    assert.strictEqual(world.counter.hw_at, '2026-11-22T10:00:00.000Z');
    assert.strictEqual(world.counter.last_at, '2026-11-22T10:00:00.000Z');
  });
  await t('H3 an older period never moves it back; a real new year moves it forward', async () => {
    reset();
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2025', seq: 2 }, null, 'C1/0002', AT(NOON));
    assert.strictEqual(world.counter.period, '2026');
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2027', seq: 5 }, null, 'C1/0005', AT('2027-01-01T08:00:00Z'));
    assert.strictEqual(world.counter.period, '2027');
    assert.strictEqual(world.counter.next, 6);
  });
  await t('H4 a leased till: a number inside its block moves the mark, one outside does not', async () => {
    reset();
    world.leases = [{ till_id: 'C1', first_no: 51, last_no: 100 }];
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 77 }, null, '77', AT(NOON));
    assert.strictEqual(world.counter.next, 78);
    await store.noteBill(ISSUER, { prefix: 'C1', period: '2026', seq: 400 }, null, '400', AT(NOON));
    assert.strictEqual(world.counter.next, 78);
  });

  const row = { lease_id: 'L1', till_id: 'C2', first_no: 1, last_no: 5, expires_at: '2027-01-01', closed_at: null, unused_json: [] };
  const leaseDb = () => {
    const writes = [];
    return {
      writes,
      async query(sql, params) {
        if (/^SELECT lease_id/.test(sql)) return { rows: [row] };
        if (/^UPDATE/.test(sql)) writes.push(params);
        return { rows: [] };
      }
    };
  };
  await t('H5 another till cannot close the lease; the holder and the owner can; nobody named is refused', async () => {
    let db = leaseDb();
    await assert.rejects(
      lease.closeLease(db, ISSUER, { lease_id: 'L1', unused: [], by: { owner: false, till_id: 'C1' } }, 'n'),
      (e) => e.status === 403 && e.code === 'LEASE_NOT_YOUR_COUNTER' && /another counter/.test(e.message)
    );
    assert.strictEqual(db.writes.length, 0);
    db = leaseDb();
    assert.ok((await lease.closeLease(db, ISSUER, { lease_id: 'L1', unused: [], by: { owner: false, till_id: 'c2' } }, 'n')).closed);
    db = leaseDb();
    assert.ok((await lease.closeLease(db, ISSUER, { lease_id: 'L1', unused: [], by: { owner: true } }, 'n')).closed);
    db = leaseDb();
    await assert.rejects(lease.closeLease(db, ISSUER, { lease_id: 'L1', unused: [] }, 'n'), (e) => e.code === 'LEASE_NOT_YOUR_COUNTER');
  });

  await t('H6 a failed claim write leaves no live minted key', async () => {
    reset({ held_by: null });
    world.failWrite = true;
    await assert.rejects(store.claim({ entity_id: ISSUER, identity: {}, id: 'C1', label: 'x', takeover: false }), /write failed/);
    assert.ok(world.keyPatches.find((p) => p.jti === 'K1' && p.patch.till && p.patch.till.closed_at), 'the minted key was not closed');
  });
  await t('H6b the open route frees its pending hold and closes the key (abandonMinted)', async () => {
    reset({ held_by: 'pending:abc' });
    await store.abandonMinted(ISSUER, { jti: 'K1' }, 'C1', 'pending:abc');
    assert.ok(world.keyPatches.some((p) => p.patch.till.closed_at));
    assert.strictEqual(world.counter.held_by, null);
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
  process.exit(fail ? 1 : 0);
})();
