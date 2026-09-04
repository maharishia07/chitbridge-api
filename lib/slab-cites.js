// @stage tested
// @stage-note Who cites a tax slab (products by tax_slab, categories by rules.default_slab), and the hand-over to another slab.
'use strict';
/**
 * A SLAB MUST NOT GO DARK UNDER THE PRODUCTS THAT CITE IT. Athi, 2026-09-05: a slab he authored, retired once the
 * governance rows arrived, left a product citing a dead id with "no rate to show" — "the system should reject and ask
 * another slab to take over". So: retiring (or un-living) a slab that anything cites is REFUSED with the counts, and
 * accepted with a `takeover` slab, which re-points every citer in one transaction before the status changes. The
 * takeover copies the travelling rate onto each product (tax_slab_name · gst_rate) exactly as a hand pick would.
 *
 * WITH RLS — every write runs inside withEntity(entity). Governed ids (IN-GST-18 …) are valid takeovers; they are never
 * retired here (definitions.js refuses that earlier).
 */
const S = require('./tax-slab');

/** cites(db, slabId) → { products, categories } — how many rows point at this slab right now. */
async function cites(db, slabId) {
  const p = await db.query(`SELECT count(*)::int AS n FROM catalogue_items WHERE is_active = true AND item_data->>'tax_slab' = $1`, [slabId]);
  const c = await db.query(
    `SELECT count(*)::int AS n FROM definition d JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
      WHERE d.kind = 'category' AND d.status <> 'retired' AND v.rules->>'default_slab' = $1`, [slabId]);
  return { products: p.rows[0].n, categories: c.rows[0].n };
}

/** takeover(db, fromId, toSlab) → { products, categories } re-pointed. `toSlab` is a normalised slab (slabOf) or {id,name,rate}. */
async function takeover(db, fromId, toSlab) {
  const to = toSlab || {};
  if (!to.id) throw new Error('takeover slab has no id');
  const patch = { tax_slab: String(to.id), tax_slab_name: to.name || null };
  if (to.rate !== null && to.rate !== undefined) patch.gst_rate = to.rate;
  const p = await db.query(
    `UPDATE catalogue_items SET item_data = item_data || $2::jsonb, updated_at = NOW()
      WHERE is_active = true AND item_data->>'tax_slab' = $1`, [fromId, JSON.stringify(patch)]);
  const c = await db.query(
    `UPDATE definition_version v SET rules = COALESCE(v.rules, '{}'::jsonb) || jsonb_build_object('default_slab', $2::text)
       FROM definition d
      WHERE d.definition_id = v.definition_id AND v.version = d.current_version
        AND d.kind = 'category' AND d.status <> 'retired' AND v.rules->>'default_slab' = $1`, [fromId, String(to.id)]);
  return { products: p.rowCount, categories: c.rowCount };
}

/**
 * guard(db, slabId, takeoverId, resolveSlab) → null when the change may proceed, else { status, body }.
 * `resolveSlab(id)` returns the normalised takeover slab or null (own live slab or governed).
 */
async function guard(db, slabId, takeoverId, resolveSlab) {
  const n = await cites(db, slabId);
  if (!n.products && !n.categories) return null;
  if (!takeoverId) {
    return { status: 409, body: { error: 'cited', products: n.products, categories: n.categories,
      message: `${n.products} product(s) and ${n.categories} categor${n.categories === 1 ? 'y' : 'ies'} cite this slab. Pick the slab that takes over, or they lose their rate.` } };
  }
  if (String(takeoverId) === String(slabId)) return { status: 400, body: { error: 'same', message: 'The takeover slab is the one being retired.' } };
  const to = await resolveSlab(String(takeoverId));
  if (!to) return { status: 400, body: { error: 'no_takeover', message: 'The takeover slab is not a live slab here.' } };
  const moved = await takeover(db, slabId, to);
  return { status: 0, moved, to };   /* 0 = proceed; the caller reports `moved` */
}

/** pure, for tests and for the pane: is this answer a dead citation? */
function isDead(resolved) { return !!(resolved && resolved.unresolved && resolved.cited); }

module.exports = { cites, takeover, guard, isDead, S };
