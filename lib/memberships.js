// @stage tested
// @stage-note [CB CRM L1] The ONE writer of the per-shop memberships table (b297): who belongs to which group, append-only. First kind: lead_stage.
'use strict';
/**
 * lib/memberships.js — "what belongs together", one table, one writer (DECISIONS 2026-10-10).
 *
 * ⭐ APPEND-ONLY. A move is a new row; the latest row of (entity, item, kind) is where the item is now; the older rows are the history.
 * ⭐ ONE WRITER: add() checks the group is in the kind's dictionary, that the item exists AND belongs to this shop, then inserts. Nothing else
 *   writes the table. RLS (entity_id) is the second fence, the database's.
 * ⚠️ BEFORE b297 the table is absent: need() throws 503 { code: 'LEADS_NOT_MIGRATED' } in shopkeeper words; reads answer "not ready" — no jsonb fallback.
 * Trips: add() = 2 statements (item check, insert) inside the caller's transaction; latest() = 1 statement for any number of items.
 */
/** the kinds in code mirror membership_kind (b297); a new kind = a row there + a line here */
const KINDS = {
  lead_stage: { item_type: 'party', groups: ['lead', 'demo', 'trial', 'parked', 'lost'] },
};
const NOT_READY = 'Lead stages arrive after the next update.';
const bad = (msg, status, code) => { const e = new Error(msg); e.status = status || 400; if (code) e.code = code; return e; };
const schema = () => require('./schema');

/** is the memberships table there yet? (schema.hasTable: a yes is remembered, a no is asked again within a minute) */
const ready = () => schema().hasTable('memberships');
async function need() { if (!(await ready())) throw bad(NOT_READY, 503, 'LEADS_NOT_MIGRATED'); }

/** does this item exist AND belong to this shop? one statement */
async function itemExists(h, entity, item_type, item_id) {
  if (item_type !== 'party') return false;
  const r = await h.query(
    `SELECT EXISTS (SELECT 1 FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2) OR
            EXISTS (SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2) AS ok`, [entity, item_id]);
  return !!(r.rows[0] && r.rows[0].ok);
}

/** add(h, entity, { kind, item_id, group, by }) → the new row. `h` is the caller's transaction (withEntity). */
async function add(h, entity, m) {
  const k = KINDS[m && m.kind];
  if (!k) throw bad('That grouping is not known.', 400, 'BAD_KIND');
  if (k.groups.indexOf(m.group) < 0) throw bad('That is not one of the stages.', 400, 'BAD_GROUP');
  if (!(await itemExists(h, entity, k.item_type, m.item_id))) throw bad('Not your party.', 404, 'NOT_FOUND');
  const r = await h.query(
    `INSERT INTO memberships (entity_id, item_type, item_id, kind, grp, by_user_id) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING membership_id, item_id, kind, grp, at`, [entity, k.item_type, m.item_id, m.kind, m.group, m.by || null]);
  return r.rows[0];
}

/** latest(h, entity, kind, ids?) → Map(item_id → { group, at }) — ONE statement for any number of items (ids omitted = the shop's whole kind) */
async function latest(h, entity, kind, ids) {
  const r = await h.query(
    `SELECT DISTINCT ON (item_id) item_id, grp, at FROM memberships WHERE entity_id = $1 AND kind = $2${ids ? ' AND item_id = ANY($3::uuid[])' : ''}
      ORDER BY item_id, at DESC, membership_id DESC`, ids ? [entity, kind, ids] : [entity, kind]);
  return new Map(r.rows.map((x) => [String(x.item_id), { group: x.grp, at: x.at instanceof Date ? x.at.toISOString() : String(x.at) }]));
}

module.exports = { KINDS, NOT_READY, ready, need, add, latest, itemExists };
