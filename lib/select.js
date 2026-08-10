'use strict';
// lib/select.js — WHICH CHITS. One resolver, every caller.
//
// ── ⚠️ WHY THIS EXISTS: FOUR FEATURES TURNED OUT TO BE TWO OPERATIONS ────────────────────────────────────────────
// Athi asked for folder metrics, folder rules, a counterparty scorecard, tolerance thresholds and SLA-style clocks,
// and asked what overlaps. Nearly all of it:
//
//     folder metrics       = MEASURE( SELECT by folder )
//     counterparty scorecard = MEASURE( SELECT by counterparty )
//     an SLA / ageing view = MEASURE( SELECT by filter )
//     a folder rule        = MATCH one chit against the same condition shape
//
// So there are two primitives — resolve a SET (here) and measure it (lib/measure.js) — not four features. That is
// the conclusion every reference system reached independently: Gmail, Jira and ServiceNow all hang metrics, rules
// and automation off ONE saved selector rather than building three mechanisms. See SPEC-folder-skills.md.
//
// ── ⚠️ IT ONLY EVER RETURNS THE CALLER'S OWN COPIES ─────────────────────────────────────────────────────────────
// Every query runs inside withEntity() AND names the entity in the WHERE clause. A chit is co-held: the
// counterparty holds their own row with their own status, their own filing and their own read time. Reading theirs
// would be a tenancy breach wearing a feature — and it is also why the scorecard is honest, because it is computed
// only from what we legitimately hold.
const { withEntity } = require('../db');

/**
 * The columns every measurement needs, joined once.
 *
 * `counterparty_*` is resolved HERE rather than by each caller, because "who is the other side" is direction-
 * dependent and getting it backwards is silent: on a RECEIVED copy the other side is the sender; on a SENT copy it
 * is the first receiver in all_recipients. A scorecard that mixed those up would score you against yourself.
 */
const COLS = `
  cs.chit_id, cs.current_status, cs.direction, cs.folder_id, cs.read_at, cs.archived_at,
  cs.created_at AS filed_at, cs.updated_at AS touched_at,
  ch.created_at, ch.purpose, ch.sender_entity_id, ch.sender_entity_display_name,
  ch.all_recipients, ch.summary_json,
  (ch.summary_json->>'total_value')::numeric AS value,
  ch.summary_json->>'currency_code'          AS currency,
  COALESCE(ch.open_dispute_count, 0)     AS open_disputes,
  COALESCE(ch.resolved_dispute_count, 0) AS resolved_disputes,
  CASE WHEN cs.direction = 'received' THEN ch.sender_entity_id
       ELSE (ch.all_recipients->1->>'entity_id')::uuid END          AS counterparty_id,
  CASE WHEN cs.direction = 'received' THEN ch.sender_entity_display_name
       ELSE ch.all_recipients->1->>'display_name' END               AS counterparty_name`;

/**
 * rows(entity_id, sel) — resolve a selector to the caller's own chit copies.
 *
 * sel:
 *   { folder_id }        everything filed in one folder
 *   { counterparty_id }  everything traded with one other entity (either direction)
 *   { direction }        'sent' | 'received'
 *   { status }           one current_status
 *   { since }            ISO date — chits created on or after
 *   { archived }         false (default) | true
 *
 * ⚠️ EVERY VALUE IS PARAMETERISED. This builds SQL from a caller-supplied object, which is exactly the shape that
 * becomes an injection hole the first time someone concatenates "just this one" — so nothing here is ever
 * interpolated: keys are matched against a fixed list, values always become $n.
 */
async function rows(entity_id, sel = {}) {
  const where = ['cs.entity_id = $1', 'cs.deleted_at IS NULL'];
  const args = [entity_id];
  const put = (sql, val) => { args.push(val); where.push(sql.replace('$?', '$' + args.length)); };

  where.push(sel.archived ? 'cs.archived_at IS NOT NULL' : 'cs.archived_at IS NULL');
  if (sel.folder_id) put('cs.folder_id = $?::uuid', sel.folder_id);
  if (sel.direction === 'sent' || sel.direction === 'received') put('cs.direction = $?', sel.direction);
  if (sel.status) put('cs.current_status = $?', String(sel.status));
  if (sel.since) put('ch.created_at >= $?::timestamp', sel.since);
  if (sel.purpose) put('ch.purpose = $?', String(sel.purpose));
  /* Either direction of trade with one counterparty. The OR is the point: a scorecard that only counted what they
     sent you would miss every order you placed with them. */
  if (sel.counterparty_id) {
    args.push(sel.counterparty_id);
    const n = '$' + args.length;
    where.push(`( (cs.direction = 'received' AND ch.sender_entity_id = ${n}::uuid)
              OR  (cs.direction = 'sent'     AND ch.all_recipients @> jsonb_build_array(jsonb_build_object('entity_id', ${n}::text))) )`);
  }

  const cap = Math.max(1, Math.min(5000, Number(sel.limit) || 2000));
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT ${COLS}
       FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
      WHERE ${where.join(' AND ')}
      ORDER BY ch.created_at DESC
      LIMIT ${cap}`, args));
  return r.rows;
}

/**
 * counterparties(entity_id, opts) — everyone this entity has actually traded with, newest first.
 *
 * Derived from the chits themselves, NOT from a contacts list: a scorecard should describe who you really deal
 * with, and a saved supplier you have never traded with has nothing to score.
 */
async function counterparties(entity_id, opts = {}) {
  const list = await rows(entity_id, { since: opts.since, limit: 5000 });
  const by = new Map();
  for (const r of list) {
    if (!r.counterparty_id || r.counterparty_id === entity_id) continue;   // self-chits have no other side
    const k = String(r.counterparty_id);
    if (!by.has(k)) by.set(k, { counterparty_id: k, name: r.counterparty_name, chits: 0, last_at: r.created_at });
    const e = by.get(k);
    e.chits++;
    if (new Date(r.created_at) > new Date(e.last_at)) e.last_at = r.created_at;
  }
  return [...by.values()].sort((a, b) => b.chits - a.chits);
}

module.exports = { rows, counterparties };
