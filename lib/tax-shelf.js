// @stage tested
// @stage-note ONE read of everything a tax resolution needs for an entity: own live slabs + governed slabs, categories, face.
// CARD 15-tax-and-country-packs/tax-compute-rate-invoice-tax
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
const log = require('./logger');
const taxGov = require('./tax-governance');

/**
 * readShelf(entity_id, { withEntity, query, regionLayer, getFace }) → { slabs: Map, categories, face, items? } | null
 * `getFace(entity_id)` is injected so this file does not depend on catalogue-view; `withItems` also loads the
 * entity's active catalogue rows (item_id + item_data) for name/id matching at send.
 */
async function readShelf(entity_id, deps, opts) {
  /* applyDue runs INSIDE the one transaction below — a second withEntity here was four more round trips */
  const d = deps || {},
    o = opts || {};
  if (!entity_id || typeof d.withEntity !== 'function') return null;
  try {
    const [defsAndItems, face, gov] = await Promise.all([
      d.withEntity(entity_id, async (db) => {
        try {
          await require('./schedule').applyDue(entity_id, db);
        } catch (e) {
          log.fellBack('tax-shelf readShelf: the helper failed — carried on without it', e);
        }
        const nestedDefs = await db.query(
          `SELECT d.definition_id, d.kind, d.name, v.rules
           FROM definition d
           LEFT JOIN definition_version v
             ON v.definition_id = d.definition_id AND v.version = d.current_version
          WHERE d.entity_id = $1 AND d.kind IN ('tax','category') AND d.status = 'live'`,
          [entity_id]
        );
        /* ⭐ WHO MAY CHARGE GST: a seller WITH a GSTIN. Read in the same transaction (no extra trip across the Pacific). */
        const reg = await db
          .query(`SELECT gstn FROM identities WHERE identity_id = $1`, [entity_id])
          .catch(log.orElse('tax-shelf readShelf: the read failed — answered with none', { rows: [] }));
        const nestedItems = o.withItems
          ? await db
              .query(`SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id])
              .catch(log.orElse('tax-shelf readShelf: the read failed — answered with none', { rows: [] }))
          : { rows: [] };
        return { defs: nestedDefs, items: nestedItems, gstn: (reg.rows[0] && reg.rows[0].gstn) || null };
      }),
      (typeof d.getFace === 'function' ? d.getFace(entity_id) : Promise.resolve(null)).catch(
        log.orElse('tax-shelf readShelf: failed — answered with nothing', null)
      ),
      typeof d.query === 'function' && typeof d.regionLayer === 'function'
        ? taxGov
            .governedSlabsFor(entity_id, { query: d.query, regionLayer: d.regionLayer })
            .catch(log.orElse('tax-shelf readShelf: failed — answered with none', []))
        : Promise.resolve([])
    ]);
    const defs = defsAndItems.defs,
      items = defsAndItems.items;
    /**
     * ⭐⭐ NO GSTIN, NO GST — DECIDED ONCE, HERE, FOR EVERY SURFACE. Athi, 2026-09-05: "the cart is the fundamental unit of data
     * movement; if it is not talking the same through different means we can just forget this product." Found by [SB-01] and
     * [CAP-02]: a seller with no GSTIN saw GST 5% ₹18 in the cart (the shelf resolved the item's own rate) while the invoice
     * said ₹360 (tax.js: seller state unknown → nothing charged). Two deciders. Now the shelf itself is the decider: under the
     * GST scheme a seller without a GSTIN has NO shelf, so the catalogue view carries no tax, the send stamps no rate and the
     * invoice charges none — ₹360 on every surface; with a GSTIN, ₹378 on every surface. A VAT-type scheme (a governed slab
     * that names one) is not gated here: its registration is a different fact (b202).
     */
    const govScheme = (gov || []).some((item) => item && item.scheme && String(item.scheme).toUpperCase() !== 'GST');
    if (!govScheme && !String(defsAndItems.gstn || '').trim()) return null;
    const rows = defs.rows || [];
    const own = rows.filter((item) => item.kind === 'tax');
    return {
      /* governed first so an entity slab with the same id (impossible by construction) could never shadow it */
      slabs: taxSlab.indexSlabs(gov.concat(own)),
      categories: rows.filter((item) => item.kind === 'category'),
      face: face || {},
      items: items.rows || []
    };
  } catch (e) {
    log.fellBack('tax-shelf readShelf: the read failed — answered with nothing', e);
    return null;
  }
}

/* ── DOES THIS SHOP CHARGE ITS TAX AT ALL? The server twin of the counter's shopTax().charges (till.html), F5 A1 critic 11 ──────────────── */
/**
 * a registration that may charge the tax → true, false (unregistered, composition) or null for 'unknown' (country-setup.registrationOf: nobody
 * said, ACC-198) — the QUESTION, never a yes, never a no. An absent type is a SCHEME nobody named on a registration that may exist: read regular.
 */
function registrationMayCharge(reg_type) {
  const registration = String(reg_type || 'regular').toLowerCase();
  if (registration === 'unknown') return null;
  return registration !== 'unregistered' && registration !== 'composition';
}
/**
 * chargesTax({ gstin | gstn, reg_type }, taxPack) → true when a sale of this shop carries its tax: a registration that may charge AND a tax id,
 * or a pack that collects without one (reg-us collect_without_tax_id). ⚠️ Never "has a GSTIN": a composition shop has one and charges none.
 * `taxPack` is tax-packs.packFor(country) (the pack's tax member) or null. reg_type 'unknown' → null (ask, ACC-198).
 */
function chargesTax(shop, taxPack) {
  const facts = shop || {};
  const hasTaxId = !!String(facts.gstin || facts.gstn || '').trim();
  const collectsWithoutId = !!(taxPack && taxPack.collect_without_tax_id);
  const mayCharge = registrationMayCharge(facts.reg_type);
  return mayCharge === null ? null : mayCharge && (hasTaxId || collectsWithoutId);
}
/** the tax's name in the shop's pack's words (GST · VAT …), never typed in code; 'tax' when no pack answers (lib/move-in taxWord_ reads the same door) */
function taxWordOf(country) {
  const meta = require('./country').meta(country);
  return (meta && meta.words && meta.words.taxName) || 'tax';
}

module.exports = { readShelf, registrationMayCharge, chargesTax, taxWordOf };
