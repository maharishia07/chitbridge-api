/**
 * tests/pay-fix-delivery.test.cjs — PAY-FIX H6: a retried goods-in / despatch / online-order delivery lands ONCE.
 * The queue row's client_ref reaches chit_line_event (b730's 12th argument, ON CONFLICT DO NOTHING); a replay inserts 0 rows and is
 * answered `replayed: true`. Before b730 runs (no client_ref column) the rows go in keyless, as they always did.
 * Offline: db and schema are stubs; the stub "database" holds the unique index as a Set. Run: node tests/pay-fix-delivery.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };

let migrated = true; const seen = new Set(); let inserted = 0; const sqls = [];
const db = { query: async (sql, p) => {
  sqls.push(sql);
  /* RAIL-133 (c): every line asked about is on this chit */
  if (/line_id::text = ANY/.test(sql)) return { rows: p[2].map((line_id) => ({ line_id })) };
  if (/chit_line_event/.test(sql)) {
    const ref = migrated ? p[11] : null, key = ref && p[0] + '|' + p[1] + '|' + ref;
    if (key && seen.has(key)) return { rows: [{ copies: 0 }] };
    if (key) seen.add(key); inserted++; return { rows: [{ copies: 2 }] };
  }
  if (/identities/.test(sql)) return { rows: [{ display_name: 'Shop' }] };
  if (/INSERT INTO chit_line_delivery/.test(sql)) {
    const ref = migrated ? p[13] : null, key = ref && 'priv|' + p[0] + '|' + p[12] + '|' + ref;
    if (key && seen.has(key)) return { rowCount: 0, rows: [] };
    if (key) seen.add(key); inserted++; return { rowCount: 1, rows: [] };
  }
  return { rows: [] };
} };
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db/index.js', { withEntity: async (e, fn) => fn(db), onEntity: async (e, d, fn) => fn(db) });
stub('lib/schema.js', { hasColumn: async () => migrated });
const D = require(path.join(API, 'lib', 'deliverline'));
const CHIT = 'c0000000-0000-4000-8000-000000000001', LINE = 'a0000000-0000-4000-8000-000000000001';
const rows = (ref) => [{ line_id: LINE, quantity: 6, reference: 'GRN/1', ...(ref ? { client_ref: ref } : {}) }];

(async () => {
  await ita('H6 · the same queue row sent twice records the quantity ONCE and the replay says so', async () => {
    const first = await D.record('shop', CHIT, rows('q7:0'), {}), again = await D.record('shop', CHIT, rows('q7:0'), {});
    assert.strictEqual(inserted, 1); assert.ok(!first.delivered[0].replayed); assert.strictEqual(again.delivered[0].replayed, true);
  });
  await ita('H6 · "6 then 4" under one GRN reference are two real deliveries (different keys)', async () => {
    inserted = 0; await D.record('shop', CHIT, rows('q8:0'), {}); await D.record('shop', CHIT, rows('q8:1'), {});
    assert.strictEqual(inserted, 2);
  });
  await ita('H6 · my-copy-only (a bill) path is idempotent too', async () => {
    inserted = 0; await D.record('shop', CHIT, rows('q9:0'), { private: true }); const again = await D.record('shop', CHIT, rows('q9:0'), { private: true });
    assert.strictEqual(inserted, 1); assert.strictEqual(again.delivered[0].replayed, true);
  });
  await ita('H6 · an old client (no client_ref) keeps today\'s behaviour: every send records', async () => {
    inserted = 0; await D.record('shop', CHIT, rows(), {}); await D.record('shop', CHIT, rows(), {});
    assert.strictEqual(inserted, 2);
  });
  await ita('H6 · before b730 runs, nothing breaks: the 11-argument door, no key column named', async () => {
    migrated = false; sqls.length = 0; inserted = 0;
    await D.record('shop', CHIT, rows('q1:0'), {}); await D.record('shop', CHIT, rows('q1:0'), { private: true });
    assert.ok(sqls.every((q) => !/client_ref|\$12::text/.test(q)), 'no SQL mentions the missing column'); assert.strictEqual(inserted, 2);
  });
  console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
