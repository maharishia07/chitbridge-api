/**
 * routes/till.js — WHAT A COUNTER NEEDS, IN ONE CALL (TILL-SPEC-2026-09-07).
 *
 * Athi, 2026-09-07: *"someone runs a store without a computer… why can't we develop a desktop application, you just download it and we
 * still run everything in the cloud, but the minimum required sits on the desktop so the billing works faster."*
 *
 * The till is the connector kit with a screen. It bills against a LOCAL copy of the shop — items, prices, offers, tax slabs, customers
 * — and sends each bill afterwards. This route is where that copy comes from, and it is deliberately ONE request: the counter's whole
 * world in a single round trip, because the old shape (a call per fact) is what made screens slow in the first place.
 *
 *   GET /api/till/snapshot  → { at, version, shop, items, slabs, categories, face, offers, customers, policy }
 *
 * ⚠️ IT IS A COPY, AND IT SAYS WHEN IT WAS TAKEN. Every bill records `catalogue_version`, so "what price did we sell at" has an answer
 * later instead of an argument. A shop that changes a price while the till is offline keeps selling at the snapshot's price until it
 * refreshes — decided with Athi, who is right that a price change is rare and a notice is enough.
 * ⚠️ NO SECRETS TRAVEL. No keys, no vault, no other entity's data: only what this shop already shows its own counter.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withEntity } = require('../db');
const catalogueView = require('../lib/catalogue-view');
const taxShelf = require('../lib/tax-shelf');
const regional = require('../lib/regional');
const policy = require('../lib/policy');
const itemstatus = require('../lib/itemstatus');   /* "may somebody take one NOW?" — one definition, the storefront's */
const lotfields = require('../lib/lotfields');
const keys = require('./keys');
const { shopChanged } = require('../lib/shopchanged');   /* ⭐ a price changed at the counter must reach the TV, not wait out a timer */                     /* ⭐ pairing mints a SCREEN key through the same mint the keys screen uses */
const speech = require('../lib/speech');            /* ⭐ what somebody SAID, as text — a seam, with a provider behind it */      /* ⭐ what THIS vertical must capture about a consignment */
const crypto = require('crypto');

/** the figure out of a price, whether the catalogue stored a number or { amount, currency } (lib/pricing-engine reads it the same way) */
function amountOf(p) { const v = (p && typeof p === 'object') ? p.amount : p; const n = Number(v); return Number.isFinite(n) ? n : null; }
/** a short, stable stamp for "which copy of the catalogue was this bill priced from" */
function versionOf(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

router.get('/snapshot', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    /* the moment the till last read the shop — anything touched after it is what it does not have */
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
    const since = (sinceRaw && !Number.isNaN(Date.parse(sinceRaw))) ? new Date(sinceRaw).toISOString() : null;

    /* the shop, as its own books know it — the slip's header, and what decides tax invoice vs cash memo */
    const me = await query(
      `SELECT display_name, gstn, country, policy_flags FROM identities WHERE identity_id = $1`, [entity_id]);
    const row = me.rows[0] || {};
    const flags = await policy.get(entity_id).catch(() => ({}));
    let profile = {}, sectors = [];
    try {
      /* ⭐ SECTORS ARE A COLUMN, not something inside profile_json — governance reads them for trade readiness, and the counter now
         reads the same one to decide what goods-in must capture about a consignment (lib/lotfields). */
      const p = await query(`SELECT profile_json, sectors FROM entity_profile WHERE entity_id = $1`, [entity_id]);
      profile = (p.rows[0] && p.rows[0].profile_json) || {};
      sectors = (p.rows[0] && p.rows[0].sectors) || profile.sectors || [];
    } catch (_) { /* an entity with no profile still bills */ }

    /**
     * ⚠️ THE ITEMS ARE NOT THE TAX SHELF. readShelf() answers null for a seller with no GSTIN — the one place that decides "no GSTIN,
     * no GST" for the cart, the send and the invoice alike — and most shops we are building this counter for have none. So the shelf
     * is asked only for slabs, categories and the face; the items come from the catalogue, whoever the shop is.
     */
    const [shelf, itemRows, liveCount] = await Promise.all([
      taxShelf.readShelf(entity_id, { withEntity, query, regionLayer: regional.regionLayer,
        getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) }, { withItems: false }).catch(() => null),
      /**
       * ⭐ A DELTA WHEN THE TILL SAYS WHEN IT LAST LOOKED (2026-09-08). A shop with 10,000 items should not send them all every fifteen
       * minutes to say nothing changed. With ?since= we return only rows touched after that moment — and, separately, the ids of rows
       * that went inactive, because a product taken off the shelf must LEAVE the counter, and an absence is not something a delta of
       * present rows can express.
       * ⚠️ The stamp we hand back is the SERVER's clock (body.at), never the till's — two clocks a few seconds apart would silently
       * skip a row that changed in between.
       */
      withEntity(entity_id, (db) => (since
        ? db.query('SELECT item_id, item_data, is_active FROM catalogue_items WHERE entity_id = $1 AND updated_at > $2 ORDER BY updated_at DESC LIMIT 20000', [entity_id, since])
        : db.query('SELECT item_id, item_data, is_active FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY updated_at DESC NULLS LAST LIMIT 20000', [entity_id])
      )).catch(() => ({ rows: [] })),
      /**
       * ⚠️⚠️ A DELETE IS INVISIBLE TO A DELTA, AND THAT IS WHY THE COUNTER KEPT SHOWING STOCK THAT NO LONGER EXISTS.
       *
       * Athi emptied this shop's catalogue in SQL and loaded a new one; his counter went on listing the old rows. The delta asks
       * for everything with `updated_at > since`, and a row that has been DELETED is not late — it is gone. It appears in no
       * result set, so it lands in neither `items` nor `removed`, and the till's merge keeps it for ever. The `removed` list
       * only ever caught rows that went INACTIVE, which is a different thing from rows that stopped existing.
       *
       * No delta protocol can express an absence it cannot see, so the counter is given the one number that reveals it: how many
       * sellable products the shop has RIGHT NOW. If what the till holds after merging does not equal this, its copy is wrong for
       * some reason we did not anticipate, and it takes the whole shop again. That heals a hard delete, a missed delta, a clock
       * skew and a half-written cache — without any of them having to be predicted.
       *
       * ⚠️ The predicate must be exactly itemstatus.isOfferable: statusOf() falls back to 'available' for a missing, blank or
       * unrecognised status, so the SQL excludes the three blocked statuses rather than requiring 'available'. Requiring it would
       * under-count every product that never had the field, and the counter would then refresh itself in a loop for ever.
       */
      withEntity(entity_id, (db) => db.query(
        `SELECT count(*)::int AS n FROM catalogue_items
           WHERE entity_id = $1 AND is_active = true
             AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')
                 NOT IN ('redundant', 'retired')`, [entity_id])).catch(() => ({ rows: [{ n: null }] })),
    ]);

    /**
     * ⭐ WHAT THIS SHOP DECLARED ABOUT ITS OWN PRODUCTS (2026-09-08). A pharmacy declares composition, a paint shop a shade, a
     * hardware shop a size — the declared columns are the one place that is already true, so the counter reads them rather than
     * inventing a field list of its own.
     * ⚠️ THREE, SHORT. A counter row is read at a glance, and a snapshot is carried on a device: every field costs bytes on ten
     * thousand items, so the first three declared columns travel and each value is trimmed.
     */
    let declared = [];
    try {
      const sc = await query(
        `SELECT sf.field_key, sf.field_name
           FROM entity_schemas es JOIN schema_fields sf ON sf.schema_id = es.schema_id
          WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
          ORDER BY sf.display_order LIMIT 3`, [entity_id]);
      declared = sc.rows.map((x) => ({ k: x.field_key, n: x.field_name || x.field_key }));
    } catch (_) { declared = []; }   /* a shop that declared nothing shows nothing — the ordinary case */

    /* the live offers this shop is running — the same rows the storefront and the chit read */
    let offers = [];
    try {
      const live = await catalogueView.liveOffers({ entity_id, withEntity, viewer: null, groups: [], all: false });
      offers = Array.isArray(live) ? live : (live && live.offers) || [];
    } catch (_) { /* a shop with no offers bills fine */ }

    /* the counter's customer list — a name and a phone, nothing more; the till looks up a repeat customer, it does not hold history */
    let customers = [];
    try {
      const c = await withEntity(entity_id, (db) => db.query(
        `SELECT display_name, phone, groups FROM customer_list WHERE entity_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 2000`, [entity_id]));
      customers = c.rows.map((x) => ({ name: x.display_name, phone: x.phone || null, groups: Array.isArray(x.groups) ? x.groups : [] }));
    } catch (_) { /* the column set differs before b205 — the till still bills */ }

    /**
     * ⭐ THE PEOPLE WHO MAY STAND AT A COUNTER (2026-09-07). The shop's own co-assists — never the connectors, which are actors too
     * and would otherwise offer "Zoho Books connector" as a cashier. Name and id only: the till records WHO billed, it does not
     * authenticate anybody, and nothing about a person's contact details belongs on a device at a counter.
     */
    let staff = [];
    try {
      const st = await query(
        `SELECT identity_id, display_name, hat FROM identities
          WHERE parent_entity_id = $1 AND identity_type = 'actor' AND status = 'active'
            AND (actor_type IS NULL OR actor_type <> 'connector') AND connector_type IS NULL
          ORDER BY display_name LIMIT 200`, [entity_id]);
      staff = st.rows.map((a) => ({ id: a.identity_id, name: a.display_name, hat: a.hat || null }));
    } catch (_) { /* a shop with no co-assists bills as the shop itself */ }

    /* ⚠️ A CAP, AND IT IS A REAL LIMIT. 20,000 items is about 5 MB in one answer — heavy but workable on a shop line. Beyond that
       the snapshot must PAGE (a cursor beside ?since=), because no counter should wait on a 26 MB download; measured 2026-09-08. */
    const all = (itemRows && itemRows.rows) || [];
    /**
     * ⚠️ SELLABLE, NOT MERELY ALIVE. `is_active` says the row exists; itemstatus.isOfferable says a customer may take one — retired,
     * unavailable and redundant are all alive and all unsellable. Filtering on the wrong one put retired stock on the counter
     * ([TILL-02], 2026-09-08).
     * On a delta, anything that changed and is NO LONGER offerable travels as a REMOVAL: an absence cannot be expressed by a list of
     * present rows, and a till that never hears about it goes on selling something the shop has withdrawn.
     */
    /**
     * ⚠️⚠️ A COUNTER MUST SEE WHAT IT HAS TAKEN OFF THE SHELF. The snapshot sent only OFFERABLE rows, so the moment somebody
     * marked something out of stock it vanished from the counter completely — and could never be put back from there. The
     * Stock-out screen listed "what is off the shelf right now" from a list those rows had just left. Found while redesigning
     * the row, not by a test: the feature was written and shipped the same afternoon.
     *
     * So the counter is sent what it can SELL plus what it has itself taken OFF, and nothing else — retired and redundant stay
     * out, because those are lifecycle decisions nobody reverses at a till.
     * ⚠️ "avail" already rides on every row, and hits() refuses to offer an unavailable one in Sell, Receive or Despatch. The
     * snapshot's job is to say what is true; deciding what may be BILLED is the counter's, and it was already doing it.
     */
    const sellable = (r) => r.is_active !== false && itemstatus.isOfferable(r.item_data || {});
    const onTheCounter = (r) => r.is_active !== false
      && ['available', 'unavailable'].indexOf(itemstatus.statusOf(r.item_data || {})) >= 0;
    /* a removal is now "no longer on the counter at all" — retired or redundant — not merely "not sellable today" */
    const removed = since ? all.filter((r) => !onTheCounter(r)).map((r) => r.item_id) : [];
    /* ⭐ ONE GSTIN, READ ONCE — see the note where it is used. It may be on the identity row or in the profile; whichever it
       is, the state code is its first two digits and must not be derived from the other field. */
    const gstin = row.gstn || profile.gstin || null;
    /* ⚠️ ONE DERIVATION, read by the shop block AND by payWays — two answers about which country a shop is in would
       eventually mean one screen offering a payment method another refuses. */
    const cbProfile = require('../lib/profile');
    const cbCountry = cbProfile.countryOf({ country: row.country, gstin, profile });
    const items = all.filter(onTheCounter).map((it) => {
      const d = it.item_data || {};
      return { item_id: it.item_id, name: d.name, code: d.code || d.sku || null, unit: d.unit || 'piece',
               /* ⚠️ A PRICE IS SOMETIMES MONEY, NOT A NUMBER: the catalogue stores { amount, currency } as well as a bare figure,
                  and reading only the bare one gave the counter a shelf of zeroes ([TILL-01], first run). Same reader as pricing-engine. */
               price: amountOf(d.price), mrp: amountOf(d.mrp),
               hsn: d.hsn || d.hs_code || d.hsn_code || null, tax_slab: d.tax_slab || null, category: d.category || null,
               /* ⭐ THE SHOP'S OWN PICTURE. Already a PUBLIC url (routes/products mediaUrl → /api/products/media/…), so the
                  counter and the shop screen can draw it without a key and without a second round trip. Null for most rows and
                  that is fine — the screen falls back to the category emblem rather than leaving a hole. */
               image: d.image || null,
               barcode: d.barcode || d.ean || null, avail: d.avail || null,
               /**
                * ⚠️⚠️ "avail" IS NOT THE STATUS, AND THE COUNTER WAS READING IT AS ONE. lib/itemstatus.js says so in as many
                * words: item_data.avail is a QUANTITY feed ({qty, source, as_of}) — how many are on the shelf — while the
                * lifecycle (available · unavailable · retired · redundant) lives in item_data.status.
                *
                * The counter's Stock-out button compared i.avail against the string 'unavailable' and assigned the string back.
                * Against an object that comparison is ALWAYS false, so:
                *   · the button only ever toggled one way on the first press
                *   · POST /api/till/stock correctly stamped item_data.status on the server — a field the snapshot never sent —
                *     so the next re-read brought the row back looking available, and the shopkeeper's decision was gone
                *   · the "off the shelf right now" list read the same wrong field, so it could never list anything
                * The whole feature was writing to one field and reading another. Both now travel, each meaning its own thing.
                */
               status: itemstatus.statusOf(d),
               /**
                * ⚠️ READ FOR A WEEK, NEVER SENT. lib/offers-engine.js matches an offer against l.excluded, and the counter's
                * lineOf() dutifully passed item.offers_excluded — a field the snapshot did not carry, so it was always
                * undefined and a shop's opt-out of an offer has never once been honoured at a till. Found while giving it a
                * switch to be set from.
                */
               offers_excluded: Array.isArray(d.offers_excluded) ? d.offers_excluded.map(String) : [],
               /**
                * ⭐ THE PRICING STRUCTURE THE PRODUCT CITES, as its TRAVELLING COPY (lib/pricing-engine copyOf) —
                * never the definition id alone. A counter that had to resolve a definition could not price with the
                * line down, and a bill reprinted next year must say what it was priced by, not what that structure
                * has since become.
                */
               pricing_kind: d.pricing_kind || null,
               pricing_tiers: Array.isArray(d.pricing_tiers) ? d.pricing_tiers : null,
               pricing_amount: d.pricing_amount == null ? null : Number(d.pricing_amount),
               pricing_min: d.pricing_min == null ? null : Number(d.pricing_min),
               pricing_max: d.pricing_max == null ? null : Number(d.pricing_max),
               pricing_def_name: d.pricing_def_name || null,
               /* ⭐ picked by hand for the shop screen — the one thing promo.html cannot work out from the catalogue itself */
               screen: d.screen === true,
               /* ⭐ WHAT EACH SUPPLIER CALLS IT (2026-09-08) — so a goods-in scan of THEIR code finds OUR product, and their carton
                  converts to our pieces. Capped: an alias list is a memory aid, not a place to accumulate. */
               aliases: Array.isArray(d.aliases) ? d.aliases.slice(0, 20).map((a) => ({ by: a.by || null, text: a.text,
                          unit: a.unit || null, factor: a.factor == null ? null : Number(a.factor) })) : null,
               /**
                * ⭐⭐ THE SHOP'S OWN WORDS — thakkali, vengayam, milagai. `synonyms` is a field lib/itemmatch.js has read since August
                * for WhatsApp orders and consolidation, so the same word resolved in a message and failed at the counter. One
                * authority, read by both now.
                */
               synonym_text: Array.isArray(d.synonyms) ? (d.synonyms.map((x) => String(x || '')).filter(Boolean).join(' ') || null) : null,
               /* and flattened, because the counter's own search reads fields — so typing what the SUPPLIER calls it finds it */
               alias_text: Array.isArray(d.aliases) ? (d.aliases.slice(0, 20).map((a) => a.text).filter(Boolean).join(' ') || null) : null,
               brand: d.brand || null, variant: d.variant || d.grade || null,
               /* the shop's own declared facts — a pharmacy's composition, a paint shop's shade. Trimmed: a row is read at a glance. */
               facts: declared.map((f) => { const v = d[f.k];
                          return (v == null || typeof v === 'object' || String(v) === '') ? null : { n: f.n, v: String(v).slice(0, 40) };
                        }).filter(Boolean) };
    }).filter((x) => x.name);

    const body = {
      at: new Date().toISOString(),
      /**
       * ⭐⭐ WHICH SHOP IS THIS, ANSWERED BY THE SERVER (2026-09-08). Athi: *"can we check is there any other user id sits in the
       * session layer, so we can open it correctly?"* A counter could not check, because nothing it held said whose shop it was —
       * the key is opaque and the name is only a name. Now the snapshot says, and the counter compares that against the shop it was
       * opened FOR. A mismatch is caught before a single line is billed, rather than found in the books afterwards.
       */
      entity_id,
      shop: {
        name: profile.trade_name || row.display_name || 'This shop',
        legal_name: profile.legal_name || null,
        address: [profile.address, profile.city, profile.state, profile.pincode].filter(Boolean).join(', ') || null,
        phone: profile.phone || null,
        /**
         * ⚠️⚠️ ONE GSTIN, READ ONCE. These two lines disagreed: gstin fell back to the PROFILE, state_code did not. A shop
         * whose GSTIN is recorded in the profile rather than on the identity row therefore came through as registered — so
         * the counter charged GST — with no state code, so CBTax.supplyType answered 'unknown' and the tax could not be
         * split into CGST and SGST. A TAX INVOICE with a lumped GST line, from a shop that had filled the field in.
         * Athi hit exactly this the moment he added one: *"GSTN ref is there in the profile."*
         * ⚠️ The state code IS the first two digits of the GSTIN — so it must come from whichever GSTIN was actually used.
         */
        gstin: gstin,
        state_code: String(gstin || '').slice(0, 2) || null,
        reg_type: String(flags.gst_registration || 'regular'),
        /* ⭐ the jurisdiction, derived once and used by everything below — see lib/profile.countryOf */
        country: cbCountry,
        /**
         * ⭐⭐ THE WAYS THIS SHOP CAN BE PAID, decided by its COUNTRY and its declared payee addresses — not a
         * upi_id field, which is the India-shaped thing the jurisdiction work already ruled against.
         * ⚠️ It travels with the snapshot ON PURPOSE: a merchant-presented QR is made from a string with no network
         * involved, and a till that could not take a UPI payment exactly when the line was down would fail at the
         * worst possible moment.
         * ⚠️ Card and wallet carry qr:null and always will — Apple Pay and the like ride a card rail through an
         * acquirer, and there is nothing honest for us to generate.
         */
        pay: cbProfile.payWays({ country: cbCountry, policy_flags: row.policy_flags }),
        currency: profile.currency || 'INR',
      },
      items, removed, delta: !!since, since: since || null, offers, staff,
      /* how many sellable products the shop has right now — the counter checks its merged copy against this (see the note above) */
      total: (liveCount && liveCount.rows && liveCount.rows[0] && liveCount.rows[0].n != null) ? liveCount.rows[0].n : null,
      /**
       * ⚠️⚠️ A MAP DOES NOT SURVIVE JSON, AND THAT IS WHY THE COUNTER HAD NO TAX (Athi, 2026-09-08: *"no, tax is not there"*).
       *
       * `taxShelf.readShelf()` returns `slabs` as a **Map** — every in-process caller (the chit send, catalogue-view) passes it
       * straight to taxSlab.resolve, which accepts a Map, so it has always been right for them. This route does not pass it to a
       * function; it puts it on the wire. `JSON.stringify(new Map())` is `{}` — so EVERY snapshot the till has ever taken carried
       * `slabs: {}`, no rate resolved on any product, and no GST appeared anywhere. Nothing threw. Nothing logged. The counter just
       * quietly billed without tax.
       *
       * ⚠️ The type was fine at every boundary except the one that serialises, which is exactly the kind of bug a type nobody
       * checks produces: correct in four call sites and silently empty in the fifth.
       */
      slabs: (shelf && shelf.slabs instanceof Map) ? [...shelf.slabs.values()] : ((shelf && shelf.slabs) || []),
      categories: (shelf && shelf.categories) || [], face: (shelf && shelf.face) || {},
      customers,
      policy: { books_at: flags.books_at || 'accepted', qty_zero_hides: flags.qty_zero_hides || 'off',
                /* ⭐ how much difference is not a dispute — set once by the trade, applied at the door (lib/lotfields) */
                price_includes_tax: String(flags.price_includes_tax || 'yes'),
                /* ⭐ CAN THIS SERVER TRANSCRIBE? The counter picks a recogniser without a round trip to find out. */
                speech: speech.available() ? 'server' : 'browser',
                tolerance: { weight_bp: flags.tol_weight_bp == null ? 50 : Number(flags.tol_weight_bp),
                             count_units: Number(flags.tol_count_units) || 0,
                             rate_bp: Number(flags.tol_rate_bp) || 0 } },
      /**
       * ⭐⭐ THE VERTICAL, AS A FIELD PACK (2026-09-08). Athi: *"we have already vertical in our governance, so it can nicely tide
       * upon."* The shop's own sector decides what goods-in asks about a CONSIGNMENT — batch and expiry for medicine, a serial for
       * a warranty item, nothing at all for general trade. It travels with the snapshot, so a counter with the line down still
       * knows what to ask and what to refuse.
       */
      lot_fields: lotfields.forEntity(sectors),
    };
    body.version = versionOf({ i: items, o: offers, s: body.slabs, sh: body.shop, st: staff });
    res.json(body);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ EARLIER BILLS (2026-09-08). A device holds today; ChitBridge holds the history, because a till can be lost or replaced and a
 * shop's record must outlive it. This returns THIS shop's counter sales only — a chit that carries a bill number — newest first, with
 * their lines, so an old slip can be printed again from any till.
 *   GET /api/till/bills?days=30&by=<actor_id>&limit=100
 * ⚠️ It reads nothing else. A till key cannot open the inbox, a supplier's chit or anybody's messages, and this route keeps that true:
 * the WHERE clause is the shop, the purpose, and the presence of a bill number.
 */
/**
 * ⭐⭐⭐ TWO THINGS A SHOPKEEPER DOES ON THEIR FEET — POST /api/till/stock and POST /api/till/price.
 *
 * Athi, 2026-09-09: *"do the stock out and price change counters."* Both pass the backlog's test — name the moment when somebody
 * is STANDING UP, or it does not deserve a counter:
 *   · stock out    — you notice an empty shelf while serving, and the next customer must not be offered it
 *   · price change — a supplier's new rate, called across the shop, and the very next bill must use it
 * Neither is worth walking to a desk for, and both are wrong the moment they are delayed.
 *
 * ⚠️ TWO NARROW ROUTES, NOT A PRODUCT PATCH. The obvious shortcut is to let a till key PATCH /api/products/:id — which would hand
 * every counter in the shop the power to rewrite any field of any product: rename it, re-slab it, change its HSN. A till is often
 * on a shared PC in a public part of the shop. So a till key can change exactly two things, each by its own route, each recording
 * who and when. Same reasoning as /api/till/alias, which was the narrowest write a counter already had.
 *
 * ⚠️ THE STAMP IS THE CATALOGUE'S OWN (itemstatus.stamp), so a status set at the counter is indistinguishable in shape from one
 * set on the product page — one status model, not a counter dialect of it.
 */
router.post('/stock', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const item_id = String((req.body && req.body.item_id) || '');
    const status = String((req.body && req.body.status) || '').toLowerCase();
    if (!item_id) return res.status(400).json({ error: 'validation', message: 'item_id required' });
    /* ⚠️ available and unavailable ONLY. 'retired' and 'redundant' carry an argument — what replaced it, until when — and nobody
       makes that call standing at a till with a customer waiting. The same two the bulk screen offers, for the same reason. */
    if (['available', 'unavailable'].indexOf(status) < 0)
      return res.status(400).json({ error: 'validation', message: "status must be 'available' or 'unavailable'" });
    const rec = itemstatus.stamp({ status, until: (req.body && req.body.until) || undefined,
                                   note: (req.body && req.body.note) || undefined },
                                 { actor_name: (req.body && req.body.by) || 'the counter' });
    const r = await withEntity(entity_id, (db) => db.query(
      'UPDATE catalogue_items SET item_data = COALESCE(item_data, \'{}\'::jsonb) || $1::jsonb, updated_at = NOW()'
      + ' WHERE entity_id = $2 AND item_id = $3 RETURNING item_id, item_data',
      [JSON.stringify(rec), entity_id, item_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    shopChanged(entity_id, 'stock ' + status);
    const d = r.rows[0].item_data || {};
    res.json({ ok: true, item_id, name: d.name || null, status });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ THE SMALL DECISIONS A SHOPKEEPER MAKES ABOUT ONE PRODUCT. Athi, 2026-09-09: *"the catalogue management, minimal stuff —
 * changing availability, product price, offer enable/disable, show on TV — all can be kept in the same place."*
 *
 * Two of those four already had a route (/stock and /price). These are the other two, and they are deliberately as narrow:
 *   { item_id, screen: true|false }              — put this product on the shop screen, or take it off
 *   { item_id, offer_id, excluded: true|false }  — take this product OUT of one offer, or put it back in
 *
 * ⚠️ STILL NOT A PRODUCT PATCH. A key scoped to a till may set the handful of flags a person standing at a counter is
 * entitled to decide. It may not rename a product, move its category or edit its tax — those are catalogue decisions with
 * consequences a till cannot see, and the blast radius of a stolen counter key is exactly the list above.
 * ⚠️ ONE ROUND TRIP. The exclusion list is rebuilt in SQL rather than read-then-written: the same jsonb both removes the id and
 * re-adds it, so the operation is idempotent in both directions and cannot double an entry (Mumbai is a long way from sfo).
 */
router.post('/flags', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const item_id = String(b.item_id || '');
    if (!item_id) return res.status(400).json({ error: 'validation', message: 'item_id required' });

    let sql, args;
    if (b.offer_id != null) {
      const offer_id = String(b.offer_id);
      const excluded = b.excluded === true || b.excluded === 'true';
      sql = "WITH kept AS ("
          + "  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) AS ex"
          + "  FROM catalogue_items ci"
          + "  LEFT JOIN LATERAL jsonb_array_elements_text("
          + "    CASE WHEN jsonb_typeof(ci.item_data->'offers_excluded') = 'array'"
          + "         THEN ci.item_data->'offers_excluded' ELSE '[]'::jsonb END) x ON x <> $3"
          + "  WHERE ci.entity_id = $1 AND ci.item_id = $2)"
          + " UPDATE catalogue_items SET item_data = COALESCE(item_data, '{}'::jsonb)"
          + "   || jsonb_build_object('offers_excluded',"
          + "        CASE WHEN $4 THEN (SELECT ex FROM kept) || to_jsonb($3::text) ELSE (SELECT ex FROM kept) END),"
          + "   updated_at = NOW()"
          + " WHERE entity_id = $1 AND item_id = $2 RETURNING item_id, item_data";
      args = [entity_id, item_id, offer_id, excluded];
    } else if (b.screen !== undefined) {
      sql = "UPDATE catalogue_items SET item_data = COALESCE(item_data, '{}'::jsonb) || jsonb_build_object('screen', $3::boolean),"
          + " updated_at = NOW() WHERE entity_id = $1 AND item_id = $2 RETURNING item_id, item_data";
      args = [entity_id, item_id, b.screen === true || b.screen === 'true'];
    } else {
      return res.status(400).json({ error: 'validation', message: 'nothing to set — pass screen, or offer_id with excluded' });
    }

    const r = await withEntity(entity_id, (db) => db.query(sql, args));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const d = r.rows[0].item_data || {};
    /* ⭐ the shop screen and every open counter hear about it on the same bell a price change rides */
    shopChanged(entity_id, b.offer_id != null ? 'offer opt-out' : 'screen pick');
    res.json({ ok: true, item_id, name: d.name || null,
               offers_excluded: Array.isArray(d.offers_excluded) ? d.offers_excluded : [], screen: d.screen === true });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ TURN A DECLARED OFFER ON OR OFF FOR ONE PRODUCT. Athi, 2026-09-09: *"no new offers can be created; an already
 * existing offer can be made obsolete for the product … you already have multiple offers listed, which you want to
 * turn on."* His example is the whole point: *"a lot of tomato is being sold but potato is not moving — turn on the
 * potato tied with tomato and push potato as well."* That decision is made at the counter, looking at the shelf, and
 * it is worth nothing an hour later in an office.
 *
 * ⚠️⚠️ THIS WRITES TO A GOVERNED OBJECT, which nothing else a till key can reach does. Three things keep it honest:
 *
 *  1. IT CAN ONLY MOVE ONE PRODUCT IN OR OUT OF ONE EXISTING LIVE OFFER. It cannot create an offer, retire one,
 *     rename it, change its discount, its dates, its customer group or any other rule. The new rules object is
 *     built from the old one with ONE key touched — applies_to.item_ids — so there is no shape in which a counter
 *     key edits what an offer is worth. That is the boundary Athi drew himself: "only the declared offer".
 *  2. IT APPENDS A VERSION, it does not edit one. definition_version is append-only BY GRANT (no UPDATE, no DELETE
 *     for cb_app), so this is not a convention that can be forgotten — and the note records the counter and the
 *     person, which is better provenance than the lab records for the same edit.
 *  3. LIVE OFFERS ONLY. A draft or retired offer is not something a shopkeeper can be looking at on a shelf.
 *
 * ⚠️ THE ENGINE ALREADY UNDERSTANDS THIS and no engine code changes: lib/offers-engine.js treats item_ids, skus and
 * categories as a UNION — "an offer ticked on a product reaches the product even when it sits elsewhere".
 */
/**
 * ⭐⭐ WHAT IS WORTH AN OFFER TODAY. Athi, 2026-09-09: *"if the till knows expiry-nearing product, that can be made
 * an offer … it depends on the type of business — if it is perishable, the offer has to be turned on quicker."* And
 * before that: *"a lot of tomato is being sold, but potato is not moving much."*
 *
 * Two signals, both read from what the shop has ALREADY recorded — nothing new is asked of anybody:
 *
 *  1. SHELF LIFE. lib/lotfields is explicit that an expiry belongs to a BATCH, not a product: *"one product has many
 *     batches, each with its own expiry, and confusing the two is the single most common way a small ERP paints
 *     itself into a corner — it puts expiry on the product and then cannot answer which of these do I sell first."*
 *     So this reads the RECEIVE chits, where the batch was recorded at the door, and reports the nearest expiry per
 *     product. A product received three times has three batches and it is the earliest that decides.
 *  2. NOT MOVING. Days since the product was last on a bill, from the shop's own sales. No stock ledger is needed
 *     and none is claimed — "not sold for 9 days" is a fact; "14 kg unsold" would be a guess.
 *
 * ⚠️ IT REPORTS, IT NEVER ACTS. Turning an offer on is a merchandising decision with a discount attached, and the
 * tap stays the shopkeeper's. Every row carries its REASON, because a suggestion nobody can argue with is one
 * nobody will keep reading.
 * ⚠️ AND IT NEVER INVENTS AN URGENCY. "Soon" is not one number — milk is hours, biscuits are weeks — so the caller
 * passes the window and the counter takes it from the shop's own sector, the same place lotfields reads.
 */
router.get('/worth-an-offer', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 14));
    const quiet = Math.max(1, Math.min(365, Number(req.query.quiet) || 14));

    const rows = await withEntity(entity_id, (db) => db.query(
      `WITH lines AS (
         SELECT h.chit_id, h.created_at, h.direction, h.business_json, l AS line
           FROM chit_header h
           JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) AS l
          WHERE h.entity_id = $1 AND h.created_at > now() - interval '400 days')
       SELECT
         /**
          * ⚠️⚠️ THE TWO LINE SHAPES ARE NOT THE SAME, and assuming one is why this found nothing on its first run.
          * A BILL line puts item_id at the top: { particulars, quantity, unit, price, total, item_id }
          * A GOODS-IN line nests it with the batch: { particulars, …, item_data: { item_id, lot: { batch, expiry } } }
          * Both are correct — a goods-in carries per-consignment facts a sale has no use for — so the query reads
          * either, rather than the chit writers being bent to match a report.
          */
         COALESCE(line->>'item_id', line#>>'{item_data,item_id}') AS item_id,
         MAX(line->>'particulars') AS name,
         /* the earliest expiry recorded for this product at ANY door it came in through */
         MIN(NULLIF(line#>>'{item_data,lot,expiry}', '')) AS expiry,
         /**
          * the last time it was SOLD. A till bill is a SELF chit, so direction cannot be the test — business_json.slip
          * is written only by a bill (cash · tax · supply) and business_json.doc only by a GRN or a delivery note.
          */
         MAX(created_at) FILTER (WHERE business_json ? 'slip') AS last_sold
       FROM lines
       WHERE COALESCE(line->>'item_id', line#>>'{item_data,item_id}') IS NOT NULL
       GROUP BY 1`, [entity_id]));

    const today = new Date();
    const dayOf = (d) => Math.floor((new Date(d) - today) / 86400000);
    const out = [];
    for (const r of rows.rows) {
      const why = [];
      let urgency = 0;
      if (r.expiry) {
        const left = dayOf(r.expiry);
        /* ⚠️ "expires in 1 days" is the kind of thing that makes a shopkeeper stop trusting the rest of the sentence */
        const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
        if (left <= days) {
          why.push(left < 0 ? ('expired ' + plural(Math.abs(left), 'day') + ' ago')
                 : (left === 0 ? 'expires today'
                 : (left === 1 ? 'expires tomorrow' : ('expires in ' + plural(left, 'day')))));
          urgency += (days - left) + (left < 0 ? 100 : 0);
        }
      }
      if (r.last_sold) {
        const since = Math.abs(dayOf(r.last_sold));
        if (since >= quiet) { why.push('not sold for ' + since + ' day' + (since === 1 ? '' : 's')); urgency += Math.min(since, 90) / 3; }
      } else {
        why.push('never sold here'); urgency += 10;
      }
      if (why.length) out.push({ item_id: r.item_id, name: r.name, expiry: r.expiry || null,
                                 last_sold: r.last_sold || null, why, urgency: Math.round(urgency) });
    }
    out.sort((a, b) => b.urgency - a.urgency);
    res.json({ ok: true, days, quiet, items: out.slice(0, 60),
               /* ⚠️ said out loud: this is what the shop RECORDED, not a stock count nobody has taken */
               basis: 'expiry recorded at goods-in, and the last time each product was on a bill' });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.post('/offer-item', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const offer_id = String(b.offer_id || '');
    const item_id = String(b.item_id || '');
    const on = b.on === true || b.on === 'true';
    if (!offer_id || !item_id) return res.status(400).json({ error: 'validation', message: 'offer_id and item_id required' });

    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(
        `SELECT d.definition_id, d.name, d.current_version, d.status, d.kind, v.rules
           FROM definition d
           LEFT JOIN definition_version v
             ON v.definition_id = d.definition_id AND v.version = d.current_version
          WHERE d.entity_id = $1 AND d.definition_id = $2`, [entity_id, offer_id]);
      if (!cur.rows.length) return { missing: true };
      const d = cur.rows[0];
      /* ⚠️ an offer only — this route must never become a way to edit any other kind of definition */
      if (d.kind !== 'offer') return { refused: 'that is not an offer' };
      if (d.status !== 'live') return { refused: 'that offer is not live' };

      const rules = (d.rules && typeof d.rules === 'object') ? d.rules : {};
      const applies = (rules.applies_to && typeof rules.applies_to === 'object') ? rules.applies_to : {};
      const had = Array.isArray(applies.item_ids) ? applies.item_ids.map(String) : [];
      const next = on ? (had.indexOf(item_id) >= 0 ? had : had.concat([item_id]))
                      : had.filter((x) => x !== item_id);
      /* nothing to record is not an error, and a version for it would be noise in the one history that must stay readable */
      if (next.length === had.length && next.every((x, n) => x === had[n]))
        return { ok: true, unchanged: true, name: d.name };

      /* ⭐ ONE KEY TOUCHED. Everything else about the offer is carried across exactly as it was. */
      const newRules = Object.assign({}, rules, { applies_to: Object.assign({}, applies, { item_ids: next }) });
      const version = d.current_version + 1;
      const who = (b.by ? String(b.by).slice(0, 60) : null);
      await db.query(
        `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [offer_id, version, entity_id, newRules,
         (on ? 'Product added at the counter' : 'Product removed at the counter') + (who ? ' by ' + who : ''),
         req.identity && req.identity.identity_id]);
      await db.query(
        `UPDATE definition SET current_version = $2, updated_at = now() WHERE definition_id = $1`,
        [offer_id, version]);
      return { ok: true, name: d.name, version };
    });

    if (out.missing) return res.status(404).json({ error: 'Not found' });
    if (out.refused) return res.status(400).json({ error: 'validation', message: out.refused });
    shopChanged(entity_id, 'offer ' + (on ? 'added to' : 'removed from') + ' a product');
    res.json(Object.assign({ ok: true, offer_id, item_id, on }, out));
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.post('/price', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const item_id = String((req.body && req.body.item_id) || '');
    const price = Number(req.body && req.body.price);
    if (!item_id) return res.status(400).json({ error: 'validation', message: 'item_id required' });
    if (!Number.isFinite(price) || price < 0)
      return res.status(400).json({ error: 'validation', message: 'price must be a number, zero or more' });
    const currency = await regional.currencyFor(entity_id).catch(() => 'INR');
    /**
     * ⚠️ A PRICE IS MONEY, NOT A NUMBER — the catalogue stores { amount, currency }, and reading only the bare figure once gave a
     * counter a shelf of zeroes ([TILL-01]). It is written in the shape it is read in.
     * ⚠️ AND THE OLD ONE IS KEPT. price_was, when, and by whom — so a shopkeeper can see what moved today, and "you charged me
     * more than yesterday" has an answer that is not somebody's memory.
     */
    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2', [entity_id, item_id]);
      if (!cur.rows.length) return null;
      const d = cur.rows[0].item_data || {};
      const was = (d.price && typeof d.price === 'object') ? d.price.amount : d.price;
      const patch = { price: { amount: price, currency },
                      price_was: (was == null ? null : Number(was)),
                      price_changed_at: new Date().toISOString(),
                      price_changed_by: String((req.body && req.body.by) || 'the counter').slice(0, 80) };
      const u = await db.query(
        'UPDATE catalogue_items SET item_data = COALESCE(item_data, \'{}\'::jsonb) || $1::jsonb, updated_at = NOW()'
        + ' WHERE entity_id = $2 AND item_id = $3 RETURNING item_data',
        [JSON.stringify(patch), entity_id, item_id]);
      return { was, now: price, name: (u.rows[0].item_data || {}).name || null };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    shopChanged(entity_id, 'price changed');
    res.json({ ok: true, item_id, name: out.name, was: out.was, now: out.now, currency });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐⭐ PAIRING — HOW A TELEVISION JOINS A SHOP WITHOUT TYPING A KEY.
 *
 * Athi, 2026-09-09: *"please add pairing so we can test 1 to many devices."* Typing
 * the full address with a 64-character key on a TV remote, with a
 * D-pad and an on-screen keyboard, is not a thing anyone will do twice.
 *
 * So: the shop asks for a CODE, the television types six characters, and the server hands it a screen key.
 *
 *   POST /api/till/pair        (session)  → { code, expires_at }   the shop generates one, per screen
 *   POST /api/till/pair/claim  (no auth)  → { key, shop }          the screen exchanges it, ONCE
 *
 * ⚠️ SIX CHARACTERS IS ONLY SAFE BECAUSE OF THE OTHER THREE RULES, and they are not optional:
 *   · TEN MINUTES  — a code is dead long before anyone could work through the space
 *   · ONCE         — claimed is claimed; a replay gets nothing, so a code read off a screen by a passer-by is spent
 *   · SLOWED       — wrong guesses are counted and the door shuts for a minute after a handful
 * The alphabet drops O·0·I·1·L, which is 27 characters and about 387 million codes. Someone reading the six characters off the
 * television during those ten minutes can pair a second screen — and a screen key can only read the price list, which is
 * printed on the shelf edge anyway. That is the whole reason pairing hands out a SCREEN key and never a till key.
 *
 * ⚠️ THE CODES LIVE IN MEMORY, ON PURPOSE. A pending code is worthless ninety seconds after it is made, so a table, a
 * migration and a cleanup job would all be carrying something that does not need to outlive a restart. A deploy in the middle
 * of pairing loses the code — you press the button again. Said out loud rather than discovered.
 */
const PAIR = new Map();              /* code → { entity_id, name, expires } */
const PAIR_MISSES = new Map();       /* ip → { n, until } */
const PAIR_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2345678';
const PAIR_TTL_MS = 10 * 60 * 1000;

function pairSweep() {
  const now = Date.now();
  for (const [k, v] of PAIR) if (v.expires < now) PAIR.delete(k);
  for (const [k, v] of PAIR_MISSES) if (v.until < now) PAIR_MISSES.delete(k);
}
function pairCode() {
  const crypto = require('crypto');
  for (;;) {
    const b = crypto.randomBytes(6);
    let c = '';
    for (let i = 0; i < 6; i++) c += PAIR_ALPHABET[b[i] % PAIR_ALPHABET.length];
    if (!PAIR.has(c)) return c;
  }
}

/** the shop asks for a code — one per screen, so two televisions can be revoked apart */
router.post('/pair', auth, async (req, res) => {
  try {
    pairSweep();
    /* ⚠️ A KEY MAY NOT MINT A KEY. Pairing hands out authority, so it is gated to a signed-in person exactly as authoring a
       definition is — otherwise a counter key on a shared PC could quietly furnish itself a family of screen keys. */
    /* ⚠️ req.api_key is how middleware/auth marks a request that arrived with a key. I first guessed `via_key`, which nothing
       sets — and a guard testing a field nobody sets is a guard that always passes. */
    if (!req.identity || req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Sign in to pair a screen.' });
    const entity_id = auth.entityOf(req);
    const me = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]);
    const code = pairCode();
    const expires = Date.now() + PAIR_TTL_MS;
    PAIR.set(code, { entity_id, name: (me.rows[0] && me.rows[0].display_name) || null, expires });
    res.json({ code, expires_at: new Date(expires).toISOString(), minutes: Math.round(PAIR_TTL_MS / 60000) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/** the screen exchanges it — no key, because it does not have one yet; that is the entire point */
router.post('/pair/claim', async (req, res) => {
  try {
    pairSweep();
    const ip = String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
    const miss = PAIR_MISSES.get(ip);
    if (miss && miss.n >= 8 && miss.until > Date.now())
      return res.status(429).json({ error: 'Too many', message: 'Too many wrong codes. Wait a minute and try again.' });

    const code = String((req.body && req.body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const got = code && PAIR.get(code);
    if (!got || got.expires < Date.now()) {
      const m = PAIR_MISSES.get(ip) || { n: 0, until: 0 };
      m.n += 1; m.until = Date.now() + 60000; PAIR_MISSES.set(ip, m);
      return res.status(404).json({ error: 'No such code',
        message: 'That code is wrong or has expired. Ask ChitBridge for a new one.' });
    }
    /* ⚠️ SPENT THE MOMENT IT IS READ, before the key is even minted — if minting fails the code is still gone, which is the
       safe way round: a code that survives a failure is a code somebody can retry. */
    PAIR.delete(code);
    const minted = await keys.mint(got.entity_id, null,
      { name: 'shop screen · paired ' + new Date().toISOString().slice(0, 10), scopes: ['screen'], days: 365 });
    PAIR_MISSES.delete(ip);
    res.json({ key: minted.key, shop: { entity_id: got.entity_id, name: got.name } });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐⭐ GET /api/till/verify — CAN THIS COUNTER PROVE IT IS RIGHT?
 *
 * Athi, 2026-09-09: *"i am going crazy now — how to gain confidence it is reading the entire catalogue and also not mixing up, and
 * counter works fine and rightly synced."*
 *
 * That is not a question prose can answer. Anyone can be TOLD the copy is good; what was missing is a way to CHECK it, on the spot,
 * against the shop itself. So this is deliberately not the snapshot: it is a small, cheap, independent second opinion the counter
 * compares its own copy against, field by field.
 *
 *   total   how many sellable products the shop has right now
 *   at      the server's clock, so a stale copy is obvious
 *   shop    the entity and its name — the counter checks it is even looking at the right business
 *   sample  a handful of REAL rows, spread across the whole shelf rather than the first page, with the numbers that matter
 *
 * ⚠️ THE SAMPLE IS SPREAD ON PURPOSE. Taking the first eight rows would pass on a counter that only ever received page one — which
 * is the exact failure being checked for. These are drawn across the whole catalogue by offset, so a copy that stops at 500 fails.
 * ⚠️ It never repairs anything. A check that quietly fixes what it finds cannot be trusted to report honestly next time.
 */
router.get('/verify', auth, auth.requireScope('till'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const me = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]);
    const cnt = await withEntity(entity_id, (db) => db.query(
      `SELECT count(*)::int AS n FROM catalogue_items
         WHERE entity_id = $1 AND is_active = true
           AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')
               NOT IN ('unavailable', 'redundant', 'retired')`, [entity_id]));
    const total = (cnt.rows[0] && cnt.rows[0].n) || 0;

    /* eight rows spread across the shelf — first, last, and six evenly between */
    const want = Math.min(8, total);
    const offsets = [];
    for (let i = 0; i < want; i++) offsets.push(Math.floor((total - 1) * (want === 1 ? 0 : i / (want - 1))));
    /**
     * ⚠️ ONE QUERY, NOT EIGHT. The first cut ran a LIMIT 1 OFFSET n read per sample point, inside a loop — the textbook N+1, and
     * tests/query-shape caught it as "routes/till.js: 1 (budget 0)". A check that a counter is healthy must not itself cost the
     * server eight round trips across the Pacific every time somebody presses it.
     * row_number() numbers the shelf once and "= ANY" picks the wanted places out of it, which is exactly what the loop meant.
     */
    const sampleRows = await withEntity(entity_id, (db) => db.query(
      'WITH live AS (SELECT item_id, item_data, (row_number() OVER (ORDER BY item_id) - 1)::int AS n'
      + '   FROM catalogue_items WHERE entity_id = $1 AND is_active = true'
      + "     AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')"
      + "         NOT IN ('unavailable', 'redundant', 'retired'))"
      + ' SELECT item_id, item_data, n FROM live WHERE n = ANY($2::int[]) ORDER BY n',
      [entity_id, [...new Set(offsets)]])).catch(() => ({ rows: [] }));
    const sample = sampleRows.rows.map((row) => {
      const d = row.item_data || {};
      return { at_offset: row.n, item_id: row.item_id, name: d.name || null,
               price: amountOf(d.price), tax_slab: d.tax_slab || null };
    });
    res.json({ total, at: new Date().toISOString(),
               shop: { entity_id, name: (me.rows[0] && me.rows[0].display_name) || null }, sample });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.get('/bills', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const by = (typeof req.query.by === 'string' && /^[0-9a-f-]{36}$/.test(req.query.by)) ? req.query.by : null;
    const { withEntity } = require('../db');
    const r = await withEntity(entity_id, (db) => db.query(
      /* ⚠️ line_items is on chit_detail — chit_header has never had it (2026-09-08) */
      `SELECT h.chit_id, h.created_at, h.business_json, d.line_items, h.summary_json
         FROM chit_header h
         LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
       /**
        * ⚠️⚠️ NO DIRECTION TEST — AND THAT IS THE WHOLE BUG. A counter bill is a chit the shop sends to ITSELF, and a SELF chit
        * lands with direction 'received', not 'sent'. We knew that: it is why business_json.side exists and why sideOf() was
        * written. This query was still asking for 'sent', so it matched nothing, and "Earlier bills" has been an empty list since
        * the day it shipped — a screen that answers "you have no bills" to a shop that has been billing all week.
        *
        * ⚠️ It found nothing rather than erroring, which is why nobody noticed. [ISO-01] only caught it because it asked the
        * SERVER where the money went instead of believing the counter's own copy.
        *
        * The identity of a bill is the entity, the purpose, and the fact that it carries a bill_no. Direction is a fact about
        * who the counterparty was, and for a shop billing itself it is not the question being asked.
        */
        WHERE h.entity_id = $1 AND h.purpose IN ('order','offer')
          AND h.business_json ? 'bill_no'
          AND h.created_at > NOW() - ($2 || ' days')::interval
        ORDER BY h.created_at DESC LIMIT $3`, [entity_id, String(days), limit]));
    const rows = r.rows.map((x) => {
      const b = x.business_json || {}, t = b.till || {}, m = (x.summary_json || {}).money || {};
      return { chit_id: x.chit_id, no: b.bill_no || null, at: b.billed_at || x.created_at,
               customer: (b.customer && b.customer.name) || 'Walk-in',
               by: t.by || null, till: { id: t.id || null, name: t.name || null },
               total: m.total != null ? m.total : (m.net != null ? m.net : (x.summary_json || {}).total_value),
               saved: m.savings != null ? m.savings : null, taxable: m.net != null ? m.net : null, tax: m.tax != null ? m.tax : null,
               kind: b.slip || 'cash',
               payments: (b.payment && b.payment.parts) || [],
               lines: (Array.isArray(x.line_items) ? x.line_items : []).map((l) => ({
                 name: l.particulars || l.name, qty: l.quantity, unit: l.unit, price: l.price, net: l.total,
                 save: (l.offer && l.offer.off) || 0, off: !!l.offer, off_label: (l.offer && l.offer.label) || '', gst_rate: l.gst_rate, hsn: l.hsn })) };
    }).filter((x) => x.no && (!by || (x.by && x.by.id === by)));
    res.json({ days, count: rows.length, bills: rows });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ WHAT IS STILL OWED, EITHER WAY (2026-09-08 — purchase and despatch in the till format).
 *
 *   GET /api/till/tasks?kind=receive    the orders WE SENT that are not fully received  → the goods-in screen
 *   GET /api/till/tasks?kind=despatch   the orders WE RECEIVED that are not fully sent  → the picking screen
 *
 * One call, the same posture as the snapshot: the shop's own world, small enough to hold on a device and work from with the line
 * down. Each line carries what was ordered and what has already moved, so the screen can show REMAINING without arithmetic of its own.
 * ⚠️ Progress comes from lib/deliverline (b144) — events, never a stored total — so a part delivery recorded from anywhere, by
 * either party, is already reflected here. Nothing about "how much is left" is computed twice.
 * ⚠️ A chit whose lines are all complete is not a task. The screen must never show work that is done.
 */
const deliverline = require('../lib/deliverline');
const select = require('../lib/select');            /* ⭐ the shared selector: one definition of "my chits", counterparty included */

/**
 * ⭐⭐ WHICH WAY DOES AN ORDER FACE? (2026-09-08)
 *
 * An order we SEND is a purchase; an order we RECEIVE is a sale. That held until the ordinary Indian case turned up: a supplier who
 * is not on ChitBridge cannot be a recipient of a chit, so a shop's own purchase order has to be recorded as a SELF chit — and a
 * self chit lands as direction 'received', exactly like a customer's order to us. Direction stopped being enough to tell them apart.
 *
 * ⚠️ SO IT IS DECLARED, NOT INFERRED. `business_json.side` says 'buy' or 'sell', written by whoever creates the order. A chit that
 * does not say keeps the old meaning, which is what every chit written before today meant.
 */
function sideOf(head, bj) {
  const said = (bj && typeof bj.side === 'string') ? bj.side.toLowerCase() : null;
  if (said === 'buy' || said === 'sell') return said;
  return head.direction === 'sent' ? 'buy' : 'sell';
}
router.get('/tasks', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const kind = String(req.query.kind || 'despatch') === 'receive' ? 'receive' : 'despatch';
    const want = kind === 'receive' ? 'buy' : 'sell';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '40', 10) || 40, 1), 100);
    const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();

    /* ⚠️ BOTH DIRECTIONS, and sideOf decides — a purchase order for an off-platform supplier arrives as 'received' and is still a purchase */
    const heads = await select.rows(entity_id, { purpose: 'order', since, limit: 300 });
    if (!heads.length) return res.json({ kind, count: 0, tasks: [] });

    const { withEntity } = require('../db');
    const out = await withEntity(entity_id, async (db) => {
      const ids = heads.map((h) => h.chit_id);
      const li = await db.query(
        `SELECT h.chit_id, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`, [entity_id, ids]);
      const byId = new Map(li.rows.map((r) => [String(r.chit_id), r]));
      const tasks = [];
      for (const h of heads) {
        const det = byId.get(String(h.chit_id)) || {};
        const bj = det.business_json || {};
        if (bj.bill_no) continue;                     /* a counter sale is a record, not a task */
        if (sideOf(h, bj) !== want) continue;         /* the other way round belongs to the other screen */
        if (tasks.length >= limit) break;
        const prog = await deliverline.progress(entity_id, h.chit_id, db).catch(() => null);
        const lines = (Array.isArray(det.line_items) ? det.line_items : []).map((l) => {
          const p = (prog && prog.get) ? prog.get(l.line_id) : null;
          const ordered = Number(l.quantity) || 0;
          const moved = (p && p.delivered != null) ? Number(p.delivered) : 0;
          return { line_id: l.line_id || null,
                   item_id: (l.item_data && l.item_data.item_id) || l.item_id || null,
                   name: l.particulars || l.name || '', unit: l.unit || 'piece',
                   rate: l.price == null ? null : Number(l.price),
                   ordered, moved, remaining: Math.max(0, Math.round((ordered - moved) * 1000) / 1000) };
        });
        if (!lines.length) continue;
        if (lines.every((l) => l.remaining <= 0)) continue;      /* nothing owed: not a task */
        tasks.push({ chit_id: h.chit_id, at: h.created_at,
                     subject: h.manual_subject || h.auto_subject || '',
                     party: h.counterparty_name || (bj.party && bj.party.name) || '', party_id: h.counterparty_id || null,
                     ref: bj.order_no || bj.ref || null, lines });
      }
      return tasks;
    });
    res.json({ kind, count: out.length, tasks: out });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐⭐ THE THREE-WAY MATCH (2026-09-08 — the spec's phase 5, and the sentence the product is sold on).
 *
 *   GET /api/till/match?days=90   every purchase order with what was ORDERED, what was RECEIVED and what was INVOICED, side by side
 *
 * PO ↔ GRN ↔ invoice is the oldest control in purchasing, and an ERP can only run it when ONE company holds all three documents.
 * Here the order is a chit we sent, the receipt is what our own door wrote, and the invoice is either a chit they sent or the figure
 * their paper bill carried — so the match happens ACROSS PARTIES, which is the thing no ERP can do.
 *
 * ⚠️ IT NEVER RESOLVES A DIFFERENCE, IT NAMES ONE. CB takes no side: what was ordered, what was counted and what was charged are three
 * claims, and the screen shows all three with the reason the person at the door gave. Deciding between them is a dispute, which is a
 * conversation between two parties — not an arithmetic the server can do on their behalf.
 * ⚠️ THIS IS AN OWNER'S SCREEN, NOT A COUNTER'S. It lives in this file because it reads the same documents, but it is deliberately
 * OUTSIDE the till scope: a counter device may record what it witnesses and must never read what the shop pays its suppliers.
 * ⚠️ RECEIVED comes from lib/deliverline (events, never a stored total), so a part delivery, a correction, or the counterparty's own
 * claim are all already in it.
 */
router.get('/match', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    /* both directions: a purchase order for an off-platform supplier is a SELF chit and lands as 'received' */
    const heads = await select.rows(entity_id, { purpose: 'order', since, limit: 300 });
    /* what this trade absorbs — the same numbers the counter was given in its snapshot */
    const flags = await policy.get(entity_id).catch(() => ({}));
    const tol = { weight_bp: flags.tol_weight_bp == null ? 50 : Number(flags.tol_weight_bp), count_units: Number(flags.tol_count_units) || 0 };
    if (!heads.length) return res.json({ days, count: 0, orders: [] });

    const { withEntity } = require('../db');
    const out = await withEntity(entity_id, async (db) => {
      const ids = heads.map((h) => h.chit_id);
      const det = await db.query(
        `SELECT h.chit_id, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`, [entity_id, ids]);
      const byId = new Map(det.rows.map((r) => [String(r.chit_id), r]));

      /* the receipts our own counter wrote against these orders — that is where the supplier's bill figure was captured */
      const rec = await db.query(
        `SELECT h.chit_id, h.created_at, h.business_json, d.line_items
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.purpose = 'receipt'   /* ⚠️ no direction: our own receipt is a SELF chit, which lands as 'received' */
            AND h.created_at > NOW() - ($2 || ' days')::interval`, [entity_id, String(days + 30)]);
      const receiptsFor = new Map();
      for (const r of rec.rows) {
        const bj = r.business_json || {};
        const on = bj.against && bj.against.chit_id;
        const key = on ? String(on) : null;
        if (!key) continue;
        if (!receiptsFor.has(key)) receiptsFor.set(key, []);
        receiptsFor.get(key).push({ chit_id: r.chit_id, no: bj.doc_no || null, at: bj.doc_at || r.created_at,
                                    their_bill: bj.their_bill || null, goods: bj.goods == null ? null : Number(bj.goods),
                                    extras: bj.extras == null ? null : Number(bj.extras),
                                    landed: bj.landed_total == null ? null : Number(bj.landed_total),
                                    lines: Array.isArray(r.line_items) ? r.line_items : [] });
      }

      /* an invoice they SENT us, if they are on ChitBridge at all */
      const inv = await db.query(
        `SELECT h.chit_id, h.created_at, h.sender_entity_id, h.summary_json, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.direction = 'received' AND h.purpose = 'invoice'
            AND h.created_at > NOW() - ($2 || ' days')::interval`, [entity_id, String(days + 30)]);

      const orders = [];
      for (const h of heads) {
        const d = byId.get(String(h.chit_id)) || {};
        const bj = d.business_json || {};
        if (bj.bill_no) continue;                       /* a counter sale is not a purchase order */
        if (sideOf(h, bj) !== 'buy') continue;          /* the match is about what we BUY */
        const prog = await deliverline.progress(entity_id, h.chit_id, db).catch(() => null);
        const receipts = receiptsFor.get(String(h.chit_id)) || [];
        /* their invoice: a chit from this counterparty, else the figure keyed off their paper bill at the door */
        const theirChit = inv.rows.find((x) => h.counterparty_id && String(x.sender_entity_id) === String(h.counterparty_id)) || null;
        const keyed = receipts.map((r) => (r.their_bill && r.their_bill.total != null) ? Number(r.their_bill.total) : null).filter((x) => x != null);
        const invoiced_total = theirChit ? Number((theirChit.summary_json || {}).total_value || 0)
                             : (keyed.length ? keyed.reduce((x, y) => x + y, 0) : null);

        const lines = (Array.isArray(d.line_items) ? d.line_items : []).map((l) => {
          const p = (prog && prog.get) ? prog.get(l.line_id) : null;
          const ordered = Number(l.quantity) || 0;
          const received = (p && p.delivered != null) ? Number(p.delivered) : 0;
          /* the reason the person at the door gave, carried on the receipt's own line */
          let why = null;
          for (const r of receipts) for (const rl of r.lines) {
            const idm = rl.item_data || {};
            if (idm.line_id === l.line_id || rl.particulars === (l.particulars || l.name)) { if (idm.reason) why = idm.reason; }
          }
          const diff = Math.round((received - ordered) * 1000) / 1000;
          /* ⭐ THE SAME TOLERANCE THE DOOR APPLIED (lib/lotfields, one definition for both ends). A difference this trade absorbs is
             not a difference to chase — and both figures still show, because tolerance decides what is worth a conversation, never
             what is true. */
          const absorbed = diff !== 0 && lotfields.withinTolerance(diff, ordered, l.unit, tol);
          return { line_id: l.line_id, name: l.particulars || l.name || '', unit: l.unit || 'piece',
                   rate: l.price == null ? null : Number(l.price),
                   ordered, received, difference: diff, reason: why, absorbed,
                   state: diff === 0 ? (received > 0 ? 'agreed' : 'awaited') : (absorbed ? 'agreed' : (diff < 0 ? 'short' : 'excess')) };
        });
        if (!lines.length) continue;

        const value = (n) => Math.round(n * 100) / 100;
        const ordered_total = value(lines.reduce((t, l) => t + (l.ordered * (l.rate || 0)), 0));
        const received_total = value(lines.reduce((t, l) => t + (l.received * (l.rate || 0)), 0));
        const differences = lines.filter((l) => l.difference !== 0 && !l.absorbed).length;
        const nothingYet = lines.every((l) => l.received === 0);
        /**
         * ⭐ THE VERDICT IS ABOUT WHAT IS KNOWN, not about who is right.
         *   awaited   nothing has arrived yet
         *   open      some has, some has not
         *   agreed    everything arrived as ordered, and the money agrees
         *   differs   something does not agree, and the line says what
         */
        const money_gap = (invoiced_total == null) ? null : value(received_total - invoiced_total);
        const verdict = nothingYet ? 'awaited'
                      : (differences ? 'differs'
                      : (lines.some((l) => l.received < l.ordered) ? 'open'
                      : ((money_gap != null && money_gap !== 0) ? 'differs' : 'agreed')));

        orders.push({ chit_id: h.chit_id, at: h.created_at,
                      subject: h.manual_subject || h.auto_subject || '',
                      party: h.counterparty_name || (bj.party && bj.party.name) || '', party_id: h.counterparty_id || null,
                      lines, differences, verdict,
                      ordered_total, received_total, invoiced_total,
                      invoiced_from: theirChit ? 'their invoice' : (keyed.length ? 'their bill, keyed at the door' : null),
                      money_gap,
                      receipts: receipts.map((r) => ({ chit_id: r.chit_id, no: r.no, at: r.at, landed: r.landed,
                                                       their_bill_no: (r.their_bill && r.their_bill.no) || null })) });
      }
      return orders;
    });
    res.json({ days, count: out.length, orders: out });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ REMEMBER WHAT THE SUPPLIER CALLS IT (2026-09-08).
 *
 *   POST /api/till/alias   { item_id, by, text, unit?, factor? }
 *
 * Their line says "SUNFL OIL 1L RB"; ours says "Sunflower oil 1 L". Somebody pairs them ONCE at the door and the counter never asks
 * again — which is the whole difference between the first delivery from a vendor and the fortieth. The pairing carries a CONVERSION
 * too, because their carton is our twenty-four pieces, and pack size is where most "mismatches" actually come from.
 *
 * ⚠️ IT LIVES ON THE PRODUCT, not in a table of its own — "what this vendor calls it" is a fact about the product, and putting it in
 * item_data means no migration and no second place to look. Merge-patched, so nothing else in item_data is touched.
 * ⚠️ THE NARROWEST POSSIBLE WRITE. A till key cannot touch products; this endpoint can append an alias and do nothing else, which is
 * why it exists rather than widening the scope to PATCH /api/products.
 */
router.post('/alias', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const item_id = String(b.item_id || '').trim();
    const text = String(b.text || '').trim();
    const by = String(b.by || '').trim();
    if (!item_id || !text) return res.status(400).json({ error: 'an alias needs an item and the words the supplier uses' });
    if (text.length > 120 || by.length > 120) return res.status(400).json({ error: 'too long' });
    const unit = b.unit ? String(b.unit).trim().slice(0, 24) : null;
    const factor = (b.factor == null || b.factor === '') ? null : Number(b.factor);
    if (factor != null && (!Number.isFinite(factor) || factor <= 0 || factor > 100000)) return res.status(400).json({ error: 'a pack conversion is a positive number' });

    const out = await withEntity(entity_id, async (db) => {
      const r = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2', [entity_id, item_id]);
      if (!r.rows.length) return null;
      const d = r.rows[0].item_data || {};
      const list = Array.isArray(d.aliases) ? d.aliases.slice(0, 50) : [];
      const same = (a) => String(a.text || '').toLowerCase() === text.toLowerCase() && String(a.by || '').toLowerCase() === by.toLowerCase();
      const kept = list.filter((a) => !same(a));                 /* saying it again replaces what was said before */
      kept.push({ by: by || null, text, unit, factor, at: new Date().toISOString() });
      await db.query('UPDATE catalogue_items SET item_data = item_data || $3::jsonb, updated_at = NOW() WHERE entity_id = $1 AND item_id = $2',
        [entity_id, item_id, JSON.stringify({ aliases: kept })]);
      return kept;
    });
    if (!out) return res.status(404).json({ error: 'no such product' });
    res.json({ ok: true, aliases: out });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐⭐ SPEAK, AND GET WORDS BACK (2026-09-08). Athi: *"build the seam with whisper behind it, I'll test the accuracy."*
 *
 *   POST /api/till/listen   { audio: <base64>, mime, format, lang, hint }  →  { ok, text, provider, ms }
 *
 * ⚠️ THE AUDIO IS NEVER STORED. It is decoded, transcribed and dropped — not to disk, not to a table, not to a log. A recording of a
 * customer saying their phone number is not something to be holding, and the only way to be certain is not to hold it.
 * ⚠️ IT NEVER FAILS LOUDLY. Every problem comes back as ok:false with a sentence, and the counter falls back to the browser's own
 * recogniser — a microphone must never be the reason a sale stops.
 * ⚠️ AND IT IS RATE-LIMITED BY SIZE, not by a counter: two megabytes is about a minute, and a counter says three seconds at a time.
 */
router.post('/listen', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const raw = String(b.audio || '');
    if (!raw) return res.json({ ok: false, why: 'nothing was recorded' });
    let buf;
    try { buf = Buffer.from(raw, 'base64'); } catch (_) { return res.json({ ok: false, why: 'that recording could not be read' }); }
    if (buf.length > speech.MAX_BYTES) return res.json({ ok: false, why: 'that is too long — say it in one short phrase' });
    const out = await speech.transcribe(buf, { mime: b.mime, format: b.format, lang: b.lang, hint: b.hint });
    res.json(out);
  } catch (e) { res.json({ ok: false, why: String(e && e.message) }); }
});

/**
 * ⭐ THE ENGINES, SERVED (2026-09-07). A till has to price with the line down, so it keeps its own copy of the three engines — and it
 * gets them from here rather than from a second host, so there is one place that answers "which version is the counter running".
 * Cached by the till at install and refreshed with the snapshot; both files are the SAME code the server and the app run.
 */
/**
 * ⚠️ EVERY ENGINE THE PAGE LOADS MUST BE HERE. The browser gets them from /engine/*.js on the web host; a shop PC gets them ONLY
 * through this map, so an engine missing from it works in a browser and is silently absent on the desktop counter — the worst kind
 * of difference, because it only shows up on the machine nobody is testing on. `lots` was missing exactly that way (2026-09-08).
 */
const ENGINES = { offers: '../lib/offers-engine.js', tax: '../lib/tax-engine.browser.js', search: '../lib/search-engine.js',
                  gs1: '../lib/gs1.browser.js',        /* what a pack's barcode carries — batch, expiry, serial */
                  lots: '../lib/lotfields.browser.js', /* what this trade must capture, and the difference it absorbs */
                  nums: '../lib/numerals.browser.js' };/* "two kilo", "rendu kilo" — the closed class, in both */
router.get('/engine/:name', auth, (req, res) => {
  const rel = ENGINES[String(req.params.name || '')];
  if (!rel) return res.status(404).json({ error: 'Not found' });
  try {
    const p = require('path').join(__dirname, rel);
    const body = require('fs').readFileSync(p, 'utf8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.openapi = { paths: { '/api/till/snapshot': { get: { summary: 'Everything a counter needs to bill offline, in one call',
  tags: ['till'], security: [{ apiKey: [] }], responses: { 200: { description: 'the shop, its items, offers, slabs and customers' } } } } }, schemas: {} };

module.exports = router;
