'use strict';
// lib/cost.js — cost and margin (b145). Private to the entity, and gated WITHIN it.
//
// OWNS      canRead · canReadSafe · record · read (cost rows and margin) · writeRefusal (a cost-blind co-assist writes `status` only) · costKeyRefusal (a cost-blind CREATE carries no cost key, CAT-235) · isCostKey · costKeysIn
// CALLED BY routes/products.js (every cost-blind answer and write door) · routes/till.js · routes/chits.js · routes/entities.js
// FLOW      request → identity is an actor? → can_see_costs (fails closed) → null, or the 403 COST_BLIND body with `blocked` (key names, never values)
// CARD      07-offers-pricing-and-combos/cost-and-margin-per-item
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
const { round: roundMoney } = require('./money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const KINDS = ['goods', 'labour', 'transport', 'other'];
const r2 = (v) => roundMoney(Number(v));

/**
 * canRead(req) — may this identity see cost totals and margin?
 *
 * ⚠️ THE ENTITY LOGIN ALWAYS MAY; an actor only with `can_see_costs`. Default false, so a newly added co-assist
 * cannot read the buying price on day one by accident. Returns false rather than throwing when the column is
 * missing (pre-b145), which fails CLOSED — the safe direction for a money permission.
 */
async function canRead(req, entity_id) {
  if (!req || !req.identity) return false;
  if (req.identity.identity_type !== 'actor') return true; // the entity itself
  try {
    const r = await withEntity(entity_id, (db) => db.query('SELECT can_see_costs FROM identities WHERE identity_id = $1', [req.identity.identity_id]));
    return !!(r.rows[0] && r.rows[0].can_see_costs);
  } catch (e) {
    if (notMigrated(e)) return false;
    throw e;
  }
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
  if (!list.length) {
    const e = new Error('Nothing to record');
    e.status = 400;
    throw e;
  }
  const prepared = list.map((item) => {
    const kind = KINDS.includes(item.kind) ? item.kind : 'other';
    let amount = Number(item.amount);
    const mins = item.minutes == null ? null : Number(item.minutes);
    const rate = item.rate_per_hour == null ? null : Number(item.rate_per_hour);
    /* Labour is entered the way it is known — "80 min at ₹150/hr" — and the amount is derived from it. Both are
       kept so the rate can be questioned later, not just the product. */
    if (!Number.isFinite(amount) && Number.isFinite(mins) && Number.isFinite(rate)) amount = r2((mins / 60) * rate);
    if (!Number.isFinite(amount) || amount === 0) {
      const e = new Error('amount must be a non-zero number (or give minutes + rate_per_hour) — a negative value corrects an earlier cost');
      e.status = 400;
      throw e;
    }
    return {
      line_id: item.line_id || null,
      kind,
      amount: r2(amount),
      currency: item.currency ? String(item.currency).slice(0, 3).toUpperCase() : null /* T2-NATDEF: unstated stays unstated */,
      minutes: Number.isFinite(mins) ? mins : null,
      rate: Number.isFinite(rate) ? rate : null,
      note: item.note ? String(item.note).slice(0, 300) : null
    };
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
          [chit_id, entity_id, p.line_id, p.kind, p.amount, p.currency, p.minutes, p.rate, p.note, who.actor_id || null, who.actor_name || null]
        );
        out.push(q.rows[0]);
      }
      return { costs: out };
    });
  } catch (e) {
    if (e.status) throw e;
    if (notMigrated(e)) {
      const x = new Error('Cost is not migrated on this environment (b145).');
      x.status = 503;
      throw x;
    }
    throw e;
  }
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
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT cost_id, line_id, kind, amount, currency, minutes, rate_per_hour, note,
              recorded_by_actor_id, recorded_by_actor_name, created_at
         FROM chit_line_cost WHERE entity_id = $1 AND chit_id = $2${scope}
        ORDER BY created_at`,
        args
      )
    );
    const costs = r.rows.map((x) => Object.assign({}, x, { amount: Number(x.amount) }));

    if (!opts.permitted) {
      /* Everything a worker needs to check what he entered, and nothing that adds up to somebody else's business. */
      return { costs, mine_only: true, can_see_totals: false };
    }

    /* ⚠️ PER CURRENCY, NEVER SUMMED ACROSS. Same rule as everywhere else on the rail: one figure spanning two
       currencies means nothing, most convincingly when it looks tidy. */
    const byKind = {},
      byCur = {};
    for (const c of costs) {
      byKind[c.kind] = r2((byKind[c.kind] || 0) + c.amount);
      byCur[c.currency] = r2((byCur[c.currency] || 0) + c.amount);
    }
    /* ⚠️ total_value LIVES ON chit_detail, NOT chit_header — chit_deliver() never writes it to the header. Reading
       it from the wrong table raised 42703 (undefined column), which this file's notMigrated catch turned into a
       503 "b145 is not migrated" and sent Athi back to the SQL editor for a migration that had applied perfectly.
       Second time in one evening that a swallowed error code pointed at the database instead of at me. */
    const h = await withEntity(entity_id, (db) =>
      db.query(`SELECT total_value, currency_code FROM chit_detail WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id])
    );
    const invoiced = h.rows[0] && h.rows[0].total_value != null ? Number(h.rows[0].total_value) : null;
    const cur = (h.rows[0] && h.rows[0].currency_code) || null;
    const spent = byCur[cur] || 0;

    /* ⚠️ NULL WHEN THERE IS NOTHING TO COMPARE AGAINST, never 0. An un-valued chit is not a chit with no margin —
       it is a chit whose margin is unknown, and money.js already paid for confusing those two. */
    const margin = invoiced === null ? null : r2(invoiced - spent);
    const pct = invoiced === null || invoiced === 0 ? null : r2((margin / invoiced) * 100);

    return {
      costs,
      can_see_totals: true,
      by_kind: byKind,
      by_currency: byCur,
      invoiced,
      currency: cur,
      spent: r2(spent),
      margin,
      margin_pct: pct,
      ...(Object.keys(byCur).length > 1 ? { mixed_currency: true } : {})
    };
  } catch (e) {
    /* ⚠️ SAY WHICH TABLE IS MISSING BEFORE SWALLOWING IT. A bare `return null` here becomes a 503 that blames the
       migration, and twice tonight that sent the wrong person looking in the wrong place. If the answer really is
       "not migrated", the log now names the relation so the next person can check it in one line. */
    if (notMigrated(e)) {
      console.error('cost.read treating as not-migrated:', e.code, e.message);
      return null;
    }
    throw e;
  }
}

/**
 * canReadSafe(req, entity_id) — canRead() that can never throw. On ANY error an actor is treated as unable to
 * see costs (fail closed); the entity login is always true. The one wrapper every cost-stripping route uses
 * (products list, export, workbook, versions, till stock/match, supplies) — [OFFR-04].
 */
async function canReadSafe(req, entity_id) {
  try {
    return await canRead(req, entity_id);
  } catch (e) {
    console.error('[OFFR-04] cost-visibility check failed:', e.message);
    return !req.identity || req.identity.identity_type !== 'actor';
  }
}

/**
 * ⭐ writeRefusal(req, entity_id, keys) → null, or the 403 body for a cost-blind co-assist writing a priced field.
 * [OFFR-04] all such an actor may touch is the availability flag (`status`) — not price, modifiers or name: a person who
 * cannot see what a change would cost the margin should not make it. Lifted out of PATCH /products (T3-FIXES, CAT-FIX1)
 * so POST /till/price, POST /products/:id/schedule and the combo push ask the SAME question, not a copy of it.
 * The entity itself (and a till paired by its key) is never refused. `code` is what a client branches on.
 */
const COST_BLIND_ALLOWED_FIELDS = ['status'];
async function writeRefusal(req, entity_id, keys) {
  if (!req || !req.identity || req.identity.identity_type !== 'actor') return null;
  const blocked = (keys || []).filter((item) => COST_BLIND_ALLOWED_FIELDS.indexOf(item) < 0);
  if (!blocked.length || (await canReadSafe(req, entity_id))) return null;
  return {
    error: 'Not permitted',
    code: 'COST_BLIND',
    blocked,
    message:
      'Your access does not include cost or price. You can change availability; the account ' +
      'owner can grant "Sees costs" in Co-assists to change: ' +
      blocked.join(', ') +
      '.'
  };
}

/** the ONE definition of a cost key: `cost` and every `cost_*` (routes/products dropCostKeys strips by it; costKeyRefusal refuses by it) */
const isCostKey = (key) => /^cost(_|$)/.test(key);
/** the distinct cost-key names found at ANY depth of a value (objects and arrays: modifiers[].options[].cost …); [] for none */
function costKeysIn(value, found = new Set()) {
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => (isCostKey(key) ? found.add(key) : costKeysIn(value[key], found)));
  }
  return Array.from(found);
}
/**
 * ⭐ costKeyRefusal(req, entity_id, values) → null, or the 403 body when a cost-blind co-assist's CREATE (or an import row) carries a cost key.
 * CAT-235 part 2: a create stays open to them (a named, unpriced item is by design) — only `cost` / `cost_*` are refused, at any depth;
 * price, name and the rest are untouched. The actor test is writeRefusal's: an actor without can_see_costs. Same code and shape (`blocked` = key names, never values).
 */
async function costKeyRefusal(req, entity_id, values) {
  if (!req || !req.identity || req.identity.identity_type !== 'actor') return null;
  const blocked = costKeysIn(values);
  if (!blocked.length || (await canReadSafe(req, entity_id))) return null;
  return {
    error: 'Not permitted',
    code: 'COST_BLIND',
    blocked,
    message: 'Your access does not include cost. You can add the item without it; the account owner can grant "Sees costs" in Co-assists to send: ' + blocked.join(', ') + '.'
  };
}

module.exports = { record, read, canRead, canReadSafe, writeRefusal, costKeyRefusal, isCostKey, costKeysIn, COST_BLIND_ALLOWED_FIELDS, KINDS };
