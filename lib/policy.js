// lib/policy.js — THE per-entity policy flags, server-side and real (b130).
//
// Athi, 2026-08-09: *"make the policy flags real, move it to settings."*
//
// They were a localStorage prototype: the card said "set ✓", nothing left the browser, and the server that is
// supposed to ENFORCE them never heard. This is the one place they are defined, validated and read.
//
// ── ⚠️ THE SCHEMA IS THE WHITELIST ──────────────────────────────────────────────────────────────────────────────
// A flag not in FLAGS does not exist. `policy_flags` is a jsonb column and a PATCH that could spread arbitrary keys
// into it would make an entity's own governance a place callers can write.
//
// ── ⚠️ self_copy_pref IS PROXIED, NOT COPIED ────────────────────────────────────────────────────────────────────
// It has its own column, and that column is what /api/chits/send reads to suppress a copy. Storing it here as well
// would create two facts about one entity that drift the first time one write path is missed. So it is read from
// and written to the column, and merely PRESENTED alongside the rest.
const { query } = require('../db');

/**
 * ⚠️ `trade_side` — AN ENTITY IS CREATED FOR A PURPOSE. Athi, 2026-08-09: *"we are creating entity for a purpose,
 * sell and purchase never been the same entity. while testing we are trying to test all the possibility in the
 * same business, so for us it seems the same entity will do everything, but that is not going to be the case."*
 *
 * That is why this is an ENTITY setting and not the per-message toggle I first built. A catalogue price is a
 * SELL-SIDE price: right for a shop taking an order, wrong for a factory receiving milk, where it would price an
 * inbound supply notice off what the factory sells at. Which one an entity is does not change message to message.
 */
const FLAGS = {
  trade_side:        { type: 'enum',   options: ['sell', 'receive'], def: 'sell' },
  /**
   * ⚠️ `received`, NOT `both` — THIS DEFAULT DISAGREED WITH THE ENGINE FOR MONTHS (Athi's call, 2026-08-16).
   *
   * `routes/chits.js:302` has always done `|| 'received'`. This file presented `both`. So an entity that never
   * opened Settings was TOLD one thing and BEHAVED as another — the worst kind of policy bug, because the screen
   * is the only place anyone would look to find out, and it was the wrong place.
   *
   * The engine's reasoning is the stronger one and is why it won: filing a self-chit in Order asserts *"I sent
   * this to a counterparty"*, which is false. A self-chit is work you gave yourself.
   *
   * ⚠️ ONLY THE UNSET DEFAULT MOVES. An entity that explicitly saved `both` keeps it — the column is read first
   * and this value is the fallback. Nothing is rewritten.
   */
  self_copy_pref:    { type: 'enum',   options: ['both', 'sent', 'received'], def: 'received', column: 'self_copy_pref' },
  chit_expiry_days:  { type: 'number', def: 0, min: 0, max: 3650 },
  retention_days:    { type: 'number', def: 0, min: 0, max: 3650 },
  /**
   * ⚠️ "OVERDUE" IS A POLICY, NOT A CONSTANT IN A REPORT. Folder metrics and the counterparty scorecard both need
   * to say how old an OPEN chit must be before it counts as late. Baked into the query it is a rule nobody can see
   * or change; declared here it is one number, visible in Settings, and both surfaces read the same one.
   */
  overdue_days:      { type: 'number', def: 7, min: 1, max: 365 },
  /**
   * ⚠️ THE TOLERANCE THRESHOLD — from the procurement three-way-match research. Within this variance a mismatch is
   * absorbed; beyond it, it is an exception worth a human. It is the honest answer to "when does a mismatch become
   * a dispute?", and because it decides that, it MUST be declared and governed rather than hard-coded — which is
   * exactly what every AP system means by a tolerance rule.
   *
   * ⚠️ DECLARED BUT NOT YET ENFORCED. Nothing reads it to raise an exception; the matching engine does not exist.
   * It is here so the number has one home when it does — and it is reported as unenforced rather than implied.
   */
  match_tolerance_pct: { type: 'number', def: 2, min: 0, max: 50 },
};
// Platform-bound: presented so the cascade is visible, never writable. A relaxable USP is not a USP.
const BOUND = { dispute_scope: 'per-party' };

const defaults = () => {
  const o = {};
  for (const k of Object.keys(FLAGS)) o[k] = FLAGS[k].def;
  return Object.assign(o, BOUND);
};

function coerce(key, v) {
  const f = FLAGS[key];
  if (!f) return undefined;                                    // not in the schema → does not exist
  if (f.type === 'enum') return f.options.includes(String(v)) ? String(v) : undefined;
  if (f.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(f.min, Math.min(f.max, Math.trunc(n)));
  }
  return undefined;
}

// Read the effective flags. ⚠️ Never throws on a missing column: pre-b130 it answers the same defaults the code
// used before b130 existed, so an unmigrated environment behaves exactly as it did rather than 500ing on settings.
async function get(entity_id) {
  const out = defaults();
  try {
    const r = await query('SELECT policy_flags, self_copy_pref FROM identities WHERE identity_id = $1', [entity_id]);
    const row = r.rows[0] || {};
    const stored = row.policy_flags || {};
    for (const k of Object.keys(FLAGS)) {
      if (FLAGS[k].column) continue;                           // proxied below, not read from jsonb
      const v = coerce(k, stored[k]);
      if (v !== undefined) out[k] = v;
    }
    if (row.self_copy_pref) out.self_copy_pref = row.self_copy_pref;
    out._migrated = true;
  } catch (e) {
    if (!(e && e.code === '42703')) throw e;                   // 42703 = pre-b130; anything else is a real fault
    try {                                                      // the proxied column predates b130 and still answers
      const r2 = await query('SELECT self_copy_pref FROM identities WHERE identity_id = $1', [entity_id]);
      if (r2.rows[0] && r2.rows[0].self_copy_pref) out.self_copy_pref = r2.rows[0].self_copy_pref;
    } catch (_) {}
    out._migrated = false;
  }
  return out;
}

/**
 * Apply a patch. Returns the effective flags after the write.
 *
 * ⚠️ AN UNMIGRATED ENVIRONMENT REFUSES THE WRITE RATHER THAN SWALLOWING IT. The whole reason this file exists is
 * that the old card reported success and stored nothing. Answering 200 to a write that cannot land would rebuild
 * exactly that, one layer lower.
 */
async function set(entity_id, patch) {
  const clean = {};
  let proxied = null;
  for (const [k, raw] of Object.entries(patch || {})) {
    if (k in BOUND) { const e = new Error(k + ' is platform-bound and cannot be changed'); e.status = 400; throw e; }
    const v = coerce(k, raw);
    if (v === undefined) { const e = new Error('Unknown or invalid policy flag: ' + k); e.status = 400; throw e; }
    if (FLAGS[k].column) proxied = { column: FLAGS[k].column, value: v }; else clean[k] = v;
  }
  if (proxied) await query(`UPDATE identities SET ${proxied.column} = $1 WHERE identity_id = $2`, [proxied.value, entity_id]);
  if (Object.keys(clean).length) {
    try {
      // Merge, never replace: a PATCH of one flag must not blank the others.
      await query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`,
        [JSON.stringify(clean), entity_id]);
    } catch (e) {
      if (e && e.code === '42703') { const err = new Error('Policy flags are not migrated on this environment (b130).'); err.status = 503; throw err; }
      throw e;
    }
  }
  return get(entity_id);
}

module.exports = { FLAGS, BOUND, defaults, get, set };
