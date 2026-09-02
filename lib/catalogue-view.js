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
const itemstatus = require('./itemstatus');
const availability = require('./availability');
/* ⭐ the catalogue declares, a row overrides — an outward reader sees the RESOLVED value. */
const defaults = require('./defaults');
const policy = require('./policy');

/**
 * The shop's declared face (b112). Never trusted from the request.
 *
 * ⚠️ THE WHOLE FACE, ONCE. This used to return only the order contract and throw the rest away, so the grouping
 * declaration further down read `catalogue_face` a SECOND time — while the comment beside it said "reading the
 * face twice would be a query for nothing". It was right, and it was describing the code it sat in. Now the row
 * is read once and every reader takes what it needs from it: the order contract, the identity declaration, and
 * the catalogue-level DEFAULTS a row may inherit.
 */
async function getFace({ entity_id, withEntity }) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    return (r.rows[0] && r.rows[0].face) || {};
  } catch (_) { return {}; }
}

/** The order contract, from a face already in hand. */
function orderInputOf(face, orderInput) {
  const f = face || {};
  return orderInput.resolve(f.order_input || (f.method ? { preset: f.method } : null));
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
/**
 * sameNetwork(query, aBridge, bBridge) → are these two entities under one network?
 *
 * `cb_entity.path` is an ltree, so a network is a TREE and membership is a shared root. One query, whatever the
 * depth — Athi's O(1) rule: a per-ancestor walk would be a query per level.
 *
 * Returns false on anything unresolvable. A membership test that fails OPEN is not a membership test.
 */
async function sameNetwork(query, aBridge, bBridge) {
  if (!aBridge || !bBridge) return false;
  if (String(aBridge) === String(bBridge)) return true;
  try {
    const r = await query(
      `SELECT (SELECT subpath(path, 0, 1) FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
            = (SELECT subpath(path, 0, 1) FROM cb_entity WHERE bridge_id = $2 LIMIT 1) AS same`,
      [aBridge, bBridge]);
    return r.rows[0] ? r.rows[0].same === true : false;
  } catch (_) { return false; }   // cb_entity absent, or either side not on the tree → not members
}

/**
 * ── THREE TIERS ────────────────────────────────────────────────────────────────────────────────────────────────
 * Athi, 2026-08-06: *"if there are internal departments where the entity is protected, those catalogues will not be
 * visible outside — but the entities WITHIN the network can see those. They are like their warehouse."*
 *
 *     public   anyone with the link, and it appears on the network storefront
 *     network  members of the same network only — the warehouse
 *     private  nobody but the owner
 *
 * ⚠️ THIS IS THE FIRST TIME THIS FUNCTION HAS CARED WHO IS ASKING, and that is not a small change. The header of
 * this file records why v1 deliberately returned the same payload to everyone: a supplier link is UNILATERAL, so
 * "we are related" is self-asserted and cannot authorise anything beyond public — "a `related` tier that shows MORE
 * than public needs BILATERAL consent, which supplier_list does not model. Do not add one until it does."
 *
 * A NETWORK is that bilateral relationship. Membership is placed by whoever governs the network and is visible to
 * both sides; it is not something one party asserts about another. So this satisfies the precondition rather than
 * breaking the rule — and the rule stands unchanged for supplier links, which still see exactly public.
 *
 * `viewer` is the reading entity's bridge_id, or null for the anonymous storefront. Absent viewer → public only.
 */
async function catalogueVisibility({ entity_id, query, visibilityCap, viewer }) {
  try {
    // One query, more columns — the cap must be applied at READ, not only at write.
    //
    // ⚠️ THE CASE THAT MATTERS: an entity that published itself and was capped AFTERWARDS. Its stored flag still
    // says `public`, so a write-time check alone would leave the catalogue served to the world while the operator
    // believes it is closed. Athi, 2026-08-06: "how do we protect a private catalogue — say it is done from the
    // networking side?" A guard that only runs when someone presses save is not protection.
    const r = await query(
      'SELECT catalogue_visibility, plan, params_override, bridge_id, business_status FROM identities WHERE identity_id = $1', [entity_id]);
    const row = r.rows[0];
    if (!row) return null;
    const v = row.catalogue_visibility;
    const chosen = (v === 'public' || v === 'private' || v === 'network') ? v : null;

    /**
     * ⭐⭐ CLOSED IS A THIRD INPUT TO THE SAME NARROWEST-WINS RULE. Athi, 2026-08-20, describing the three
     * states as a corner shop's day:
     *
     *     open    door open, come in, order
     *     away    door open, nobody at the counter, leave your order
     *     closed  SHUTTER DOWN — nothing to see
     *
     * ⚠️⚠️ AND THE CODE DID CLOSE TO THE OPPOSITE. `business_status = 'closed'` refused ORDERS
     * (routes/catalogue.js:569,620) and left the catalogue FULLY VISIBLE. So a shopkeeper who set "closed"
     * expecting the door shut was still showing their entire catalogue to the world — they had only stopped
     * taking money for it. That is not a cosmetic mismatch: it is a privacy expectation quietly broken by the
     * one control a person reaches for to stop exactly that.
     *
     * ⭐ NO NEW MECHANISM. Closed is not a fourth visibility tier, it is a TEMPORARY OVERRIDE of whichever
     * tier was chosen — so it enters the existing resolution rather than sitting beside it, and it inherits
     * everything that already works. It also lands ABOVE the cap check on purpose: closed is absolute, and a
     * network-provisioned node cannot be opened by its operator while its own shutter is down.
     *
     * ⚠️ IT OVERRIDES, IT NEVER OVERWRITES. `catalogue_visibility` is untouched, so reopening restores the
     * choice with nobody needing to do anything. Athi: *"otherwise everyone connected has to remove if one
     * store is not going to be useful at all."* A shutter, not a demolition.
     *
     * ⚠️ AND IT CLOSES TO THE NETWORK TOO — Athi: *"network + closed, not visible to network also."* That
     * falls out for free, because `private` already excludes network members.
     */
    if (row.business_status === 'closed') return 'private';
    if (!visibilityCap) return chosen === 'network' ? 'private' : chosen;   // not injected → closed, never open
    const cap = visibilityCap.capOf({ plan: row.plan, paramsOverride: row.params_override || {} });
    // The cap bounds how OPEN, so it closes `network` as surely as `public`.
    if (cap.max === 'private' && chosen !== 'private') return 'private';
    // NETWORK: resolve it against THIS reader. A member of the same network sees it exactly as public; everyone
    // else — the anonymous storefront, and a self-asserted supplier link — sees private, indistinguishably.
    if (chosen === 'network') {
      return (await sameNetwork(query, viewer, row.bridge_id)) ? 'public' : 'private';
    }
    return chosen;
  } catch (_) { return null; }   // b114 not applied → pre-b114 behaviour
}

async function buildPublicView({ entity, query, withEntity, catalogueBuild, orderInput, identity, catalogueRead, container, visibilityCap, viewer }) {
  // The gate comes FIRST: a private catalogue must cost nothing and reveal nothing — not a schema, not an item
  // count, not a timing difference worth measuring. Identical shape to "this owner has published nothing".
  const visibility = await catalogueVisibility({ entity_id: entity.identity_id, query, visibilityCap, viewer });
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
  /* ⭐ ONE READ of the face, at the top, for every reader below it: the order contract, the grouping identity,
     and the catalogue-level defaults a row may inherit. */
  const _face = await getFace({ entity_id: entity.identity_id, withEntity });
  const _oiEarly = orderInputOf(_face, orderInput);

  const items = (await withEntity(null, (db) => db.query(
    `SELECT item_id, item_data, created_at FROM catalogue_items
     WHERE entity_id = $1 AND is_active = true ORDER BY created_at DESC`, [entity.identity_id]))).rows;

  /**
   * ⭐⭐ AN UNAVAILABLE PRODUCT IS NOT SHOWN TO A SHOPPER — Athi, 2026-09-01: *"if stock unavailable is set, then
   * it should not appear at all for the customer to select. It is a temp retirement. Only available stock should
   * be visible."*
   *
   * ⚠️ THE STATUS MODEL WAS BUILT AND ALMOST NOBODY HONOURED IT. `available · unavailable · redundant · retired`
   * has existed since the flag was added, with `isMatchable()` to answer this exact question — and it was called
   * from ONE place, the message matcher. The storefront listed every item whatever its status, so marking
   * something out of stock changed what the owner saw and nothing the customer did.
   *
   * ⭐ HIDDEN AND COUNTED, the same shape as `unpriced_hidden` directly above: a shopper is simply not shown a
   * product that cannot be bought, and the OWNER is told how many are not showing — otherwise "where did my
   * items go" has no answer on the screen that caused it.
   */
  /* The opt-in flag, read once for this shop rather than per row — Athi's O(1) rule applies to constants as
     much as to loops, and this is a constant for the whole page. Fails CLOSED to 'off', which is the default
     and today's behaviour, so an unreadable policy can never hide somebody's catalogue. */
  let qtyZeroHides = false;
  try { qtyZeroHides = (await policy.get(entity.identity_id)).qty_zero_hides === 'on'; } catch (_) {}
  let unavailable_hidden = 0, qty_zero_hidden = 0;
  {
    const keep = [];
    for (const r of items) {
      /* ⚠️ isOfferable, NOT isMatchable — and this line shipped wrong once. MATCHABLE deliberately INCLUDES
         `unavailable` so the message matcher can still resolve an out-of-stock tomato; gating the SHOPPER's list
         on it meant out-of-stock products went on being listed and ordered, which is the opposite of what was
         asked. Two questions, two predicates — see lib/itemstatus.js. */
      const d = r.item_data || {};
      /* ⭐ AND THE OPT-IN: a business that DOES keep counts may say a counted zero means "not offered"
         (policy `qty_zero_hides`). Off by default and it never stamps a status — the product returns the instant
         the count does. ⚠️ countedZero, not `!qty`: an absent feed is unknown, not empty. */
      /* ⚠️ COUNTED APART, like `unpriced_hidden` beside them. "I marked this out of stock" and "the feed says
         zero" are different problems with different fixes, and one number for both would send the owner to the
         wrong screen. */
      if (!itemstatus.isOfferable(d)) { unavailable_hidden++; continue; }
      if (qtyZeroHides && availability.countedZero(d)) { qty_zero_hidden++; continue; }
      keep.push(r);
    }
    items.length = 0;
    Array.prototype.push.apply(items, keep);
  }

  /**
   * ⭐⭐ WHAT A ROW DID NOT SAY, THE CATALOGUE ANSWERS — and a BUYER is the reader who most needs it.
   *
   * A product that inherits its unit from the catalogue stores nothing in `unit`, which is correct: the row stays
   * silent so that changing the catalogue default still reaches it. But an outward reader — a shopper, a B2B
   * buyer browsing their supplier, a network peer — is not reading a declaration, they are looking at something
   * they might order, and "₹180 per (blank)" is not a price anyone can act on.
   *
   * ⚠️ RESOLVED HERE, AFTER THE AVAILABILITY FILTER, AND NOT WHERE THE ROWS WERE READ. `items` is MUTATED IN
   * PLACE just above (length = 0, then push), so anything computed from it earlier would be a list that still
   * contained the products this filter just hid — correct-looking output built from the wrong rows.
   *
   * ⚠️ AND THIS IS THE READ MODEL, NOT THE RECORD. Nothing is written back: the stored row must keep meaning "I
   * did not say", or the inheritance is severed the first time anybody reads the catalogue.
   */
  for (const r of items) r.item_data = defaults.effective(r.item_data, _face);

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

  /**
   * ── A PRODUCT WITH NO PRICE IS NOT FOR SALE ──────────────────────────────────────────────────────────────────
   * Athi, 2026-08-06: *"it quickly adopts, no confirmation messages etc. I have added price for two items, but not
   * for others."*
   *
   * Reproduced: adopt six finishes, price two, and the storefront listed all SIX. The four unpriced ones showed a
   * dash, and an order on any of them was refused at confirm with "Price is not set". So the shop advertised four
   * products it could not sell, and neither the shopper nor the owner was told.
   *
   * The same failure shape as the rest of this week: it looks finished and is not.
   *
   * ⚠️ ONLY WHEN THE SHOP SHOWS PRICES. An enquiry or form catalogue (pipeline `payload`) has no prices by design,
   * and hiding its items would empty the shop. The rule is "monetary shop, unpriced line" — not "no price".
   *
   * Hidden, never deleted: the adoption is intact and the moment a price is set the item returns. The count travels
   * in the payload so the OWNER can be told what is not showing; a shopper is simply not shown a dead product.
   */
  let unpriced_hidden = 0;
  if (_oiEarly.showsPrice !== false && (_oiEarly.pipeline || 'commerce') !== 'payload') {
    for (const f of finishes) {
      const keep = [];
      for (const it of (f.items || [])) {
        const c = (it && it.commercials) || {};
        const raw = (c.price != null && c.price !== '') ? c.price : c.price_per_litre;
        const amt = (raw && typeof raw === 'object') ? raw.amount : raw;
        const n = (amt === null || amt === undefined || amt === '') ? NaN : Number(amt);
        if (Number.isFinite(n)) keep.push(it); else unpriced_hidden++;
      }
      f.items = keep;
    }
  }

  if (!hasSchema && !finishes.length) return { available: false };

  let storefront_access = 'browse';
  try {
    const sf = await query('SELECT storefront_access FROM identities WHERE identity_id = $1', [entity.identity_id]);
    if (sf.rows[0] && sf.rows[0].storefront_access) storefront_access = sf.rows[0].storefront_access;
  } catch (_) {}

  // Resolved once, above, for the unpriced rule. Reading the face twice would be a query for nothing — and Athi's
  // O(1) rule applies to constants as much as to loops.
  const oi = _oiEarly;

  // THE ONE READ — owned rows and adopted rows, together, with provenance. `finishes` above is the same content
  // in its display shape; this is the same content in its CATALOGUE shape, so the four capabilities (template,
  // import, variants, export) can stop reading one table and start reading the catalogue.
  let allLines = [];
  try {
    if (catalogueRead) {
      const srcs = finishes.map((f) => ({ source_key: f.source, title: f.title,
        owner_entity_id: f.owner_entity_id, items: f.items }));

      // THE POINTER, resolved in ONE batch.
      //
      // Athi: "we always refer the container which holds the image — if the version changes, that will be directly
      // reflecting. But in the chit we hold the image reference." container.js already said exactly that; nothing
      // read it, so the catalogue served `catalogue_source.items` — a stored snapshot — and moving the pointer
      // changed nothing anyone could see.
      //
      // resolveMany, not resolveContainer per item: the latter is two queries each, so a 300-line catalogue would
      // be 600 round trips on a public, unauthenticated endpoint.
      let containers = {};
      if (container && container.resolveMany) {
        const ids = [];
        for (const s of srcs) {
          for (const it of (s.items || [])) {
            if (it && it.name) ids.push(container.itemContainerId(s.source_key, it.name));
          }
        }
        containers = await container.resolveMany(ids);
      }

      allLines = catalogueRead.lines({
        owned: items, sources: srcs, me: entity.identity_id,
        containers, containerIdFor: container ? container.itemContainerId : null,
      });
    }
  } catch (_) { allLines = []; }

  // Which lines belong to which product. The declaration lives on the same face as order_input.
  let groups = [];
  try {
    if (!identity) throw new Error('identity not injected');
    const ident = identity.resolve(_face);   /* read once at the top — see getFace */
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
    // How many adopted lines are hidden because they carry no price. For the OWNER, never for the shopper.
    unpriced_hidden,
    /* ⚠️ Named apart from unpriced_hidden: "no price yet" and "out of stock" are different problems
       with different fixes, and one number would tell the owner neither. */
    unavailable_hidden,
    /* Counted apart from unavailable_hidden: "I marked this out of stock" and "the feed says zero" are
       different problems with different fixes. Only ever non-zero when the owner turned qty_zero_hides on. */
    qty_zero_hidden,
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

/** Back-compatible: the contract alone, for callers that do not need the whole face. */
async function getOrderInput({ entity_id, withEntity, orderInput }) {
  return orderInputOf(await getFace({ entity_id, withEntity }), orderInput);
}

module.exports = { buildPublicView, getFace, orderInputOf, getOrderInput, catalogueVisibility };
