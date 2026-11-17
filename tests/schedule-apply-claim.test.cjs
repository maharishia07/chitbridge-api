/**
 * CB Catalogue - publish on a date, TWO readers at once (lib/schedule.js applyDue). NET-98 critic MUST 3, 2026-11-12.
 * Before: the due probe took no lock and the stamp had no `AND applied_at IS NULL`, so two readers that met the same due row BOTH applied its parked
 * patch; the second one waited on the item lock, then re-applied the OLD patch over whatever the owner had saved in between, and cut a second version.
 * Now: the probe is FOR UPDATE SKIP LOCKED (the other reader sees no due row) and the stamp is guarded.
 * The stand-in db models exactly the two Postgres behaviours that matter: a SKIP LOCKED select skips a row another open transaction holds; a plain select does not.
 * CARD      06-catalogue-pim/schedule-and-availability
 * UNIT      06/Schedule & availability
 * Run: node tests/schedule-apply-claim.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const turn = () => new Promise((go) => setTimeout(go, 2));

const T = { row: null, held: null, applied: 0, item: {}, stamps: 0 };
const fresh = () => { T.row = { schedule_id: 's1', item_id: 'I1', patch: { price: 120 }, applied_at: null }; T.held = null; T.applied = 0; T.item = { price: 100 }; T.stamps = 0; };
let txN = 0;
stub('db', {
  withEntity: async (entity, fn) => {
    const me = ++txN;
    const db = {
      query: async (sql) => {
        if (/^\s*SELECT schedule_id, item_id, patch FROM/.test(sql)) {
          const skip = /FOR UPDATE SKIP LOCKED/.test(sql);
          if (T.row.applied_at || (skip && T.held && T.held !== me)) return { rows: [] };
          if (skip) T.held = me;
          return { rows: [{ schedule_id: T.row.schedule_id, item_id: T.row.item_id, patch: T.row.patch }] };
        }
        if (/^\s*UPDATE catalogue_item_schedule SET applied_at/.test(sql)) {
          if (/applied_at IS NULL/.test(sql) && T.row.applied_at) return { rowCount: 0, rows: [] };
          T.row.applied_at = 'now'; T.stamps++; return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }
    };
    try { return await fn(db); } finally { if (T.held === me) T.held = null; }
  }
});
stub('lib/schema', { hasTable: async () => true });
stub('lib/logger', { fellBack: () => {}, warn: () => {}, info: () => {}, error: () => {} });
stub('lib/catalogue-write', { judgeItem: async () => null, patchItems: async (d, e, rows) => { await turn(); T.applied++; Object.assign(T.item, rows[0].merge); return { rowCount: 1 }; } });
const SCH = require('../lib/schedule');

(async () => {
  fresh();
  const [a, b] = await Promise.all([SCH.applyDue('E1'), SCH.applyDue('E1')]);
  assert.strictEqual(T.applied, 1, 'the parked patch is laid on the item ONCE, not by both readers (applied ' + T.applied + ' times)');
  assert.strictEqual(a + b, 1, 'one reader reports the change, the other 0');
  console.log('  ok  two readers at the same moment: one applies, the other finds nothing due');

  fresh();
  await SCH.applyDue('E1'); T.item.price = 150; /* the owner saves a later price */
  assert.strictEqual(await SCH.applyDue('E1'), 0, 'a later reader finds it applied');
  assert.strictEqual(T.item.price, 150, "the owner's later edit is not overwritten by an old parked patch");
  console.log("  ok  a reader after the apply leaves the owner's later edit alone");

  fresh();
  T.row.applied_at = 'now';
  assert.strictEqual(await SCH.applyDue('E1'), 0);
  console.log('  ok  an applied row is never due');
  console.log('schedule-apply-claim: 3 passed');
})().catch((e) => { console.log('  FAIL ' + (e && e.message)); process.exit(1); });
