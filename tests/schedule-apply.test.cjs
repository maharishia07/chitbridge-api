/**
 * CB Catalogue - publish on a date (lib/schedule.js): a change is PARKED with a moment and APPLIED the first time anyone reads after it.
 * Offline: the db, the schema probe and the catalogue writer are stubs; the module under test is the real lib/schedule.js.
 *   applyDue: asks only for THIS shop's rows that are not applied, not cancelled and due; writes each row's own patch through the one writer
 *             (catalogue-write.patchItems, activeOnly); stamps applied_at with how many rows changed; a failed write answers 0, never throws
 *   schedule: a bad moment and an empty patch are refused in words; a good one is inserted for this shop with the patch as JSON
 *   cancel:   only a pending row of this shop; b203 absent: every function answers "not enabled" and touches nothing
 *   diff:     only the keys that changed travel
 * CARD      06-catalogue-pim/schedule-and-availability
 * UNIT      06/Schedule & availability
 * Run: node tests/schedule-apply.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const S = { table: true, due: [], sql: [], failWrite: false, patched: [] };
const db = {
  query: async (sql, p) => {
    S.sql.push({ sql, p });
    if (/^\s*SELECT schedule_id, item_id, patch FROM/.test(sql)) return { rows: S.due };
    if (/^\s*INSERT INTO catalogue_item_schedule/.test(sql)) return { rows: [{ schedule_id: 's1', item_id: p[1], effective_at: p[2], patch: JSON.parse(p[3]), created_at: 'now' }] };
    if (/^\s*UPDATE catalogue_item_schedule SET cancelled_at/.test(sql)) return { rowCount: S.cancelHits === undefined ? 1 : S.cancelHits, rows: [] };
    return { rowCount: 1, rows: [] };
  }
};
stub('db', { withEntity: async (entity, fn) => { S.entity = entity; return fn(db); } });
stub('lib/schema', { hasTable: async () => S.table });
stub('lib/logger', { fellBack: () => {}, warn: () => {}, info: () => {}, error: () => {} });
stub('lib/catalogue-write', { patchItems: async (d, entity, rows, opts) => { if (S.failWrite) throw new Error('write failed'); S.patched.push({ entity, rows, opts }); return { rowCount: 1 }; } });
const SCH = require('../lib/schedule');

let n = 0;
const it = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; throw e; } };
const reset = () => { S.sql = []; S.patched = []; S.due = []; S.failWrite = false; S.table = true; S.cancelHits = undefined; };

(async () => {
  await it('applyDue asks only for this shop, not applied, not cancelled, due now - in moment order', async () => {
    reset(); await SCH.applyDue('E1');
    const q = S.sql.find((x) => /FROM catalogue_item_schedule/.test(x.sql));
    assert.ok(q, 'one probe query');
    assert.deepStrictEqual(q.p, ['E1']);
    for (const frag of ['entity_id = $1', 'applied_at IS NULL', 'cancelled_at IS NULL', 'effective_at <= NOW()', 'ORDER BY effective_at']) assert.ok(q.sql.includes(frag), 'the probe has: ' + frag);
  });
  await it('each due row is written through the one writer as a merge patch, active items only, then stamped applied with the row count', async () => {
    reset(); S.due = [{ schedule_id: 'a', item_id: 'I1', patch: { price: { amount: 120 } } }, { schedule_id: 'b', item_id: 'I2', patch: { desc: 'new' } }];
    const done = await SCH.applyDue('E1');
    assert.strictEqual(done, 2, 'two rows changed');
    assert.deepStrictEqual(S.patched.map((x) => x.rows[0]), [{ item_id: 'I1', merge: { price: { amount: 120 } } }, { item_id: 'I2', merge: { desc: 'new' } }]);
    assert.ok(S.patched.every((x) => x.entity === 'E1' && x.opts.activeOnly === true), "this shop's id, activeOnly");
    const stamps = S.sql.filter((x) => /SET applied_at = NOW\(\), applied_rows = \$2 WHERE schedule_id = \$1/.test(x.sql));
    assert.deepStrictEqual(stamps.map((x) => x.p), [['a', 1], ['b', 1]]);
  });
  await it('nothing due: no write, answers 0', async () => {
    reset(); assert.strictEqual(await SCH.applyDue('E1'), 0); assert.strictEqual(S.patched.length, 0);
  });
  await it('a write that fails answers 0 and never throws (a read must not fail because a parked change could not be applied)', async () => {
    reset(); S.due = [{ schedule_id: 'a', item_id: 'I1', patch: { x: 1 } }]; S.failWrite = true;
    assert.strictEqual(await SCH.applyDue('E1'), 0);
  });
  await it('a caller already inside a transaction passes its client: no second transaction opened', async () => {
    reset(); S.entity = null; await SCH.applyDue('E1', db); assert.strictEqual(S.entity, null, 'withEntity was not called');
  });
  await it('b203 absent: every function says not enabled and touches nothing', async () => {
    reset(); S.table = false;
    assert.strictEqual(await SCH.applyDue('E1'), 0);
    assert.strictEqual((await SCH.schedule('E1', 'I1', '2030-01-01T00:00:00Z', { a: 1 })).error, 'not_enabled');
    assert.deepStrictEqual(await SCH.pending('E1'), []);
    assert.strictEqual(await SCH.cancel('E1', 's1'), false);
    assert.strictEqual(S.sql.length, 0, 'no statement ran');
  });
  await it('schedule: a bad moment is bad_time and an empty or missing patch is empty, nothing inserted', async () => {
    reset();
    assert.strictEqual((await SCH.schedule('E1', 'I1', 'not a date', { a: 1 })).error, 'bad_time');
    assert.strictEqual((await SCH.schedule('E1', 'I1', '2030-01-01T00:00:00Z', {})).error, 'empty');
    assert.strictEqual((await SCH.schedule('E1', 'I1', '2030-01-01T00:00:00Z', null)).error, 'empty');
    assert.ok(!S.sql.some((x) => /INSERT/.test(x.sql)), 'nothing inserted');
  });
  await it('schedule: a good one parks the patch for this shop, the moment as ISO, the patch as JSON, and who made it', async () => {
    reset(); const r = await SCH.schedule('E1', 'I1', '2030-06-01T05:30:00+05:30', { price: { amount: 99 } }, 'U7');
    const ins = S.sql.find((x) => /INSERT INTO catalogue_item_schedule/.test(x.sql));
    assert.deepStrictEqual(ins.p, ['E1', 'I1', '2030-06-01T00:00:00.000Z', '{"price":{"amount":99}}', 'U7']);
    assert.deepStrictEqual(r.row.patch, { price: { amount: 99 } });
    assert.strictEqual(S.entity, 'E1');
  });
  await it('cancel: only a pending row of this shop; true when one was cancelled, false when none', async () => {
    reset(); assert.strictEqual(await SCH.cancel('E1', 's1'), true);
    const u = S.sql.find((x) => /cancelled_at = NOW\(\)/.test(x.sql));
    assert.deepStrictEqual(u.p, ['s1', 'E1']);
    assert.ok(u.sql.includes('applied_at IS NULL') && u.sql.includes('cancelled_at IS NULL') && u.sql.includes('entity_id = $2'));
    S.cancelHits = 0; assert.strictEqual(await SCH.cancel('E1', 'applied-one'), false, 'applied rows are history and stay');
  });
  await it('diff: only what changed travels; nothing changed is an empty patch', async () => {
    assert.deepStrictEqual(SCH.diff({ name: 'Rice', price: { amount: 100 } }, { name: 'Rice', price: { amount: 120 }, hsn: '1006' }), { price: { amount: 120 }, hsn: '1006' });
    assert.deepStrictEqual(SCH.diff({ a: 1 }, { a: 1 }), {}); assert.deepStrictEqual(SCH.diff(null, { a: 1 }), { a: 1 });
  });
  console.log(n + ' checks');
})().catch(() => { process.exit(1); });
