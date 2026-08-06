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
/**
 * Is this owner's catalogue exposed at all? (b114)
 *
 * Athi's model: a public catalogue is open to the world — a visitor may be a person, another store, or a network
 * peer, and the requester's TYPE is irrelevant; only the owner's setting is. A private entity is closed to all of them.
 *
 * Before b114 there was no such setting: availability was `hasSchema || finishes.length`, so ADOPTING a catalogue
 * silently published your storefront. Publishing is now an explicit act.
 *
 * SELF-HEALING: if the column is not applied yet, return null and the caller keeps the pre-b114 behaviour exactly —
 * so code and migration can land in either order.
 */
async function catalogueVisibility({ entity_id, query }) {
  try {
    const r = await query('SELECT catalogue_visibility FROM identities WHERE identity_id = $1', [entity_id]);
    const v = r.rows[0] && r.rows[0].catalogue_visibility;
    return (v === 'public' || v === 'private') ? v : null;
  } catch (_) { return null; }   // b114 not applied → pre-b114 behaviour
}

async function buildPublicView({ entity, query, withEntity, catalogueBuild, orderInput, identity, catalogueRead, container }) {
  // The gate comes FIRST: a private catalogue must cost nothing and reveal nothing — not a schema, not an item
  // count, not a timing difference worth measuring. Identical shape to "this owner has published nothing".
  const visibility = await catalogueVisibility({ entity_id: entity.identity_id, query });
  if (visibility === 'private') return { available: false, reason: 'private' };

  const sch = await query(
    `SELECT schema_id, schema_name FROM entity_schemas
     WHERE entity_id = $1 AND status = 'active' AND is_default = true AND visibility = 'public' LIMIT 1`,
    [entity.identity_id]);
  const hasSchema = sch.rows.length > 0;

  let fields = [];
  if (hasSchema) {
    fields = (await query(
      `SELECT field_key, field_name, field_type, required, min_value, display_order
       FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`, [sch.rows[0].schema_id])).rows;
  }

  // ── ITEMS ARE NOT GATED ON THE SCHEMA ─────────────────────────────────────────────────────────────────────
  // Found live 2026-08-05: Athi added a product to Gamma Exports, the app said "Product added ✓", the row was
  // written correctly and stamped USD — and the storefront showed NOTHING. Because this query sat inside
  // `if (hasSchema)`, and Gamma has no active default PUBLIC schema (it publishes a blueprint instead), items
  // were silently dropped from the public view.
  //
  // A schema describes the FIELDS used to render a form. It has no business deciding whether products are
  // visible. The publish gate is b114 `catalogue_visibility`, checked above and BEFORE anything else — so moving
  // this out exposes nothing new: a private catalogue already returned {available:false} and never reached here.
  //
  // The failure shape is the one that keeps recurring today: something succeeds, reports success, and the
  // outcome is absent. No error, no hint, and the owner has no way to tell.
  //
  // withEntity(null) = no tenant context, so the visibility-aware RLS policy still governs what comes back.
  const items = (await withEntity(null, (db) => db.query(
    `SELECT item_id, item_data, created_at FROM catalogue_items
     WHERE entity_id = $1 AND is_active = true ORDER BY created_at DESC`, [entity.identity_id]))).rows;

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

  // THE ONE READ — owned rows and adopted rows, together, with provenance. `finishes` above is the same content
  // in its display shape; this is the same content in its CATALOGUE shape, so the four capabilities (template,
  // import, variants, export) can stop reading one table and start reading the catalogue.
  let allLines = [];
  try {
    if (catalogueRead) {
      allLines = catalogueRead.lines({
        owned: items,
        sources: finishes.map((f) => ({ source_key: f.source, title: f.title,
          owner_entity_id: f.owner_entity_id, items: f.items })),
        me: entity.identity_id,
      });
    }
  } catch (_) { allLines = []; }

  // Which lines belong to which product. The declaration lives on the same face as order_input.
  let groups = [];
  try {
    const fr = await withEntity(entity.identity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity.identity_id]));
    if (!identity) throw new Error('identity not injected');
    const ident = identity.resolve((fr.rows[0] && fr.rows[0].face) || {});
    if (ident.variants) {
      // ⚠️ LINES WITHIN A PRODUCT GO IN THE ORDER THEY WERE LISTED, not newest-first.
      //
      // The items query is `created_at DESC`, which is right for a product LIST — newest first — and wrong for the
      // sizes of one product. A sheet listing 1L, 4L, 10L came back to the shopper as 10L, 4L, 1L. `identity.group`
      // preserves whatever order it is given; the order it was being given came from the storage clock, which is
      // the jsonb column-order bug wearing a different hat.
      //
      // Groups still appear newest-product-first (the list order a merchant expects); only the lines inside one are
      // put back into the order they entered the catalogue, which for an import is the order of their file.
      const asc = items.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      groups = identity.group(asc.map((r) => Object.assign(
        { _item_id: r.item_id, _at: new Date(r.created_at).getTime() }, r.item_data)), ident)
        .map((g) => ({
          group: g.group, label: g.label, options: g.options,
          _newest: Math.max(...g.lines.map((l) => l.item._at || 0)),
          lines: g.lines.map((l) => ({ item_id: l.item._item_id, identity: l.identity, variant: l.variant })),
        }));
      // Grouping from the ASC copy puts the LINES right; it also puts the GROUPS oldest-first, which is not the
      // order a product list is read in. Restore newest-product-first by the newest line each group holds, so the
      // two orders are decided independently instead of one being a side effect of the other.
      groups.sort((a, b) => b._newest - a._newest);
      groups.forEach((g) => { delete g._newest; });
    }
  } catch (_) { /* no face, or no identity declared — the catalogue is a flat list, as it has always been */ }

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
    // ── THE ONE READ ─────────────────────────────────────────────────────────────────────────────────────────
    // Athi: "all the paths come to the same source. Here it is the catalogue. It cannot be two different items."
    //
    // `items` and `finishes` stay exactly as they were — every existing caller keeps working, and the storefront
    // still renders its two sections. `lines` is the SAME catalogue read once: owned rows and adopted rows in one
    // list, each carrying where it came from, who owns it, and which of its FIELDS the reader may change.
    //
    // Two stores, one read. Merging the tables would give every retailer a private copy of a shared source, which
    // is the one thing the blueprint exists not to do.
    lines: allLines,
    catalogue_summary: catalogueRead ? catalogueRead.summary(allLines) : null,
    // VARIANTS — one product, several purchasable lines.
    //
    // Additive by design: `items` is unchanged, so every existing caller keeps working and the ORDER PATH is
    // untouched — an order is still placed against a line, which is what every one of the 7 presets expects.
    // `groups` only says which lines belong together and what distinguishes them, referencing lines by item_id
    // rather than repeating them. A storefront that ignores it renders exactly what it renders today.
    //
    // Empty when the owner has not declared a group field, which is most of them.
    groups,
    finishes,
    _oi: oi,   // routes may need the resolved declaration itself; not serialised by callers
  };
}

module.exports = { buildPublicView, getOrderInput, catalogueVisibility };
