// @stage tested
// @stage-note Scheduled product changes (BACKLOG "publish on a date"): a patch parked with an effective time, applied lazily on read.
'use strict';
/**
 * PUBLISH ON A DATE — the trader changes a price on Friday for Monday. The change is PARKED (catalogue_item_schedule,
 * b203) and APPLIED the first time anyone reads the catalogue after the moment: the owner's list, the storefront, the
 * send path all go through applyDue() first. No clock, no worker, no second copy of the product: the item is what it
 * always was until the moment, then it is the patched item — and catalogue_item_version records the change like any
 * other edit, with `applied_at` on the schedule row saying which parked change produced it.
 *
 * ⚠️ FAILS OPEN UNTIL b203 RUNS: hasTable is cached and cheap; without the table every function answers "not enabled"
 * and nothing else changes. ⚠️ WITH RLS — the table's policy scopes to entity_id like catalogue_items.
 * ⚠️ A PATCH, NOT A SNAPSHOT: only the keys the trader changed travel (RFC 7386 merge-patch, the same shape the
 * catalogue's golden records use). A price scheduled on Friday does not undo a description fixed on Saturday.
 */
const { withEntity } = require('../db');
const schema = require('./schema');

const TABLE = 'catalogue_item_schedule';
async function enabled() { try { return !!(await schema.hasTable(TABLE)); } catch (_) { return false; } }

/** applyDue(entity_id) → number applied. Called at the top of every read; a no-op almost always (one indexed probe). */
async function applyDue(entity_id, dbIn) {
  if (!(await enabled())) return 0;
  /* ⚠️ ROUND TRIPS. withEntity is a whole transaction (BEGIN · set_config · … · COMMIT). A caller already inside one
     passes its client and this costs ONE probe query; without it, four trips. GET /products pays the one. */
  const run = (fn) => dbIn ? fn(dbIn) : withEntity(entity_id, fn);
  try {
    return await run(async (db) => {
      const due = await db.query(
        `SELECT schedule_id, item_id, patch FROM ${TABLE}
          WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL AND effective_at <= NOW()
          ORDER BY effective_at, created_at`, [entity_id]);
      let n = 0;
      for (const row of due.rows) {
        /* `||` is jsonb merge at the top level — exactly merge-patch for flat product keys; a null value removes nothing
           here (the product form never sends null), so the simpler operator is the honest one. */
        const u = await db.query(
          `UPDATE catalogue_items SET item_data = item_data || $1::jsonb, updated_at = NOW()
            WHERE item_id = $2 AND entity_id = $3 AND is_active = true`, [JSON.stringify(row.patch || {}), row.item_id, entity_id]);
        await db.query(`UPDATE ${TABLE} SET applied_at = NOW(), applied_rows = $2 WHERE schedule_id = $1`, [row.schedule_id, u.rowCount]);
        n += u.rowCount;
      }
      return n;
    });
  } catch (_) { return 0; }   /* a read must never fail because a parked change could not be applied */
}

/** schedule(entity_id, item_id, effective_at, patch, by) → the row, or { error } when disabled / bad input. */
async function schedule(entity_id, item_id, effective_at, patch, by) {
  if (!(await enabled())) return { error: 'not_enabled', message: 'Scheduled changes need migration b203 (catalogue_item_schedule).' };
  const at = new Date(effective_at);
  if (!(at.getTime() > 0)) return { error: 'bad_time', message: 'effective_at must be a date-time.' };
  const keys = Object.keys(patch && typeof patch === 'object' ? patch : {});
  if (!keys.length) return { error: 'empty', message: 'Nothing changed — no patch to schedule.' };
  const r = await withEntity(entity_id, (db) => db.query(
    `INSERT INTO ${TABLE} (entity_id, item_id, effective_at, patch, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING schedule_id, item_id, effective_at, patch, created_at`,
    [entity_id, item_id, at.toISOString(), JSON.stringify(patch), by || null]));
  return { row: r.rows[0] };
}

/** pending(entity_id, item_id?) → parked changes not yet applied nor cancelled. */
async function pending(entity_id, item_id, dbIn) {
  if (!(await enabled())) return [];
  const run = (fn) => dbIn ? fn(dbIn) : withEntity(entity_id, fn);
  const r = await run((db) => db.query(
    `SELECT schedule_id, item_id, effective_at, patch, created_at FROM ${TABLE}
      WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL ${item_id ? 'AND item_id = $2' : ''}
      ORDER BY effective_at`, item_id ? [entity_id, item_id] : [entity_id]));
  return r.rows;
}

/** cancel(entity_id, schedule_id) → true when a pending row was cancelled. Applied rows are history and stay. */
async function cancel(entity_id, schedule_id) {
  if (!(await enabled())) return false;
  const r = await withEntity(entity_id, (db) => db.query(
    `UPDATE ${TABLE} SET cancelled_at = NOW() WHERE schedule_id = $1 AND entity_id = $2 AND applied_at IS NULL AND cancelled_at IS NULL`,
    [schedule_id, entity_id]));
  return r.rowCount > 0;
}

/** diff(current, next) → the merge-patch of what changed (pure; the UI computes the same, this is the server's check). */
function diff(current, next) {
  const c = current || {}, n = next || {}, out = {};
  for (const k of Object.keys(n)) if (JSON.stringify(c[k]) !== JSON.stringify(n[k])) out[k] = n[k];
  return out;
}

module.exports = { applyDue, schedule, pending, cancel, diff, enabled, TABLE };
