// @stage tested
// @stage-note ONE read of everything a tax resolution needs for an entity: own live slabs + governed slabs, categories, face.
'use strict';
/**
 * tax-shelf.js — the tax context, read once per order / per send, for both paths.
 *
 * routes/catalogue.js read its own copy of this (own slabs + categories + face) for storefront orders, and it read
 * the ENTITY'S slabs only — a product citing the jurisdiction's `IN-GST-18` (b201) resolved nothing on a storefront
 * order while the product page showed the split. The send path (B2B compose) read nothing at all. One reader, both
 * callers, governed slabs included.
 *
 * ⚠️ FAILS OPEN. A shelf that cannot be read → null → the lines carry no rate, exactly as before. Failing closed
 * would make a tax shelf a prerequisite for trading at all (an un-migrated entity has no definitions table).
 */
const taxSlab = require('./tax-slab');
const taxGov = require('./tax-governance');

/**
 * readShelf(entity_id, { withEntity, query, regionLayer, getFace }) → { slabs: Map, categories, face, items? } | null
 * `getFace(entity_id)` is injected so this file does not depend on catalogue-view; `withItems` also loads the
 * entity's active catalogue rows (item_id + item_data) for name/id matching at send.
 */
async function readShelf(entity_id, deps, opts) {
  /* applyDue runs INSIDE the one transaction below — a second withEntity here was four more round trips */
  const d = deps || {}, o = opts || {};
  if (!entity_id || typeof d.withEntity !== 'function') return null;
  try {
    const [defsAndItems, face, gov] = await Promise.all([
      d.withEntity(entity_id, async (db) => {
        try { await require('./schedule').applyDue(entity_id, db); } catch (_) {}
        const defs = await db.query(
        `SELECT d.definition_id, d.kind, d.name, v.rules
           FROM definition d
           LEFT JOIN definition_version v
             ON v.definition_id = d.definition_id AND v.version = d.current_version
          WHERE d.entity_id = $1 AND d.kind IN ('tax','category') AND d.status = 'live'`, [entity_id]);
        /* ⭐ WHO MAY CHARGE GST: a seller WITH a GSTIN. Read in the same transaction (no extra trip across the Pacific). */
        const reg = await db.query(`SELECT gstn FROM identities WHERE identity_id = $1`, [entity_id]).catch(() => ({ rows: [] }));
        const items = o.withItems
          ? await db.query(`SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id]).catch(() => ({ rows: [] }))
          : { rows: [] };
        return { defs, items, gstn: (reg.rows[0] && reg.rows[0].gstn) || null };
      }),
      (typeof d.getFace === 'function' ? d.getFace(entity_id) : Promise.resolve(null)).catch(() => null),
      (typeof d.query === 'function' && typeof d.regionLayer === 'function')
        ? taxGov.governedSlabsFor(entity_id, { query: d.query, regionLayer: d.regionLayer }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const defs = defsAndItems.defs, items = defsAndItems.items;
    /**
     * ⭐⭐ NO GSTIN, NO GST — DECIDED ONCE, HERE, FOR EVERY SURFACE. Athi, 2026-09-05: "the cart is the fundamental unit of data
     * movement; if it is not talking the same through different means we can just forget this product." Found by [SB-01] and
     * [CAP-02]: a seller with no GSTIN saw GST 5% ₹18 in the cart (the shelf resolved the item's own rate) while the invoice
     * said ₹360 (tax.js: seller state unknown → nothing charged). Two deciders. Now the shelf itself is the decider: under the
     * GST scheme a seller without a GSTIN has NO shelf, so the catalogue view carries no tax, the send stamps no rate and the
     * invoice charges none — ₹360 on every surface; with a GSTIN, ₹378 on every surface. A VAT-type scheme (a governed slab
     * that names one) is not gated here: its registration is a different fact (b202).
     */
    const govScheme = (gov || []).some((sl) => sl && sl.scheme && String(sl.scheme).toUpperCase() !== 'GST');
    if (!govScheme && !String(defsAndItems.gstn || '').trim()) return null;
    const rows = defs.rows || [];
    const own = rows.filter((r) => r.kind === 'tax');
    return {
      /* governed first so an entity slab with the same id (impossible by construction) could never shadow it */
      slabs: taxSlab.indexSlabs(gov.concat(own)),
      categories: rows.filter((r) => r.kind === 'category'),
      face: face || {},
      items: items.rows || [],
    };
  } catch (_) { return null; }
}

module.exports = { readShelf };
