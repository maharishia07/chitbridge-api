// @stage tested
// @stage-note [BOOKS v2] The fixed-asset register (b280, DRAFT — not run): one row per asset, read and written here only.
'use strict';
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
const notMigrated = () => { const e = new Error('The asset register is not created yet — run migration b280 first.'); e.code = 'BOOKS_NOT_MIGRATED'; e.refused = true; return e; };
const missing = (e) => e && (e.code === '42P01' || e.code === '42703');
const n = (v) => (v == null ? 0 : Number(v));
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

const COLS = `asset_id, name, asset_class, cost_minor, currency, put_to_use, source_entry_id, source_chit_id, accumulated_minor, last_dep_fy,
              disposed_on, disposal_entry_id, proceeds_minor, created_by, created_at`;
function rowOf(r) {
  return r && { asset_id: r.asset_id, name: r.name, asset_class: r.asset_class, cost_minor: n(r.cost_minor), currency: r.currency || 'INR', put_to_use: ymd(r.put_to_use),
    source_entry_id: r.source_entry_id || null, source_chit_id: r.source_chit_id || null, accumulated_minor: n(r.accumulated_minor), last_dep_fy: r.last_dep_fy || null,
    disposed_on: ymd(r.disposed_on), disposal_entry_id: r.disposal_entry_id || null, proceeds_minor: r.proceeds_minor == null ? null : n(r.proceeds_minor),
    created_by: r.created_by || null, created_at: r.created_at || null };
}

/** the real SQL — every statement names the shop in $1 */
const sql = {
  async exists(h, e) {
    try { await h.query(`SELECT 1 FROM fixed_asset WHERE entity_id = $1 LIMIT 1`, [e]); return true; }
    catch (err) { if (missing(err)) return false; throw err; }
  },
  async list(h, e) { const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 ORDER BY put_to_use, created_at`, [e]); return r.rows.map(rowOf); },
  async get(h, e, id) { const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 AND asset_id = $2`, [e, id]); return rowOf(r.rows[0]); },
  async bySourceEntry(h, e, entry_id, name) { const r = await h.query(`SELECT ${COLS} FROM fixed_asset WHERE entity_id = $1 AND source_entry_id = $2 AND name = $3`, [e, entry_id, name]); return rowOf(r.rows[0]); },
  async insert(h, e, a) {
    const r = await h.query(`INSERT INTO fixed_asset (entity_id, name, asset_class, cost_minor, currency, put_to_use, source_entry_id, source_chit_id, created_by)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                             ON CONFLICT (entity_id, source_entry_id, name) WHERE source_entry_id IS NOT NULL DO NOTHING RETURNING ${COLS}`,
    [e, a.name, a.asset_class, a.cost_minor, a.currency || 'INR', a.put_to_use, a.source_entry_id || null, a.source_chit_id || null, a.by || null]);
    return rowOf(r.rows[0]);
  },
  /** a depreciation run: add what it posted to each asset's accumulated, and stamp the year */
  async addDepreciation(h, e, id, amount_minor, fy) {
    await h.query(`UPDATE fixed_asset SET accumulated_minor = accumulated_minor + $3, last_dep_fy = $4 WHERE entity_id = $1 AND asset_id = $2 AND last_dep_fy IS DISTINCT FROM $4`, [e, id, amount_minor, fy]);
  },
  async markDisposed(h, e, id, on, entry_id, proceeds_minor) {
    const r = await h.query(`UPDATE fixed_asset SET disposed_on = $3, disposal_entry_id = $4, proceeds_minor = $5
                              WHERE entity_id = $1 AND asset_id = $2 AND disposed_on IS NULL RETURNING asset_id`, [e, id, on, entry_id, proceeds_minor]);
    return !!r.rows[0];
  },
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function use(s) { store = s || sql; }

/** run a store call; a missing table is the one refusal */
async function guard(fn) {
  try { return await fn(); } catch (err) { if (missing(err)) throw notMigrated(); throw err; }
}
const api = {
  notMigrated, use,
  /** is b280 run? — never throws */
  exists: (h, e) => store.exists(h, e),
  /** like exists(), but a refusal: the asset routes' first line */
  async need(h, e) { if (!(await store.exists(h, e))) throw notMigrated(); },
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
  addDepreciation: (h, e, id, minor, fy) => guard(() => store.addDepreciation(h, e, id, minor, fy)),
  markDisposed: (h, e, id, on, entry_id, proceeds_minor) => guard(() => store.markDisposed(h, e, id, on, entry_id, proceeds_minor)),
  sql,
};
module.exports = api;
