'use strict';
/**
 * catalogue-view.js — ONE catalogue read, many principals (SPEC-one-path-many-principals).
 *
 * Athi, 2026-07-29: "there is no difference between a storefront or a B2B relationship. In storefront you carry the
 * customer user id; in B2B you carry the other store name; the same applies to network, with the access level
 * permission. So all paths remain the same."
 *
 * He is right, and the live supplier hop proved the cost of not doing it: Alpha Timbers saw NOTHING from its supplier
 * while the identical catalogue was fully visible on the public storefront — not governance, just two pieces of code
 * answering the same question, one of them years behind.
 *
 * ── ACCESS, and why v1 stops where it does ──────────────────────────────────────────────────────────────────────
 * `buildPublicView()` returns exactly what the ANONYMOUS storefront returns. Every caller — a customer on the public
 * storefront, an entity browsing its supplier, a network peer — gets the same payload.
 *
 * That is deliberate, and it is NOT laziness. Two facts constrain it:
 *   1. `GET /api/catalogue/:bridge_id` is PUBLIC and unauthenticated, so everything this returns is already
 *      world-readable. Serving it to a logged-in entity therefore adds ZERO exposure.
 *   2. Adding a supplier is UNILATERAL — `POST /api/relationships/suppliers` inserts a supplier_list row with no
 *      consent from the supplier. So "we are related" is SELF-ASSERTED and cannot authorise anything beyond public.
 *
 * ⚠️ An earlier draft of the spec claimed a relationship check was "strictly stronger" than the existing publish gate.
 * That was WRONG for exactly reason 2. A `related` tier that shows MORE than public needs BILATERAL consent, which
 * supplier_list does not model. Do not add one until it does.
 */

/** The shop's declared input contract (b112 face). Never trusted from the request. */
async function getOrderInput({ entity_id, withEntity, orderInput }) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    const face = (r.rows[0] && r.rows[0].face) || {};
    return orderInput.resolve(face.order_input || (face.method ? { preset: face.method } : null));
  } catch (_) { return orderInput.resolve(null); }
}

/**
 * The one catalogue read. Returns { available:false } when the owner has published nothing, else the full payload.
 * Dependencies are injected so this stays a pure module and both routes share ONE implementation.
 */
async function buildPublicView({ entity, query, withEntity, catalogueBuild, orderInput }) {
  const sch = await query(
    `SELECT schema_id, schema_name FROM entity_schemas
     WHERE entity_id = $1 AND status = 'active' AND is_default = true AND visibility = 'public' LIMIT 1`,
    [entity.identity_id]);
  const hasSchema = sch.rows.length > 0;

  let fields = [], items = [];
  if (hasSchema) {
    fields = (await query(
      `SELECT field_key, field_name, field_type, required, min_value, display_order
       FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`, [sch.rows[0].schema_id])).rows;
    // withEntity(null) = no tenant context, so the visibility-aware policy returns only PUBLIC items. Unchanged.
    items = (await withEntity(null, (db) => db.query(
      `SELECT item_id, item_data FROM catalogue_items
       WHERE entity_id = $1 AND is_active = true ORDER BY created_at DESC`, [entity.identity_id]))).rows;
  }

  // The adopted REFERENCE catalogue — where published/adopted TEMPLATES live. This is what the B2B view was missing.
  let finishes = [];
  try {
    const ado = await withEntity(entity.identity_id, (db) => db.query(
      `SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true`, [entity.identity_id]));
    for (const row of ado.rows) {
      const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {});
      if (resolved) finishes.push({ source: row.source_key, title: resolved.title, collection: resolved.collection,
        items: resolved.items, owner_entity_id: resolved.owner_entity_id || null,
        experience: resolved.experience || {}, formatting: resolved.formatting || {} });
    }
  } catch (_) { /* no reference catalogue for this owner */ }

  if (!hasSchema && !finishes.length) return { available: false };

  let storefront_access = 'browse';
  try {
    const sf = await query('SELECT storefront_access FROM identities WHERE identity_id = $1', [entity.identity_id]);
    if (sf.rows[0] && sf.rows[0].storefront_access) storefront_access = sf.rows[0].storefront_access;
  } catch (_) {}

  const oi = await getOrderInput({ entity_id: entity.identity_id, withEntity, orderInput });

  return {
    available: true,
    shop: {
      bridge_id: entity.bridge_id, display_name: entity.display_name, currency_code: entity.currency_code,
      gstn: entity.gstn, is_verified: entity.is_verified, logo_url: entity.logo_url, address: entity.address,
      business_status: entity.business_status || 'open', storefront_access,
      // the DECLARED contract: what this catalogue receives, and which pipeline a submission runs through
      order_input: { preset: oi.preset, pipeline: oi.pipeline, showsPrice: oi.showsPrice,
                     negotiable: oi.negotiable, schema: oi.schema, documents: oi.documents },
      order_method: oi.preset,
    },
    schema: hasSchema ? sch.rows[0] : null,
    fields,
    items,
    finishes,
    _oi: oi,   // routes may need the resolved declaration itself; not serialised by callers
  };
}

module.exports = { buildPublicView, getOrderInput };
