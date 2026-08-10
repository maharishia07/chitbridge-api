'use strict';
// lib/folder-rules.js — condition → file into a folder (b132).
//
// ⚠️ SELF-HEALING. Every function answers sensibly when b132 has NOT been run: list() returns an empty set with a
// note, writes return 503 saying so, and the evaluation hook does nothing. The Channels panel learned this the hard
// way — naming a column that does not exist yet 503'd a whole screen to show one toggle.
//
// ⚠️ A RULE FILES; IT NEVER MUTATES. Filing is a view operation on your own copy, which is why it is safe to
// automate at all. There is no `then` column and no action vocabulary, deliberately.
const { withEntity } = require('../db');
const match = require('./match');

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => { const x = new Error('Folder rules are not migrated on this environment (b132).'); x.status = 503; return x; };

async function list(entity_id, folder_id) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT rule_id, folder_id, name, "when", enabled, sort, stop_processing, last_matched_at, match_count, created_at
         FROM folder_rule WHERE entity_id = $1 ${folder_id ? 'AND folder_id = $2' : ''}
        ORDER BY sort, created_at`, folder_id ? [entity_id, folder_id] : [entity_id]));
    return { rules: r.rows, migrated: true };
  } catch (e) {
    if (notMigrated(e)) return { rules: [], migrated: false, note: 'folder rules not migrated (b132)' };
    throw e;
  }
}

async function create(entity_id, folder_id, body = {}) {
  /* ⚠️ VALIDATED BEFORE IT IS STORED. An unknown condition key is refused rather than ignored — a rule that
     silently matches nothing still looks enabled, which is the worst state automation can be in. */
  const v = match.validate(body.when);
  if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO folder_rule (entity_id, folder_id, name, "when", enabled, sort, stop_processing)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       RETURNING rule_id, folder_id, name, "when", enabled, sort, stop_processing, match_count, created_at`,
      [entity_id, folder_id, String(body.name || '').slice(0, 80) || null, JSON.stringify(body.when),
       body.enabled !== false, Number(body.sort) || 0, !!body.stop_processing]));
    return r.rows[0];
  } catch (e) { if (notMigrated(e)) throw gone(); throw e; }
}

async function update(entity_id, rule_id, body = {}) {
  if (body.when !== undefined) {
    const v = match.validate(body.when);
    if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
  }
  const sets = [], args = [];
  const put = (col, val) => { args.push(val); sets.push(col + ' = $' + args.length + (col === '"when"' ? '::jsonb' : '')); };
  if (body.name !== undefined) put('name', String(body.name || '').slice(0, 80) || null);
  if (body.when !== undefined) put('"when"', JSON.stringify(body.when));
  if (body.enabled !== undefined) put('enabled', !!body.enabled);
  if (body.sort !== undefined) put('sort', Number(body.sort) || 0);
  if (body.stop_processing !== undefined) put('stop_processing', !!body.stop_processing);
  if (!sets.length) { const e = new Error('Nothing to update'); e.status = 400; throw e; }
  args.push(rule_id); args.push(entity_id);
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE folder_rule SET ${sets.join(', ')}, updated_at = now()
        WHERE rule_id = $${args.length - 1} AND entity_id = $${args.length}
        RETURNING rule_id, folder_id, name, "when", enabled, sort, stop_processing, match_count`, args));
    if (!r.rows[0]) { const e = new Error('Rule not found'); e.status = 404; throw e; }
    return r.rows[0];
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

async function remove(entity_id, rule_id) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      'DELETE FROM folder_rule WHERE rule_id = $1 AND entity_id = $2', [rule_id, entity_id]));
    return { deleted: r.rowCount };
  } catch (e) { if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * preview(entity_id, when, opts) — WHAT WOULD THIS RULE HAVE CAUGHT?
 *
 * ⚠️ THE MOST IMPORTANT FUNCTION IN THIS FILE. A rule is a promise about the future written by someone who cannot
 * see it. Running it against chits that already exist turns "I think this matches supplier invoices" into a list
 * you can read before you save. It is also the reason the condition vocabulary had to be the LIST vocabulary: a
 * rule that can be previewed is a rule that could have been a search.
 *
 * Read-only, and works whether or not b132 has been run — it needs no rules table, only the matcher.
 */
async function preview(entity_id, when, opts = {}) {
  const v = match.validate(when);
  if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
  const select = require('./select');
  const rows = await select.rows(entity_id, { limit: Number(opts.limit) || 500 });
  const hit = rows.filter((c) => match.match(c, when));
  return {
    scanned: rows.length,
    matched: hit.length,
    sample: hit.slice(0, 10).map((c) => ({
      chit_id: c.chit_id, subject: c.manual_subject || c.auto_subject || null,
      counterparty: c.counterparty_name, direction: c.direction, status: c.current_status, created_at: c.created_at,
    })),
  };
}

/**
 * fileArrival(entity_id, chit) — the hook. Returns the folder a chit was filed into, or null.
 *
 * ⚠️ BEST-EFFORT, ALWAYS. It is called after a chit is delivered; a rules failure must never fail the delivery. A
 * chit that arrives unfiled is a small annoyance, a chit that fails to arrive is a lost obligation.
 */
async function fileArrival(entity_id, chit) {
  try {
    const { rules, migrated } = await list(entity_id);
    if (!migrated || !rules.length) return null;
    const hit = match.firstMatch(chit, rules);
    if (!hit) return null;
    await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3 AND folder_id IS NULL`,
      [hit.folder_id, chit.chit_id, entity_id]));
    /* Observability: a rule that quietly stopped matching should be visible, not assumed to be working. */
    await withEntity(entity_id, (db) => db.query(
      `UPDATE folder_rule SET match_count = match_count + 1, last_matched_at = now() WHERE rule_id = $1 AND entity_id = $2`,
      [hit.rule_id, entity_id]));
    return { folder_id: hit.folder_id, rule_id: hit.rule_id };
  } catch (_) { return null; }
}

module.exports = { list, create, update, remove, preview, fileArrival };
