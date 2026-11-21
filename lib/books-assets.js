// @stage tested
// @stage-note [BOOKS v2] The fixed-asset register (b280, DRAFT — not run): one row per asset, read and written here only.
'use strict';
// OWNS  the fixed-asset register: one row per asset, read and written through a withEntity handle (depreciation figures come from the engines).
// CALLED BY routes/books.js
// FLOW  route → books-assets → asset rows → the journal (never a second ledger)
// CARD  14-accounting/books-assets
/**
 * lib/books-assets.js — THE ASSET REGISTER (engines year-book 2026-27 §9 gap 4).
 *
 * ⭐ A CONVENIENCE OVER THE JOURNAL, NEVER A SECOND LEDGER. A row remembers what the engine's depreciationFor() needs handed in
 *   (class, cost, the day it was put to use, what has been written off so far); the figures themselves — the lines of a purchase,
 *   a depreciation, a disposal — are the posting engine's, written by lib/books.js postEntry. Nothing here computes a rupee of depreciation.
 * ⚠️ NOT MIGRATED → BOOKS_NOT_MIGRATED (503). The table is b280, a DRAFT Athi runs. Every function answers a missing table (42P01) as
 *   that one refusal, and `exists()` is how a caller asks BEFORE it promises anything (the Accept-as-asset path keeps queueing until true).
 * ⚠️ Every function takes `h` — a withEntity() handle — and names the shop in $1.
 * Tests replace the SQL with an in-memory store through use().
 */
const notMigrated = () => {
  const e = new Error(waiting('The asset register', false, 'No asset can be added or listed yet; keep the purchase papers and add each asset after the update.'));
  e.code = 'BOOKS_NOT_MIGRATED';
  e.refused = true;
  return e;
};
const missing = (e) => e && (e.code === '42P01' || e.code === '42703');
const n = (v) => (v == null ? 0 : Number(v));
const { waiting, guarded } = require('./not-migrated');
const ymd = require('./books-engines').ymd; /* T2-NATDEF: THE date reader (a `date` column is built at local midnight) */

const COLS = `asset_id, name, asset_class, cost_minor, currency, put_to_use, source_entry_id, source_chit_id, accumulated_minor, last_dep_fy, fy_charged_minor, purchased_on,
              disposed_on, disposal_entry_id, proceeds_minor, created_by, created_at`;
const orNull = (value) => value || null;
function rowOf(r) {
  return (
    r && {
      asset_id: r.asset_id,
      name: r.name,
      asset_class: r.asset_class,
      cost_minor: n(r.cost_minor),
      currency: orNull(r.currency),
      put_to_use: ymd(r.put_to_use),
      source_entry_id: orNull(r.source_entry_id),
      source_chit_id: orNull(r.source_chit_id),
      accumulated_minor: n(r.accumulated_minor),
      last_dep_fy: orNull(r.last_dep_fy),
      fy_charged_minor: n(r.fy_charged_minor),
      purchased_on: ymd(r.purchased_on) || ymd(r.put_to_use),
      disposed_on: ymd(r.disposed_on),
      disposal_entry_id: orNull(r.disposal_entry_id),
      proceeds_minor: r.proceeds_minor == null ? null : n(r.proceeds_minor),
      created_by: orNull(r.created_by),
      created_at: orNull(r.created_at)
    }
  );
}

/** the real SQL — every statement names the shop in $1 */
const sql = {
  async exists(h, e) {
    try {
      await h.query(`SELECT 1 FROM fixed_asset WHERE entity_id = $1 LIMIT 1`, [e]);
      return true;
    } catch (err) {
      if (missing(err)) return false;
      throw err;
    }
  },
  async list(h, e) {
    const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 ORDER BY put_to_use, created_at`, [e]);
    return r.rows.map(rowOf);
  },
  async get(h, e, id) {
    const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 AND asset_id = $2`, [e, id]);
    return rowOf(r.rows[0]);
  },
  async bySourceEntry(h, e, entry_id, name) {
    const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 AND source_entry_id = $2 AND name = $3`, [e, entry_id, name]);
    return rowOf(r.rows[0]);
  },
  async insert(h, e, a) {
    const r = await h.query(
      `INSERT INTO fixed_asset (entity_id, name, asset_class, cost_minor, currency, put_to_use, source_entry_id, source_chit_id, created_by, accumulated_minor, purchased_on)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                             ON CONFLICT (entity_id, source_entry_id, name) WHERE source_entry_id IS NOT NULL DO NOTHING RETURNING ${COLS}`,
      [e, a.name, a.asset_class, a.cost_minor, a.currency || null, a.put_to_use, a.source_entry_id || null, a.source_chit_id || null, a.by || null, a.accumulated_minor || 0, a.purchased_on || a.put_to_use]
    );
    return rowOf(r.rows[0]);
  },
  /** a depreciation run: add what it posted to the asset's accumulated and to what the year has charged (a new year starts that count over). A run is made once — its journal entry's source_ref is the guard, not this row */
  async addDepreciation(h, e, id, amount_minor, fy, ref) {
    await h.query(
      `UPDATE fixed_asset SET accumulated_minor = accumulated_minor + $3,
                              fy_charged_minor = CASE WHEN last_dep_fy = $4 THEN fy_charged_minor + $3 ELSE $3 END, last_dep_fy = $4,
                              dep_log = dep_log || jsonb_build_array(jsonb_build_object('ref', $5::text, 'fy', $4::text, 'minor', $3::bigint))
                              WHERE entity_id = $1 AND asset_id = $2`,
      [e, id, amount_minor, fy, ref || null]
    );
  },
  /** a depreciation entry was reversed: take what that run (its source_ref) charged each asset off accumulated and off the year's count, and forget the log line — so the run can be made again */
  async undoDepreciation(handle, e, ref) {
    await handle.query(
      `UPDATE fixed_asset a SET accumulated_minor = a.accumulated_minor - x.minor,
                                fy_charged_minor = CASE WHEN a.last_dep_fy = x.fy THEN GREATEST(0, a.fy_charged_minor - x.minor) ELSE a.fy_charged_minor END,
                                dep_log = (SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) FROM jsonb_array_elements(a.dep_log) l WHERE l->>'ref' IS DISTINCT FROM $2)
         FROM (SELECT f.asset_id, (l->>'minor')::bigint AS minor, l->>'fy' AS fy FROM fixed_asset f, jsonb_array_elements(f.dep_log) l
                WHERE f.entity_id = $1 AND l->>'ref' = $2) x
        WHERE a.entity_id = $1 AND a.asset_id = x.asset_id`,
      [e, ref]
    );
  },
  async markDisposed(h, e, id, on, entry_id, proceeds_minor) {
    const r = await h.query(
      `UPDATE fixed_asset SET disposed_on = $3, disposal_entry_id = $4, proceeds_minor = $5
                              WHERE entity_id = $1 AND asset_id = $2 AND disposed_on IS NULL RETURNING asset_id`,
      [e, id, on, entry_id, proceeds_minor]
    );
    return !!r.rows[0];
  },
  /** F3 disposal half: the disposal entry was reversed, so the asset is back in the books; clear the sale off its register row (matched by the entry, not the name) so it can be disposed again */
  async undoDisposal(h, e, entry_id) {
    await h.query(`UPDATE fixed_asset SET disposed_on = NULL, disposal_entry_id = NULL, proceeds_minor = NULL WHERE entity_id = $1 AND disposal_entry_id = $2`, [e, entry_id]);
  }
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function use(s) {
  store = s || sql;
}

/** run a store call; a missing table is the one refusal */
const guard = guarded(missing, notMigrated);
/**
 * F3 (batch 1128): the assets that still owe the year's depreciation → [{ asset_id, name }] — empty when no register is migrated, no asset was in use by the year end, every asset has nothing left to write off,
 * or the year's depreciation entry (source_ref depreciation:<fy>, the run's own key) is posted. The same register filter runDepreciation uses (in use by the year end); a disposed asset owes no more.
 */
async function depreciationOwed(h, e, fiscalYear, range, entryBySource, markedRows) {
  if (!(await store.exists(h, e))) return [];
  const ref = 'depreciation:' + fiscalYear;
  if ((await entryBySource(h, e, ref)) || (await markedRows(h, e, NIL_RUN.table, NIL_RUN.field, [ref])).length) return []; /* the entry, or the run's marker when the year's amount was 0 */
  const end = ymd(range.end);
  return (await store.list(h, e))
    .filter((item) => ymd(item.put_to_use) <= end && !item.disposed_on && n(item.cost_minor) - n(item.accumulated_minor) > 0)
    .map((item) => ({ asset_id: item.asset_id, name: item.name }));
}
/** F3 LEFT (1128): a run whose year amount is 0 posts no entry — one change-log row (table depreciation, row_id the run's source_ref) says it ran */
const NIL_RUN = { table: 'depreciation', field: 'run_nil' };
const api = {
  NIL_RUN,
  depreciationOwed,
  notMigrated,
  use,
  /** is b280 run? — never throws */
  exists: (h, e) => store.exists(h, e),
  /** like exists(), but a refusal: the asset routes' first line */
  async need(h, e) {
    if (!(await store.exists(h, e))) throw notMigrated();
  },
  list: (h, e) => guard(() => store.list(h, e)),
  get: (h, e, id) => guard(() => store.get(h, e, id)),
  bySourceEntry: (h, e, entry_id, name) => guard(() => store.bySourceEntry(h, e, entry_id, name)),
  /** add one; the same source entry and name answers the row it already made (a retry never makes a second asset) */
  async add(h, e, a) {
    return guard(async () => {
      const made = await store.insert(h, e, a);
      return made || (a.source_entry_id ? store.bySourceEntry(h, e, a.source_entry_id, a.name) : null);
    });
  },
  addDepreciation: (h, e, id, minor, fy, ref) => guard(() => store.addDepreciation(h, e, id, minor, fy, ref)),
  /** a reversal of a depreciation entry reaches the register here (lib/books writeReversal); a shop with no register table has nothing to undo */
  async undoDepreciation(h, e, ref) {
    if (await store.exists(h, e)) await guard(() => store.undoDepreciation(h, e, ref));
  },
  /** a reversal of a disposal entry reaches the register here (lib/books writeReversal), as undoDepreciation does for a run */
  async undoDisposal(h, e, entry_id) {
    if (await store.exists(h, e)) await guard(() => store.undoDisposal(h, e, entry_id));
  },
  /** a reversed entry reaches the register here (lib/books writeReversal): a depreciation run takes its charge back, a disposal opens the asset again, so each can be made again */
  async undoOnReversal(h, e, orig) {
    const ref = String(orig.source_ref || '');
    if (ref.startsWith('depreciation:')) await api.undoDepreciation(h, e, ref);
    else if (ref.startsWith('asset-dispose:')) await api.undoDisposal(h, e, orig.entry_id);
  },
  markDisposed: (h, e, id, on, entry_id, proceeds_minor) => guard(() => store.markDisposed(h, e, id, on, entry_id, proceeds_minor)),
  sql
};
module.exports = api;
