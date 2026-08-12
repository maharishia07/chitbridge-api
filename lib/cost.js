'use strict';
// lib/cost.js — cost and margin (b145). Private to the entity, and gated WITHIN it.
//
// Athi, 2026-08-12: *"money cannot be seen by everyone, the cost accumulates here, not the difference"* — then,
// on being shown that hiding a field does not hide a number: **write-without-read**.
//
// ── ⚠️ WHY THE GATE IS HERE AND NOT IN RLS ──────────────────────────────────────────────────────────────────────
// Every other isolation rule in CB is entity-level, and RLS enforces it. This one is not: Murugan IS the entity as
// far as Postgres is concerned. RLS cannot distinguish two actors of the same tenant, so the gate is in this file
// — which means it is only as good as the callers. Every read path that touches money must come through canRead().
//
// ── ⚠️ HIDING THE MARGIN FIELD WOULD NOT HAVE WORKED ────────────────────────────────────────────────────────────
// A worker who can see the goods cost AND the quoted price computes the margin in his head. The number would be
// unlabelled, not hidden. So the permission is about READING AT ALL, and a permitted reader gets everything while
// an unpermitted one gets only the rows they entered themselves.
const { withEntity } = require('../db');

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const KINDS = ['goods', 'labour', 'transport', 'other'];
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * canRead(req) — may this identity see cost totals and margin?
 *
 * ⚠️ THE ENTITY LOGIN ALWAYS MAY; an actor only with `can_see_costs`. Default false, so a newly added co-assist
 * cannot read the buying price on day one by accident. Returns false rather than throwing when the column is
 * missing (pre-b145), which fails CLOSED — the safe direction for a money permission.
 */
async function canRead(req, entity_id) {
  if (!req || !req.identity) return false;
  if (req.identity.identity_type !== 'actor') return true;      // the entity itself
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      'SELECT can_see_costs FROM identities WHERE identity_id = $1', [req.identity.identity_id]));
    return !!(r.rows[0] && r.rows[0].can_see_costs);
  } catch (e) { if (notMigrated(e)) return false; throw e; }
}

/**
 * record(entity_id, chit_id, rows, who) — add costs. ANY actor may write.
 *
 * ⚠️ WRITING IS OPEN ON PURPOSE. Murugan recording his own 80 minutes is the point of the feature; making him ask
 * someone with the money permission to type it for him would mean it never gets recorded, and then the margin is
 * wrong in the direction that flatters us.
 * ⚠️ line_id IS OPTIONAL — omit it for a whole-chit cost (one auto fare for one trip). Splitting that across lines
 * would invent an allocation nobody agreed to.
 */
async function record(entity_id, chit_id, rows, who = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) { const e = new Error('Nothing to record'); e.status = 400; throw e; }
  const prepared = list.map((r) => {
    const kind = KINDS.includes(r.kind) ? r.kind : 'other';
    let amount = Number(r.amount);
    const mins = r.minutes == null ? null : Number(r.minutes);
    const rate = r.rate_per_hour == null ? null : Number(r.rate_per_hour);
    /* Labour is entered the way it is known — "80 min at ₹150/hr" — and the amount is derived from it. Both are
       kept so the rate can be questioned later, not just the product. */
    if (!Number.isFinite(amount) && Number.isFinite(mins) && Number.isFinite(rate)) amount = r2(mins / 60 * rate);
    if (!Number.isFinite(amount) || amount === 0) {
      const e = new Error('amount must be a non-zero number (or give minutes + rate_per_hour) — a negative value corrects an earlier cost');
      e.status = 400; throw e;
    }
    return { line_id: r.line_id || null, kind, amount: r2(amount),
             currency: (r.currency || 'INR').slice(0, 3).toUpperCase(),
             minutes: Number.isFinite(mins) ? mins : null,
             rate: Number.isFinite(rate) ? rate : null,
             note: r.note ? String(r.note).slice(0, 300) : null };
  });
  try {
    return await withEntity(entity_id, async (db) => {
      const out = [];
      for (const p of prepared) {
        const q = await db.query(
          `INSERT INTO chit_line_cost (chit_id, entity_id, line_id, kind, amount, currency, minutes, rate_per_hour,
                                       note, recorded_by_actor_id, recorded_by_actor_name)
           VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid,$11)
           RETURNING cost_id, line_id, kind, amount, currency, minutes, rate_per_hour, note, recorded_by_actor_name, created_at`,
          [chit_id, entity_id, p.line_id, p.kind, p.amount, p.currency, p.minutes, p.rate, p.note,
           who.actor_id || null, who.actor_name || null]);
        out.push(q.rows[0]);
      }
      return { costs: out };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) { const x = new Error('Cost is not migrated on this environment (b145).'); x.status = 503; throw x; } throw e; }
}

/**
 * ⭐ read(entity_id, chit_id, opts) — costs and margin, or just my own rows.
 *
 * opts: { permitted: boolean, actor_id }
 *
 * ⚠️ WHEN NOT PERMITTED IT RETURNS ONLY THE CALLER'S OWN ROWS AND NO TOTALS AT ALL — not zeroed totals, not a
 * masked string. An empty `margin` key would still tell a reader that a margin exists and roughly when it moved;
 * the honest answer to "may I see this" is to not send it.
 *
 * ⚠️ MARGIN IS COMPUTED HERE, NEVER STORED. invoiced − costs, and it goes stale the instant an amendment or a new
 * cost lands, which is exactly why it must not be a column.
 */
async function read(entity_id, chit_id, opts = {}) {
  try {
    const args = [entity_id, chit_id];
    let scope = '';
    if (!opts.permitted) {
      args.push(opts.actor_id || '00000000-0000-0000-0000-000000000000');
      scope = ` AND recorded_by_actor_id = $${args.length}::uuid`;
    }
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT cost_id, line_id, kind, amount, currency, minutes, rate_per_hour, note,
              recorded_by_actor_id, recorded_by_actor_name, created_at
         FROM chit_line_cost WHERE entity_id = $1 AND chit_id = $2${scope}
        ORDER BY created_at`, args));
    const costs = r.rows.map((x) => Object.assign({}, x, { amount: Number(x.amount) }));

    if (!opts.permitted) {
      /* Everything a worker needs to check what he entered, and nothing that adds up to somebody else's business. */
      return { costs, mine_only: true, can_see_totals: false };
    }

    /* ⚠️ PER CURRENCY, NEVER SUMMED ACROSS. Same rule as everywhere else on the rail: one figure spanning two
       currencies means nothing, most convincingly when it looks tidy. */
    const byKind = {}, byCur = {};
    for (const c of costs) {
      byKind[c.kind] = r2((byKind[c.kind] || 0) + c.amount);
      byCur[c.currency] = r2((byCur[c.currency] || 0) + c.amount);
    }
    const h = await withEntity(entity_id, (db) => db.query(
      `SELECT total_value, currency_code FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]));
    const invoiced = h.rows[0] && h.rows[0].total_value != null ? Number(h.rows[0].total_value) : null;
    const cur = (h.rows[0] && h.rows[0].currency_code) || 'INR';
    const spent = byCur[cur] || 0;

    /* ⚠️ NULL WHEN THERE IS NOTHING TO COMPARE AGAINST, never 0. An un-valued chit is not a chit with no margin —
       it is a chit whose margin is unknown, and money.js already paid for confusing those two. */
    const margin = (invoiced === null) ? null : r2(invoiced - spent);
    const pct = (invoiced === null || invoiced === 0) ? null : r2(margin / invoiced * 100);

    return { costs, can_see_totals: true,
             by_kind: byKind, by_currency: byCur,
             invoiced, currency: cur, spent: r2(spent), margin, margin_pct: pct,
             ...(Object.keys(byCur).length > 1 ? { mixed_currency: true } : {}) };
  } catch (e) { if (notMigrated(e)) return null; throw e; }
}

module.exports = { record, read, canRead, KINDS };
