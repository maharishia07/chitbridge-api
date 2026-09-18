/**
 * lib/quick-keys.js — Level 1 (permanent, manager-side) quick-key groups and Level 2 (counter-side) state,
 * against the tables in migrations/b262_quick_key_groups.sql (run 2026-09-18).
 *
 * ⭐ ENGINE, NOT A ROUTE. Every function here takes a `db` client already bound to the caller's entity via
 * withEntity()/onEntity() — same convention as routes/counters.js's patchCounter(db, entity_id, id, patch).
 * HTTP concerns (auth, req/res, which counter a key belongs to) live in the routes that call this.
 *
 * ⚠️ Level 2 sold-out ALREADY EXISTS, entirely client-side (till.html's quickSoldOut()/bizDay(), [TILL-28]):
 * per-item, hidden in every group already, resets on the counter's own business-day roll. This module does not
 * replace that — it gives it a server-side counterpart, which is what makes cross-counter push (decision 3,
 * 2026-09-18) possible at all: a browser cannot write into another counter's localStorage.
 *
 * ⚠️ business_date is a plain string the CALLER computes (till.html's own bizDay(), which already accounts for
 * the shop's day-roll hour) and passes through — the server does not recompute "today" itself, so there is one
 * definition of a counter's business day, not two that can drift.
 *
 * ⚠️ shift_id is carried but UNUSED today: there is no shift/clock-in concept anywhere in this codebase yet.
 * Decision 2 (2026-09-18, "reset timing should be a setting") can only mean business-day-roll vs. nothing right
 * now — a "shift close" option has nowhere to attach until shifts exist as their own feature. See policy.js's
 * quick_key_reset_at.
 */
'use strict';

const AUDIT_ACTIONS = ['create', 'rename', 'update', 'delete', 'add', 'remove', 'move', 'photo'];

async function audit(db, entity_id, user_id, action, before, after) {
  if (AUDIT_ACTIONS.indexOf(action) < 0) throw new Error('quick-keys: unknown audit action ' + action);
  await db.query(
    `INSERT INTO quick_key_audit (entity_id, user_id, action, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity_id, user_id || null, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

// ── Level 1: groups ──────────────────────────────────────────────────────────────────────────────────────────

async function listGroups(db, entity_id) {
  const groups = (await db.query(
    `SELECT id, name, color, sort_order, window_from, window_to, suggest_on_start, version, updated_at
       FROM quick_key_group WHERE entity_id = $1 AND NOT is_deleted ORDER BY sort_order, name`,
    [entity_id])).rows;
  if (!groups.length) return [];
  const ids = groups.map((g) => g.id);
  const items = (await db.query(
    `SELECT gi.group_id, gi.product_id, gi.position, ci.item_data->>'name' AS name, ci.item_data->>'price' AS price
       FROM quick_key_group_item gi JOIN catalogue_items ci ON ci.item_id = gi.product_id
      WHERE gi.group_id = ANY($1::uuid[]) ORDER BY gi.position`,
    [ids])).rows;
  const byGroup = new Map(ids.map((id) => [id, []]));
  items.forEach((it) => byGroup.get(it.group_id).push({ product_id: it.product_id, position: it.position, name: it.name, price: it.price }));
  return groups.map((g) => Object.assign({}, g, { items: byGroup.get(g.id) || [] }));
}

async function createGroup(db, entity_id, fields, user_id) {
  const f = fields || {};
  if (!f.name || !String(f.name).trim()) throw Object.assign(new Error('name required'), { code: 'validation' });
  const r = await db.query(
    `INSERT INTO quick_key_group (entity_id, name, color, sort_order, window_from, window_to, suggest_on_start, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [entity_id, String(f.name).trim(), f.color || null, f.sort_order || 0, f.window_from || null, f.window_to || null,
     !!f.suggest_on_start, user_id || null]);
  const row = r.rows[0];
  await audit(db, entity_id, user_id, 'create', null, row);
  return Object.assign({}, row, { items: [] });
}

/** ⚠️ MERGE-PATCH, NEVER THE WHOLE RECORD — only fields present in `patch` change. Optimistic lock on `version`:
 * a stale expected_version means somebody else changed it since this caller last read it — 409, re-read, retry. */
async function updateGroup(db, entity_id, group_id, patch, expected_version, user_id) {
  const before = (await db.query(`SELECT * FROM quick_key_group WHERE id = $1 AND entity_id = $2`, [group_id, entity_id])).rows[0];
  if (!before || before.is_deleted) throw Object.assign(new Error('not found'), { code: 'not_found' });
  if (expected_version != null && Number(expected_version) !== before.version)
    throw Object.assign(new Error('changed since you last read it'), { code: 'conflict', current: before });
  const p = patch || {};
  const next = {
    name: p.name !== undefined ? String(p.name).trim() : before.name,
    color: p.color !== undefined ? p.color : before.color,
    sort_order: p.sort_order !== undefined ? p.sort_order : before.sort_order,
    window_from: p.window_from !== undefined ? p.window_from : before.window_from,
    window_to: p.window_to !== undefined ? p.window_to : before.window_to,
    suggest_on_start: p.suggest_on_start !== undefined ? !!p.suggest_on_start : before.suggest_on_start,
  };
  const r = await db.query(
    `UPDATE quick_key_group SET name=$1, color=$2, sort_order=$3, window_from=$4, window_to=$5,
            suggest_on_start=$6, version = version + 1, updated_by=$7, updated_at = now()
      WHERE id = $8 AND entity_id = $9 RETURNING *`,
    [next.name, next.color, next.sort_order, next.window_from, next.window_to, next.suggest_on_start, user_id || null, group_id, entity_id]);
  const row = r.rows[0];
  await audit(db, entity_id, user_id, p.name !== undefined && p.name !== before.name ? 'rename' : 'update', before, row);
  return row;
}

/** Soft delete only — handoff §6 rule 1: "removing a key in maintenance never deletes the product from the menu"
 * extends here to the group itself, so a deleted group's history stays explainable in the audit trail. */
async function deleteGroup(db, entity_id, group_id, expected_version, user_id) {
  const before = (await db.query(`SELECT * FROM quick_key_group WHERE id = $1 AND entity_id = $2`, [group_id, entity_id])).rows[0];
  if (!before || before.is_deleted) throw Object.assign(new Error('not found'), { code: 'not_found' });
  if (expected_version != null && Number(expected_version) !== before.version)
    throw Object.assign(new Error('changed since you last read it'), { code: 'conflict', current: before });
  const r = await db.query(
    `UPDATE quick_key_group SET is_deleted = true, version = version + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND entity_id = $3 RETURNING *`,
    [user_id || null, group_id, entity_id]);
  await audit(db, entity_id, user_id, 'delete', before, r.rows[0]);
  return r.rows[0];
}

async function addItem(db, entity_id, group_id, product_id, position, user_id) {
  const group = (await db.query(`SELECT id FROM quick_key_group WHERE id=$1 AND entity_id=$2 AND NOT is_deleted`, [group_id, entity_id])).rows[0];
  if (!group) throw Object.assign(new Error('group not found'), { code: 'not_found' });
  const r = await db.query(
    `INSERT INTO quick_key_group_item (group_id, entity_id, product_id, position) VALUES ($1,$2,$3,$4)
       ON CONFLICT (group_id, product_id) DO UPDATE SET position = EXCLUDED.position RETURNING *`,
    [group_id, entity_id, product_id, position || 0]);
  await audit(db, entity_id, user_id, 'add', null, r.rows[0]);
  return r.rows[0];
}

async function removeItem(db, entity_id, group_id, product_id, user_id) {
  const r = await db.query(
    `DELETE FROM quick_key_group_item WHERE group_id=$1 AND entity_id=$2 AND product_id=$3 RETURNING *`,
    [group_id, entity_id, product_id]);
  if (r.rows.length) await audit(db, entity_id, user_id, 'remove', r.rows[0], null);
  return { removed: r.rows.length > 0 };
}

/** items: [{product_id, position}] — one group's whole order, rewritten in position order (handoff §6 rule 5). */
async function reorderItems(db, entity_id, group_id, items, user_id) {
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    await db.query(
      `UPDATE quick_key_group_item SET position=$1 WHERE group_id=$2 AND entity_id=$3 AND product_id=$4`,
      [it.position || 0, group_id, entity_id, it.product_id]);
  }
  await audit(db, entity_id, user_id, 'move', null, { group_id, items: list });
  return { ok: true };
}

// ── Level 2: per-counter state ───────────────────────────────────────────────────────────────────────────────

async function getActiveGroups(db, entity_id, counter_id, business_date) {
  const r = await db.query(
    `SELECT active_group_ids, shift_id, updated_at FROM counter_quick_key_state
      WHERE entity_id=$1 AND counter_id=$2 AND business_date=$3::date`,
    [entity_id, counter_id, business_date]);
  return r.rows[0] || { active_group_ids: [], shift_id: null, updated_at: null };
}

async function setActiveGroups(db, entity_id, counter_id, business_date, shift_id, active_group_ids) {
  const ids = Array.isArray(active_group_ids) ? active_group_ids : [];
  const r = await db.query(
    `INSERT INTO counter_quick_key_state (entity_id, counter_id, business_date, shift_id, active_group_ids, updated_at)
     VALUES ($1,$2,$3::date,$4,$5::uuid[],now())
     ON CONFLICT (entity_id, counter_id, business_date)
     DO UPDATE SET shift_id = EXCLUDED.shift_id, active_group_ids = EXCLUDED.active_group_ids, updated_at = now()
     RETURNING *`,
    [entity_id, counter_id, business_date, shift_id || null, ids]);
  return r.rows[0];
}

/**
 * ⚠️ BOUNDED AT THE SERVER, not just filtered at the counter. This was an unbounded SELECT that a counter polls
 * every 30 seconds over mobile data — after a year of a grocer marking ten things sold out a day it would be
 * sending ~3,600 rows, ~2,880 times a day, for the six that still matter (found by a critic pass, 2026-09-18).
 * Two days is comfortably wider than any business day plus a night, so nothing a counter should still see is
 * cut off; the counter's own bizDayStart() filter remains the exact one.
 * ⚠️ It is a BOUND, not a purge. Nothing deletes these rows yet — that is still the day-close job the b262
 * migration notes as missing, and it is a storage question, not a correctness one.
 */
async function listHidden(db, entity_id, counter_id) {
  const r = await db.query(
    `SELECT product_id, shift_id, hidden_at, hidden_by FROM counter_hidden_item
      WHERE entity_id=$1 AND counter_id=$2 AND hidden_at >= now() - interval '2 days'`,
    [entity_id, counter_id]);
  return r.rows;
}

/** Idempotent by design — a queued offline write may replay, and re-hiding an already-hidden item must be a
 * no-op, not an error. `alsoCounters` (decision 3, 2026-09-18): the counters the person ticked in the "also
 * mark sold out on...?" prompt, IN ADDITION to `counter_id` itself — each gets its own row, no live sync. */
async function hideItem(db, entity_id, counter_id, product_id, shift_id, hidden_by, alsoCounters) {
  const targets = Array.from(new Set([counter_id].concat(Array.isArray(alsoCounters) ? alsoCounters : [])));
  const rows = [];
  for (const cid of targets) {
    const r = await db.query(
      `INSERT INTO counter_hidden_item (entity_id, counter_id, shift_id, product_id, hidden_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (entity_id, counter_id, product_id) DO UPDATE SET hidden_at = now(), hidden_by = EXCLUDED.hidden_by
       RETURNING *`,
      [entity_id, cid, shift_id || null, product_id, hidden_by || null]);
    rows.push(r.rows[0]);
  }
  return rows;
}

async function unhideItem(db, entity_id, counter_id, product_id, alsoCounters) {
  const targets = Array.from(new Set([counter_id].concat(Array.isArray(alsoCounters) ? alsoCounters : [])));
  const r = await db.query(
    `DELETE FROM counter_hidden_item WHERE entity_id=$1 AND counter_id = ANY($2::text[]) AND product_id=$3`,
    [entity_id, targets, product_id]);
  return { removed: r.rowCount };
}

// ── screen style, per counter or the shop's default ─────────────────────────────────────────────────────────

async function getScreenConfig(db, entity_id, counter_id) {
  if (counter_id) {
    const r = await db.query(`SELECT config, updated_at FROM device_screen_config WHERE entity_id=$1 AND counter_id=$2`, [entity_id, counter_id]);
    if (r.rows.length) return r.rows[0];
  }
  const d = await db.query(`SELECT config, updated_at FROM device_screen_config WHERE entity_id=$1 AND counter_id IS NULL`, [entity_id]);
  return d.rows[0] || { config: {}, updated_at: null };
}

/** counter_id null writes the shop's default (what a new counter starts from); a real id writes that one counter. */
async function setScreenConfig(db, entity_id, counter_id, config, user_id) {
  const r = counter_id
    ? await db.query(
        `INSERT INTO device_screen_config (entity_id, counter_id, config, updated_by) VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (entity_id, counter_id) WHERE counter_id IS NOT NULL
         DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [entity_id, counter_id, JSON.stringify(config || {}), user_id || null])
    : await db.query(
        `INSERT INTO device_screen_config (entity_id, counter_id, config, updated_by) VALUES ($1, NULL, $2::jsonb, $3)
         ON CONFLICT (entity_id) WHERE counter_id IS NULL DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [entity_id, JSON.stringify(config || {}), user_id || null]);
  return r.rows[0];
}

module.exports = {
  listGroups, createGroup, updateGroup, deleteGroup, addItem, removeItem, reorderItems,
  getActiveGroups, setActiveGroups, listHidden, hideItem, unhideItem,
  getScreenConfig, setScreenConfig,
};
