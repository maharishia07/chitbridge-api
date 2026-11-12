// @stage tested
// OWNS parking a catalogue change for a date, its re-judgement when due, applying it lazily on read, listing and cancelling
// FLOW  schedule() parks → a read calls applyDue() → judgeDue() (the catalogue's own verdict) → patchItems, or the row is cancelled with applied_rows 0
// CARD  06-catalogue-pim/README
// CALLED BY routes/products.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
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
const log = require('./logger');
const schema = require('./schema');

const TABLE = 'catalogue_item_schedule';
async function enabled() {
  try {
    return !!(await schema.hasTable(TABLE));
  } catch (e) {
    log.fellBack('schedule enabled: failed — answered no', e);
    return false;
  }
}

/** the status stamp of a due change, as the keys to lay on its patch: {} when the patch states no new status; throws status 400 when the stamp refuses (a redundant with no replaced_by) */
function stampKeys(next, patch, stored) {
  const stamped = require('./itemstatus').stampInto(next, patch, stored, null);
  const keys = {};
  if (stamped !== next) for (const name of Object.keys(stamped)) if (name.startsWith('status')) keys[name] = stamped[name];
  return keys;
}

/**
 * judgeDue(db, entity_id, row) → { why } when a due change may not be applied, else { patch } (the parked patch, with the status stamp cut now if it changes the status).
 * The verdict is the catalogue's own on the item with the patch laid on it (catalogue-write.judgeItem). An item that is gone is not judged: the write finds nothing.
 */
async function judgeDue(db, entity_id, row) {
  const found = await db.query('SELECT item_data FROM catalogue_items WHERE item_id = $1 AND entity_id = $2 AND is_active = true FOR UPDATE', [row.item_id, entity_id]);
  const patch = Object.assign({}, row.patch);
  if (!found.rows.length) return { patch };
  const stored = found.rows[0].item_data || {};
  const next = Object.assign({}, stored, patch);
  const verdict = await require('./catalogue-write').judgeItem(entity_id, next, stored);
  if (verdict) return { why: verdict.message };
  try {
    return { patch: Object.assign(patch, stampKeys(next, patch, stored)) };
  } catch (e) {
    if (e && e.status >= 400 && e.status < 500) return { why: e.message };
    throw e;
  }
}

/** a due change the check refused: cancelled (applied_rows 0 marks "stopped by the check"; an owner's own cancel leaves it null) and said in the log, never applied */
async function cancelRefused(db, row, reason) {
  await db.query(`UPDATE ${TABLE} SET cancelled_at = NOW(), applied_rows = 0 WHERE schedule_id = $1`, [row.schedule_id]);
  log.warn('schedule applyDue: a parked change was refused when it came due', { schedule_id: row.schedule_id, item_id: row.item_id, why: reason });
}

/** applyDue(entity_id) → number applied. Called at the top of every read; a no-op almost always (one indexed probe).
 *  ⚠️ CLAIMED ONCE (NET-98 critic, 2026-11-12): the probe locks the due rows (FOR UPDATE SKIP LOCKED) and the stamp only lands on a row still unapplied, so two readers
 *  at the same moment cannot both lay one parked patch over the item (the second used to re-apply it over the owner's later edit and cut a second version). */
async function applyDue(entity_id, dbIn) {
  if (!(await enabled())) return 0;
  /* ⚠️ ROUND TRIPS. withEntity is a whole transaction (BEGIN · set_config · … · COMMIT). A caller already inside one
     passes its client and this costs ONE probe query; without it, four trips. GET /products pays the one. */
  const run = (fn) => (dbIn ? fn(dbIn) : withEntity(entity_id, fn));
  try {
    return await run(async (db) => {
      const due = await db.query(
        `SELECT schedule_id, item_id, patch FROM ${TABLE}
          WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL AND effective_at <= NOW()
          ORDER BY effective_at, created_at
          FOR UPDATE SKIP LOCKED`,
        [entity_id]
      );
      let n = 0;
      for (const row of due.rows) {
        /* CAT-317: judged AGAIN now it is due — the rules, the shop's currency or the item may have moved since it was parked */
        const { why: reason, patch } = await judgeDue(db, entity_id, row);
        if (reason) {
          await cancelRefused(db, row, reason);
          continue;
        }
        /* `||` is jsonb merge at the top level — exactly merge-patch for flat product keys; a null value removes nothing
           here (the product form never sends null), so the simpler operator is the honest one. */
        const u = await require('./catalogue-write').patchItems(db, entity_id, [{ item_id: row.item_id, merge: patch }], { activeOnly: true });
        await db.query(`UPDATE ${TABLE} SET applied_at = NOW(), applied_rows = $2 WHERE schedule_id = $1 AND applied_at IS NULL`, [row.schedule_id, u.rowCount]);
        n += u.rowCount;
      }
      return n;
    });
  } catch (e) {
    log.fellBack('schedule applyDue: the write failed — counted as 0', e);
    return 0;
  } /* a read must never fail because a parked change could not be applied */
}

/** schedule(entity_id, item_id, effective_at, patch, by) → the row, or { error } when disabled / bad input. */
async function schedule(entity_id, item_id, effective_at, patch, by) {
  if (!(await enabled())) return { error: 'not_enabled', message: 'Scheduled changes need migration b203 (catalogue_item_schedule).' };
  const at = new Date(effective_at);
  if (!(at.getTime() > 0)) return { error: 'bad_time', message: 'effective_at must be a date-time.' };
  const keys = Object.keys(patch && typeof patch === 'object' ? patch : {});
  if (!keys.length) return { error: 'empty', message: 'Nothing changed — no patch to schedule.' };
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `INSERT INTO ${TABLE} (entity_id, item_id, effective_at, patch, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING schedule_id, item_id, effective_at, patch, created_at`,
      [entity_id, item_id, at.toISOString(), JSON.stringify(patch), by || null]
    )
  );
  return { row: r.rows[0] };
}

/** pending(entity_id, item_id?) → parked changes not yet applied nor cancelled. */
async function pending(entity_id, item_id, dbIn) {
  if (!(await enabled())) return [];
  const run = (fn) => (dbIn ? fn(dbIn) : withEntity(entity_id, fn));
  const r = await run((db) =>
    db.query(
      `SELECT schedule_id, item_id, effective_at, patch, created_at FROM ${TABLE}
      WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL ${item_id ? 'AND item_id = $2' : ''}
      ORDER BY effective_at`,
      item_id ? [entity_id, item_id] : [entity_id]
    )
  );
  return r.rows;
}

/**
 * parkedUsing(entity_id, key, dbIn) → how many PENDING parked changes (not applied, not cancelled) set a value for the column `key` (CAT-326). A column with a parked value is in use
 * as a column with a stored value is: the delete and retype doors count these with the products that hold a value, so a column is not removed or retyped under a change waiting for its date.
 * A merge-patch null (the change that deletes the key) is not a value. b203 absent → 0.
 */
async function parkedUsing(entity_id, key, dbIn) {
  if (!(await enabled())) return 0;
  const inDb = (fn) => (dbIn ? fn(dbIn) : withEntity(entity_id, fn));
  const found = await inDb((db) =>
    db.query(
      `SELECT count(*)::int AS n FROM ${TABLE}
      WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL AND patch ? $2 AND jsonb_typeof(patch->$2) <> 'null'`,
      [entity_id, key]
    )
  );
  return (found.rows[0] && found.rows[0].n) || 0;
}

/** cancel(entity_id, schedule_id) → true when a pending row was cancelled. Applied rows are history and stay. */
async function cancel(entity_id, schedule_id) {
  if (!(await enabled())) return false;
  const r = await withEntity(entity_id, (db) =>
    db.query(`UPDATE ${TABLE} SET cancelled_at = NOW() WHERE schedule_id = $1 AND entity_id = $2 AND applied_at IS NULL AND cancelled_at IS NULL`, [
      schedule_id,
      entity_id
    ])
  );
  return r.rowCount > 0;
}

/** diff(current, next) → the merge-patch of what changed (pure; the UI computes the same, this is the server's check). */
function diff(current, next) {
  const c = current || {},
    n = next || {},
    out = {};
  for (const k of Object.keys(n)) if (JSON.stringify(c[k]) !== JSON.stringify(n[k])) out[k] = n[k];
  return out;
}

module.exports = { applyDue, schedule, pending, parkedUsing, cancel, diff, enabled, TABLE };
