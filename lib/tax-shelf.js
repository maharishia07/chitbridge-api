// OWNS      the tax context for an entity read once per order or send: own live slabs, governed slabs, categories and the face, shared by the storefront and the send path
// FLOW      readShelf(entity_id, injected readers) ──▶ own + governed slabs, categories, face (items when asked) ──▶ the caller resolves rates; unreadable slabs = null (fails open); an unreadable tax id = refused (503)
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
 * ⚠️ FAILS OPEN for slabs, categories, the face and the governed list: a shelf that cannot read THOSE → null → the lines carry no rate, exactly as before (an un-migrated entity has no
 * definitions table). ⚠️ FAILS CLOSED for the one fact that decides whether tax is charged at all (TAX01-1): the shop's identities row. A failed read of it is NOT "no GSTIN, so no GST"
 * (1,000 at 18% invoiced 1,000): it throws TAX_SHELF_UNREADABLE (503, refused:true, in words), and the caller's door answers it; the bill is not made on a guess.
 */
const taxSlab = require('./tax-slab');
const log = require('./logger');
const taxGov = require('./tax-governance');

const UNREADABLE = 'TAX_SHELF_UNREADABLE';
/** TAX01-1: the refusal a failed read of the shop's tax facts raises: a 503 the knownerr door answers in words (refused + status + code), never a silent "no tax" */
function unreadable(cause) {
  return Object.assign(new Error('The shop’s tax details could not be read, so this was not made. Nothing was saved. Try again in a moment.'), { refused: true, status: 503, code: UNREADABLE, title: 'Tax not checked', cause });
}

/** TAX01-1: the refusal passes through the shelf's catch-all untouched; any other failure falls back to null */
const rethrowUnreadable = (e) => { if (e && e.code === UNREADABLE) throw e; };
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
        const reg = await shopTaxIdRead(db, entity_id);
        const nestedItems = o.withItems
          ? await db
              .query(`SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id])
              .catch(log.orElse('tax-shelf readShelf: the read failed — answered with none', { rows: [] }))
          : { rows: [] };
        const idRow = reg.rows[0] || {};
        return { defs: nestedDefs, items: nestedItems, gstn: idRow.gstn || null, zone: { country: idRow.country || null, timezone: idRow.timezone || null } };
      }),
      (typeof d.getFace === 'function' ? d.getFace(entity_id) : Promise.resolve(null)).catch(
        log.orElse('tax-shelf readShelf: failed — answered with nothing', null)
      ),
      typeof d.query === 'function' && typeof d.regionLayer === 'function'
        ? taxGov
            .governedSlabsFor(entity_id, {
            query: d.query,
            regionLayer: d.regionLayer,
            onUnrated: (ids, juris) => log.fellBack('tax-shelf readShelf: ' + juris + ' slab ' + ids.join(', ') + ' has no rate (rate missing) — not served, never read as 0%', new Error('rate missing'))
          })
            .catch(log.orElse('tax-shelf readShelf: failed — answered with none', []))
        : Promise.resolve([])
    ]);
    return shelfFromRows({ defs: defsAndItems.defs, items: defsAndItems.items, gstn: defsAndItems.gstn, zone: defsAndItems.zone, face, gov });
  } catch (e) {
    return nothingUnlessRefused(e);
  }
}

/** the shop's tax id row, read in the same transaction; a failed read is a refusal (TAX01-1), logged, never read as "no tax id" */
function shopTaxIdRead(db, entity_id) {
  return db.query(`SELECT gstn, country, timezone FROM identities WHERE identity_id = $1`, [entity_id]).catch((e) => {
    log.fellBack('tax-shelf readShelf: the shop’s tax details could not be read — refused, never read as no tax id', e);
    throw unreadable(e);
  });
}
/** a failed shelf read answers nothing (logged), except the refusal of the tax id read, which goes on to the caller (TAX01-1: fail CLOSED) */
function nothingUnlessRefused(e) {
  if (e && e.code === UNREADABLE) throw e;
  log.fellBack('tax-shelf readShelf: the read failed — answered with nothing', e);
  return null;
}
/** TAX01-4: does the shop's country pack collect tax without a tax id (reg-us collect_without_tax_id)? no country or no pack: no */
function collectsWithoutTaxId(zone) {
  const taxPack = zone && zone.country ? require('./tax-packs').packFor(zone.country) : null;
  return !!(taxPack && taxPack.collect_without_tax_id);
}

/**
 * shelfFromRows({ defs, items, gstn, zone, face, gov }) → the tax shelf or null — PURE, the one definition (readShelf and the bulk read share it).
 * defs / items are query results ({ rows }); gov = the governed slabs (tax-governance.governedFromRows or governedSlabsFor).
 */
function shelfFromRows({ defs, items, gstn, zone, face, gov: governed }) {
  try {
    /**
     * ⭐⭐ NO GSTIN, NO GST — DECIDED ONCE, HERE, FOR EVERY SURFACE. Athi, 2026-09-05: "the cart is the fundamental unit of data
     * movement; if it is not talking the same through different means we can just forget this product." Found by [SB-01] and
     * [CAP-02]: a seller with no GSTIN saw GST 5% ₹18 in the cart (the shelf resolved the item's own rate) while the invoice
     * said ₹360 (tax.js: seller state unknown → nothing charged). Two deciders. Now the shelf itself is the decider: under the
     * GST scheme a seller without a GSTIN has NO shelf, so the catalogue view carries no tax, the send stamps no rate and the
     * invoice charges none — ₹360 on every surface; with a GSTIN, ₹378 on every surface.
     * TAX01-4: the one exception is the PACK's, never a field on the rows: a pack that collects without a tax id (reg-us collect_without_tax_id) gets its shelf and its rate with no id,
     * the same answer chargesTax gives. (The old test read `item.scheme` off the slab rows, which carry it under rules/governance only, so it was always false and a no-EIN US shop saw
     * 100 on the cart where the invoice said 108.) AU and AE have no such pack flag: no id, no shelf, as before.
     */
    if (!String(gstn || '').trim() && !collectsWithoutTaxId(zone)) return null;
    const rows = defs.rows || [];
    const own = rows.filter((item) => item.kind === 'tax');
    return {
      /* governed first so an entity slab with the same id (impossible by construction) could never shadow it */
      slabs: taxSlab.indexSlabs(governed.concat(own)),
      categories: rows.filter((item) => item.kind === 'category'),
      face: face || {},
      zone: zone || null /* the shop's own { country, timezone }: the day a slab is judged on is the SHOP's day (shop-clock.today), never the UTC day (M3) */,
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

/** the tax id's name in the pack's words (ABN · GSTIN · TRN), never typed in code; 'tax number' when no pack answers */
function taxIdWordOf(country) {
  const meta = require('./country').meta(country);
  return (meta && meta.words && meta.words.taxId) || 'tax number';
}

/** every pack's own tax-id word, in pack order (GSTIN · ABN · TRN …): the schemes a party tax-id row may carry; no country named here (IN-F-01) */
function taxIdWordsOfPacks() {
  return [...new Set(require('./regulation').list().map((pack) => require('./profile').taxIdWordOf(pack.id || pack)).filter(Boolean))];
}

module.exports = { readShelf, shelfFromRows, registrationMayCharge, chargesTax, taxWordOf, taxIdWordOf, taxIdWordsOfPacks };
