// routes/catalogue.js — B3.7 Public catalogue + end-customer order (no business login)
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');   // 6b: hash the ERP handoff payload (receipt, not raw payload)
const { query, withTransaction, withEntity } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const customerAuth = require('../middleware/customer-auth');   // T2.4 — the storefront customer's OWN surface
const { verifyOtp } = require('../lib/otp');   // per-account OTP attempt cap
const { sendOtp } = require('../lib/notify');  // F2 — dual-channel OTP delivery (email via Resend, SMS pluggable)
const catalogueBuild = require('../lib/catalogue-build');   // B3.7-ref: resolve the shop's adopted REFERENCE catalogue for the storefront
const container = require('../lib/container');              // CONTAINER MODEL (b80) — freeze the container ref+version on the order chit
const regional = require('../lib/regional');                // GOVERNED CURRENCY — the network path must not invent 'INR'
const money = require('../lib/money');                      // MONEY TYPE — a price is never a bare number

// ⚠️ ONE generator (lib/bridgeid.js). This copy was the ONLY one that ever received the S4 CSPRNG hardening —
//    the fix was correct and reached one sixth of the code it was written for. That is why it now lives in one file.
const genBridge = require('../lib/bridgeid').generateBridgeId;
// Customer (storefront) OTP: fixed 123123 in dev (distinct from the entity dev OTP 123456); CSPRNG in real prod (S4).
const devOtp = require('../lib/dev-otp');   // ONE guarded place for every fixed test OTP — see lib/dev-otp.js
const genOTP = () => devOtp.fixedOtp('customer') || require('crypto').randomInt(100000, 1000000).toString();
const cleanPhone = (p) => String(p || '').replace(/[^0-9+]/g, '');

// F2 — dual-channel customer identifier: the customer gives EXACTLY ONE of phone OR email. '@' present => email
// channel, else phone. Returns { channel, raw } (raw = cleaned phone or normalised email) or { error }.
function resolveContact(body) {
  const ph = String(body.phone ?? '').trim();
  const em = String(body.email ?? '').trim();
  const id = String(body.identifier ?? '').trim();
  if (ph && em) return { error: 'Give just one — a phone OR an email, not both.' };
  const raw = id || ph || em;
  if (!raw) return { error: 'Enter a phone number or an email.' };
  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
    return { channel: 'email', raw: email };
  }
  const phone = cleanPhone(raw);
  if (phone.length < 6 || phone.length > 20) return { error: 'Enter a valid phone number.' };
  return { channel: 'phone', raw: phone };
}
// Per-entity .cr handle = the identities.email key. Email uses the FULL address (swap '@' -> '=') so
// xyz@gmail.com and xyz@yahoo.com at the SAME shop stay DISTINCT — using the local part alone would collapse
// them into one identity (cross-customer order visibility + OTP misroute). Same builder used in all 3 spots so
// a returning customer regenerates the same handle.
function crHandle(channel, raw, bridge) {
  const local = channel === 'email' ? raw.replace('@', '=') : raw;
  return `${local}@${bridge}.cr`;
}

// CJ-07 (security) — PRICE INTEGRITY. A no-login customer sends their own line_items incl. price; never trust it.
// Re-price every line against THIS shop's own catalogue and recompute totals server-side. Fails CLOSED: a line
// that can't be matched to an active catalogue item, or whose catalogue price isn't set, is rejected (422) — so
// no order can be placed at an arbitrary or zero price.
// ASSUMPTIONS to confirm during dev smoke (adjust here if the real shape differs):
//   (1) a customer line identifies its product by `item_id`, or by name (`particulars`/`name`);
//   (2) the unit price lives in `catalogue_items.item_data.price`.
const _norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _422  = (m) => { const e = new Error(m); e.status = 422; return e; };
// ── SPEC-negotiation-position — the shop's order method + the buyer's POSITION on a line ──────────────────────────
// A negotiation is two parties holding divergent values on ONE co-held record until one settles it — the same shape as
// a dispute, one lifecycle stage earlier. So the buyer's push-back is a generic `proposal` object, not a price column:
// it extends to quantity, delivery date, spec, incoterm without another migration.
const orderInput = require('../lib/order-input');
const catalogueView = require('../lib/catalogue-view');   // ONE catalogue read, shared with the B2B/supplier view
const mint = require('../lib/mint');   // ⚠️ the SHAPE of a chit — one place, four call sites
const MAX_FORMS_PER_SUBMISSION = 5;   // one purpose, several forms (an export bundle, a loan pack) — but bounded
// The catalogue DECLARES what it receives (lib/order-input.js). Read server-side from the face (b112) and never from
// the request, so a customer cannot claim a shop is negotiable — or priceless — when it is not.
const getOrderInput = (entity_id) => catalogueView.getOrderInput({ entity_id, withEntity, orderInput });
// Validate the buyer's proposal. NOTHING here feeds price/total — CJ-07 price integrity is untouched: the line price
// and total stay server-authoritative. This only decides whether a NON-authoritative position is admissible.
// It is strictly a NEW restriction (a fixed-price shop now REJECTS an offer that it previously ignored).
// A store may offer SEVERAL templates, and each asks for different things — the customer must be shown the fields of
// the template THEY picked, not one catalogue-wide set. So an item may carry its own `order_input`, merge-patched over
// the catalogue's (opt-in: no item declaration → the catalogue governs). Resolved SERVER-SIDE at submit, so what gets
// validated is what the ITEM declares, never what the client claims it declares.
async function itemDeclFor(entity_id, itemName, cache) {
  if (!itemName) return null;
  try {
    // T3.5 · memoise per REQUEST. This ran catalogueBuild.resolve for every visible adoption, once per line item —
    // up to 5 forms × N adoptions per confirm, on top of the identical loop in repriceAgainstCatalogue. The cache is
    // passed in by the caller so it lives exactly one request and cannot leak between tenants.
    const c = cache || {};
    if (!c._decls) {
      const ado = await withEntity(entity_id, (db) => db.query(
        // T3.6 · ORDER BY makes resolution DETERMINISTIC. Without it the same submission could validate against a
        // different schema on different requests, at the database's discretion.
        `SELECT source_key, commercials FROM catalogue_adoption
          WHERE entity_id = $1 AND visible = true ORDER BY source_key`, [entity_id]));
      const decls = new Map();          // normalised name → [{source_key, order_input}]
      for (const row of ado.rows) {
        const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {});
        for (const it of ((resolved && resolved.items) || [])) {
          const k = _norm(it.name);
          if (!decls.has(k)) decls.set(k, []);
          decls.get(k).push({ source_key: row.source_key, order_input: it.order_input || null });
        }
      }
      c._decls = decls;
    }
    const hits = c._decls.get(_norm(itemName)) || [];
    // T3.6 · reject AMBIGUITY rather than silently picking one. The commerce path already refuses when a name exists
    // under two brands ("available from more than one brand"); the payload path used to take whichever came first.
    const distinct = hits.filter((h) => h.order_input).map((h) => h.source_key);
    if (distinct.length > 1) {
      const err = new Error(`"${itemName}" is offered by more than one source (${distinct.join(', ')}) — choose the source`);
      err.status = 422;
      throw err;
    }
    if (hits.length) return hits[0].order_input || null;
  } catch (e) {
    if (e && e.status === 422) throw e;      // ambiguity is the caller's problem to fix, not a retry
    // T1.3 — FAIL CLOSED. This used to swallow the error and return null, so a transient DB fault meant the item's
    // stricter schema (and its REQUIRED document rule) silently did not apply, and the looser submission was sealed
    // onto a chit indistinguishable from a correctly-validated one. A retryable error is far better than that.
    const err = new Error('Could not resolve the template for "' + itemName + '" — please retry');
    err.status = 503;
    throw err;
  }
  // No adoption matched the name: there is no item declaration, so the CATALOGUE's contract governs. That is the
  // designed opt-in path, not a failure.
  return null;
}

// Validate the buyer's offer AGAINST THE DECLARED SCHEMA, bounded by the seller's own band/options.
// NOTHING here feeds price/total — CJ-07 price integrity is untouched: the line price and total stay
// server-authoritative. This only decides whether a NON-authoritative position is admissible.
function validateProposal(raw, oi, sellerBand, label) {
  if (raw == null) return null;
  if (!oi.negotiable) throw _422(`This shop does not take offers — "${label}" is sold at the listed price`);
  // the seller's band/options bound the buyer (source-governed: the seller sets the bounds, not the host)
  const schema = orderInput.withBounds(oi.schema, 'price', sellerBand);
  const priceOnly = { type: 'object', properties: { price: (schema.properties || {}).price || {} }, required: ['price'] };
  const r = orderInput.validate({ price: raw.price != null ? raw.price : raw.min }, priceOnly);
  if (!r.ok) throw _422(`Offer for "${label}": ${r.errors.join('; ')}`);
  const out = { price: r.value.price };
  if (raw.max != null) {                                   // buyer proposing a BAND rather than a number
    const m = orderInput.validate({ price: raw.max }, priceOnly);
    if (!m.ok) throw _422(`Offer for "${label}": ${m.errors.join('; ')}`);
    out.min = out.price; out.max = m.value.price; delete out.price;
    if (out.min > out.max) throw _422(`Offer range for "${label}" is inverted`);
  }
  if (raw.note != null) out.note = String(raw.note).slice(0, 500);
  return out;
}
async function repriceAgainstCatalogue(entity_id, rawItems, oi) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw _422('Order is empty');
  if (rawItems.length > 200) throw _422('Too many line items — max 200 per order');   // F6: bound the line count
  // B1 RLS: prices come from the shop's PUBLIC catalogue (public order flow) -> withEntity(null) = no tenant
  // context, so the visibility-aware policy returns only public items (a private shop can't be ordered from here).
  const cat = await withEntity(null, (db) => db.query(
    `SELECT item_id, item_data, updated_at FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id]));
  const byId = new Map(), byName = new Map(), nameCount = new Map();   // F6: nameCount flags ambiguous names
  for (const row of cat.rows) {
    const d = row.item_data || {};
    // null/undefined/'' price = NOT SET -> NaN (rejected below). A deliberate 0 stays a valid price.
    // TOLERANT READ: accepts a legacy bare number AND a stamped { amount, currency }, so rows migrated by
    // scripts/money-3-apply.sql and rows not yet migrated both work. This must stay tolerant until every price
    // home is stamped — deleting the number branch early is what turns a product into a free one.
    const price = money.amountOfLoose(d.price);
    /* `sku` carried so a storefront line can state the PUBLISHED identifier, not only our internal uuid — it is the
       half of the reference a counterparty may legitimately hold, because they read it before they ordered.
       ⚠️ `code` is not read here: the starter set labels it "Code / HSN", so it may be a customs classification
       rather than an identifier, and stamping one as the other would look exactly right. */
    const rec = { item_id: row.item_id, name: d.name ?? d.particulars ?? '', price, unit: d.unit ?? null,
                  sku: String(d.sku || d.gtin || '').trim() || null,
                  as_of: row.updated_at ? new Date(row.updated_at).toISOString() : null,
                  /* the same stamp the capture path takes, from the same function — one definition of "what it was" */
                  hash: require('../lib/itemmatch').stampOf({ name: d.name, variant: d.variant || d.grade, unit: d.unit, price: d.price, sku: String(d.sku || d.gtin || '').trim() || null, status: require('../lib/itemstatus').statusOf(d) }) };
    byId.set(String(row.item_id), rec);
    if (rec.name) { const k = _norm(rec.name); nameCount.set(k, (nameCount.get(k) || 0) + 1); byName.set(k, rec); }
  }
  // Finish map (reference catalogue) — resolve the shop's VISIBLE adoptions → norm(name) -> {price, combos, source}.
  // Priced from the adoption commercials, SERVER-side (never the customer). Empty if the shop has no finishes.
  const finishMap = new Map();       // STONE 3: keyed 'source|name' so same-named finishes from DIFFERENT brands don't collide
  const finishByName = new Map();     // name -> { count, rec } — for name-only lines (reject if ambiguous across brands)
  try {
    const ado = await withEntity(entity_id, (db) => db.query(
      `SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true`, [entity_id]));
    for (const row of ado.rows) {
      const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {});
      if (!resolved) continue;
      // STONE 2: the SOURCE's governance resolves HERE — an item runs under its source's rules, not the host's.
      const rules  = (resolved.experience && resolved.experience.rules) || {};
      const sVer   = (resolved.adoption_model && resolved.adoption_model.version) || 'v1';
      const sOwner = resolved.owner_entity_id || null;
      for (const it of (resolved.items || [])) {
        // Commercials are GENERIC {price, unit}; price_per_litre is the pre-generic paint shape. ADDITIVE — both are
        // accepted so a non-paint (kg/count) adoption prices correctly and existing paint adoptions are untouched.
        const _c = it.commercials || {};
        const _raw = (_c.price != null && _c.price !== '') ? _c.price : _c.price_per_litre;
        // ⚠️ THE SAME BUG AS LINE ~373, WHICH WAS FIXED AND THIS ONE WAS NOT.
        //
        // `catalogue-adopt` stamps commercials, so an adoption's price is `{amount, currency}`. `Number({…})` is
        // NaN, and NaN reaches the guard below as "price is not set" — so EVERY adopted catalogue became
        // unorderable the moment stamping landed. Confirmed live on both Alpha and Beta: both hold stamped
        // commercials, and a finish order on either was refused with "Price for X is not set".
        //
        // Nothing caught it. The unit tests do not order a finish, and the regression covers chits rather than the
        // storefront's blueprint path. It surfaced on the FIRST run of prove-one-roof.js, which walks a brand and a
        // shop through the whole flow — the argument for a proof that uses the product rather than its parts.
        //
        // ⚠️ NOTE FOR THE ENGINE-LOCK RULE: this makes a refusal STOP firing, which is normally a relaxation and
        // would need flagging before it is applied. It is not one. Price integrity is untouched — the price still
        // comes from the shop's own catalogue and never from the customer — and `amountOfLoose` returns NaN for
        // anything genuinely unreadable, so the guard below still refuses a priceless line exactly as before. What
        // changes is that a CORRECTLY PRICED line stops being refused.
        const p = (_raw != null && _raw !== '') ? money.amountOfLoose(_raw) : NaN;
        // the item's OWN unit (kg/count/litre) — was hardcoded 'litre' on the order line, so a kg item's chit recorded litres.
        const unit = _c.unit || it.unit || 'unit';
        // the SELLER's declared band (SPEC-negotiation-position §2) — bounds a buyer's offer; absent → unbounded.
        const band = (_c.price_min != null || _c.price_max != null) ? { min: _c.price_min, max: _c.price_max } : null;
        const rec = { name: it.name, price: p, unit, band, source: row.source_key, sVer, sOwner, rules, combos: new Set((it.combinations || []).map((c) => _norm(c.name))) };
        const nk = _norm(it.name);
        finishMap.set(row.source_key + '|' + nk, rec);
        const nb = finishByName.get(nk) || { count: 0, rec: null };
        finishByName.set(nk, { count: nb.count + 1, rec });
      }
    }
  } catch (_) { /* no reference catalogue for this shop */ }
  const MAX_QTY = 100000;
  const items = await Promise.all(rawItems.map(async (li, idx) => {
    // FINISH line (reference catalogue) — priced from the adoption commercials, server-authoritative (never the customer).
    if (li.kind === 'finish' || li.finish || (li.source && finishMap.size)) {
      const fname = li.finish ?? li.name ?? li.particulars;
      const nk = _norm(fname);
      const lsrc = (li.source != null) ? String(li.source).trim() : null;
      // STONE 3: resolve to the RIGHT brand. With a source on the line, exact (source|name); without, only if the name
      // is unambiguous across the brands this distributor carries (else make them choose the brand).
      let fref = lsrc ? finishMap.get(lsrc + '|' + nk) : null;
      if (!fref && !lsrc) {
        const nb = finishByName.get(nk);
        if (nb && nb.count > 1) throw _422(`"${fname}" is available from more than one brand — choose the brand to order it`);
        fref = nb ? nb.rec : null;
      }
      if (!fref) throw _422(`"${fname || ('item ' + (idx + 1))}" is not an available finish in this shop`);
      if (!Number.isFinite(fref.price)) throw _422(`Price for "${fref.name}" is not set — order cannot be placed`);
      // T2.5 · `combination` used to be stored RAW: when the resolved item declared no combinations the guard was
      // skipped entirely, so an arbitrary nested object of any size rode onto BOTH chit copies — flatly contradicting
      // "an undeclared field is rejected, never carried", which holds on the payload path but did not here.
      const comboRaw = li.combination ?? li.combo ?? null;
      if (comboRaw !== null && typeof comboRaw === 'object') throw _422(`"${fref.name}": a colour combination must be a name, not an object`);
      const combo = comboRaw === null || comboRaw === '' ? null : String(comboRaw).slice(0, 120);
      if (combo && !fref.combos.size) throw _422(`"${fref.name}" has no colour combinations to choose from`);
      if (combo && !fref.combos.has(_norm(combo))) throw _422(`"${combo}" is not a colour combination of "${fref.name}"`);
      const fq = Number(li.quantity ?? li.qty);
      if (!Number.isFinite(fq) || fq <= 0 || fq > MAX_QTY) throw _422(`Invalid quantity for "${fref.name}"`);
      // STONE 2: ENFORCE the source's rules (governance from the source). Min order is the source's, not the host's.
      const rules = fref.rules || {};
      const minL = Number(rules.min_order_litres);
      if (Number.isFinite(minL) && minL > 0 && fq < minL) throw _422(`"${fref.name}" has a minimum order of ${minL} litres (set by ${fref.source}).`);
      // WIRING (stone 5): FREEZE the container ref + version (the immutable snapshot the customer saw → chit verifiable forever).
      let containerFreeze = null;
      try { const cid = container.itemContainerId(fref.source, fref.name); const cc = await container.getContainer(cid); if (cc) containerFreeze = { ref: cid, content_version: cc.current_version }; } catch (_) {}
      // The buyer's POSITION. Deliberately computed AFTER price/total below: the seller's price comes from the
      // catalogue and is authoritative; the buyer's price travels ON THE CHIT and never touches money.
      const proposal = validateProposal(li.proposal, oi, fref.band, fref.name);
      return { kind: 'finish', source: fref.source, source_version: fref.sVer, finish: fref.name, combination: combo || null,
        particulars: fref.name + (combo ? (' · ' + combo) : ''), name: fref.name, unit: fref.unit || 'unit', quantity: fq,
        price: fref.price, total: Math.round(fref.price * fq * 100) / 100,
        ...(fref.band ? { seller_band: fref.band } : {}),
        ...(proposal ? { proposal } : {}),
        // The order line carries the source's governance + the FROZEN container (verifiable). Routing = INFO for the ERP.
        governed: { under: fref.source, owner_entity_id: fref.sOwner, container: containerFreeze, routing: rules.order_routing || null, min_order_litres: Number.isFinite(minL) ? minL : null } };
    }
    const name = li.particulars ?? li.name ?? (li.item_data && li.item_data.name);
    // F6: prefer an item_id match; fall back to name, but REJECT an ambiguous name (>1 active item shares it)
    // instead of silently pricing against the wrong variant.
    let ref = (li.item_id != null) ? byId.get(String(li.item_id)) : null;
    if (!ref) {
      const k = _norm(name);
      if ((nameCount.get(k) || 0) > 1) throw _422(`"${name}" matches more than one product — select the item to order it`);
      ref = byName.get(k);
    }
    if (!ref) throw _422(`"${name || ('item ' + (idx + 1))}" is not available in this shop's catalogue`);
    if (!Number.isFinite(ref.price)) throw _422(`Price for "${ref.name}" is not set — order cannot be placed`);
    const qty = Number(li.quantity ?? li.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) throw _422(`Invalid quantity for "${ref.name}"`);
    const total = Math.round(ref.price * qty * 100) / 100;
    // T3.3 · the OFFER GUARD applies here too. validateProposal was called only on the finish/reference branch, so
    // the ordinary product path silently DROPPED `li.proposal` — meaning the documented restriction ("a fixed-price
    // shop now rejects an offer") was false for most shops. A plain product has no seller band, so an offer here is
    // unbounded but still only admissible when the shop declared itself negotiable.
    const proposal = validateProposal(li.proposal, oi, null, ref.name);
    /**
     * ⭐ THE SAME REFERENCE SHAPE THE CAPTURE PATH NOW STAMPS. This line already carried a bare `item_id`, which is
     * kept — other readers use it — but one fact stored two ways is how the two paths drift apart, and a chit that
     * says `item_id` when it came from a storefront and `ref.item_id` when it came from WhatsApp cannot be queried
     * as one thing.
     *
     * ⚠️ `how: 'picked'` IS THE STRONGEST RUNG ON THE LADDER, and it is the only place entitled to it: the buyer
     * chose this row from the shop's own catalogue. Nothing was matched, guessed or resolved — so a dispute can
     * tell it apart from a line a spelling-guess produced, which the other paths cannot claim.
     */
    return { item_id: ref.item_id, particulars: ref.name, name: ref.name, unit: ref.unit, quantity: qty,
             price: ref.price, total, ...(proposal ? { proposal } : {}),
             ref: { item_id: ref.item_id, ...(ref.sku ? { sku: ref.sku } : {}), how: 'picked',
                    ...(ref.as_of ? { as_of: ref.as_of } : {}), ...(ref.hash ? { hash: ref.hash } : {}) } };
  }));
  const total = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
  return { items, total };
}

async function resolveEntity(bridge_id) {
  const r = await query(
    `SELECT identity_id, display_name, bridge_id, currency_code, gstn, is_verified, logo_url, address, business_status
     FROM identities WHERE bridge_id = $1 AND identity_type = 'entity' AND status = 'active' AND COALESCE(sealed, false) = false`,
    [bridge_id]);
  return r.rows[0] || null;
}

// ── Network storefront (the lens): aggregate the PUBLIC catalogues of a NETWORK's nodes into ONE store, with the
//    holding node STRIPPED OUT. Products self-declare membership via item_data.network_id (migration-free); the
//    public read runs withEntity(null) so RLS returns ONLY public items — a private department is never exposed.
//    The customer SEARCHES products by category (= the line of business); they never see the internal tree,
//    department, or location. The product→node map that routes the order stays server-side, never in this response. ──
router.get('/network-store/:networkId', async (req, res) => {
  try {
    const nid = String(req.params.networkId || '').trim();
    if (!nid) return res.status(400).json({ error: 'Bad request', message: 'network id required' });
    const q = String(req.query.q || '').trim().toLowerCase();
    const cat = String(req.query.category || '').trim();
    const rows = (await withEntity(null, (db) => db.query(
      `SELECT item_id, item_data FROM catalogue_items WHERE item_data->>'network_id' = $1 AND is_active = true`, [nid]))).rows;
    let products = rows.map((r) => { const d = r.item_data || {};
      return { product_id: r.item_id, name: d.name || d.particulars || '(unnamed)', category: d.category || 'Other',
        // TOLERANT READ (both shapes). null stays null — "price on request" is a real state, not a zero.
        price: (Number.isFinite(money.amountOfLoose(d.price)) ? money.amountOfLoose(d.price) : null),
        unit: d.unit || null, image: d.image || null }; });
    if (cat) products = products.filter((p) => p.category.toLowerCase() === cat.toLowerCase());
    if (q) products = products.filter((p) => (p.name + ' ' + p.category).toLowerCase().indexOf(q) >= 0);
    const categories = [...new Set(products.map((p) => p.category))].sort();
    res.json({ network_id: nid, categories, count: products.length, products });   // NO node/entity attribution — the internal structure stays hidden
  } catch (err) {
    res.status(500).json({ error: 'Storefront failed', message: (err && err.message) || 'error' });
  }
});

// Mint a co-held 2-party chit (sender→receiver) server-side, carrying a trace edge — modelled on emitSignalChit.
// Used to create the ORDER chit and each fulfilment FRAGMENT without a user token (the network acting as itself).
async function deliverEdge({ sender, receiver, chit_id, subject, trace, business, status, currency, total_value }) {
  const all_recipients = [
    { entity_id: sender.id, bridge_id: sender.bridge_id, display_name: sender.display_name, role: 'sender' },
    { entity_id: receiver.id, bridge_id: receiver.bridge_id, display_name: receiver.display_name, role: 'receiver' },
  ];
  // CURRENCY comes from the GOVERNANCE LAYER, resolved once by the caller and passed in — never invented here and
  // never read from the request. Both copies of a co-held chit MUST carry the same code: two parties disagreeing on
  // the denomination of the same order is exactly the dispute the rail exists to prevent.
  const currency_code = String(currency || regional.FALLBACK_CURRENCY).toUpperCase();
  // TOTAL_VALUE was hard-coded 0 here, so every network order and fulfilment fragment claimed to be worth nothing
  // while carrying real line items — and lib/kyb.js sums this column as trade value. A currency with no value is
  // meaningless; state both or state neither. null means "not applicable", which 0 never did.
  const value = (total_value === null || total_value === undefined || !Number.isFinite(Number(total_value)))
    ? null : money.round2(Number(total_value));
  /* ⚠️ SHAPE from lib/mint.js; the POLICY above (governance-resolved currency, null-not-zero total) stays here.
     deliverEdge is the NETWORK path (order chit + fulfilment fragments), not the storefront. It is always an
     'order' — there is no negotiation here — and `purpose` is not in scope. A blanket rename briefly made this a
     ReferenceError; the test that counts these caught it. */
  const summary_json = mint.summary({ line_item_count: 0, total_value: value, currency_code, purpose: 'order', trace });
  const headerCommon = mint.header({ sender_entity_id: sender.id, sender_entity_bridge_id: sender.bridge_id,
    sender_entity_display_name: sender.display_name, all_recipients, purpose: 'order',
    auto_subject: subject, manual_subject: subject, summary_json, created_by_actor_id: sender.id });
  const copies = [
    mint.party(headerCommon, { entity_id: sender.id, direction: 'sent', role: 'Act', current_status: 'delivered', business_json: business,
      log: { action: 'created', action_by_identity_id: sender.id, action_by_display_name: sender.display_name, new_status: 'delivered', detail: subject } }),
    mint.party(headerCommon, { entity_id: receiver.id, direction: 'received', role: 'Act', current_status: status || 'pending', business_json: business,
      log: { action: 'delivered', action_by_identity_id: sender.id, action_by_display_name: sender.display_name, new_status: status || 'pending', detail: subject } }),
  ];
  await mint.deliver(sender.id, chit_id, copies);
}

// ── Network order (finish the loop): a customer completes an order → ONE order chit to the network operator (the
//    common ORDER_ID the customer sees), then SILENT per-store fragments (operator → each fulfilling store,
//    parents:[ORDER_ID]). The customer co-holds only the order, so the fragments/stores are invisible to them; the
//    operator co-holds all and can walk ORDER_ID forward to see them converge. Dev-gated (server acts as the
//    network); routed purely from public catalogue data (item→store = entity_id, item→operator = item_data.operator). ──
router.post('/network-store/:networkId/order', async (req, res) => {
  try {
    const isDev = !!(process.env.DEV_OTP || '').trim() || String(process.env.NODE_ENV || '').toLowerCase() === 'development';
    if (!isDev) return res.status(403).json({ error: 'Disabled', message: 'Network order routing is dev-only for now.' });
    const nid = String(req.params.networkId || '').trim();
    const cart = Array.isArray(req.body.items) ? req.body.items : [];
    const cust = req.body.customer || {};
    if (!nid || !cart.length) return res.status(400).json({ error: 'Bad request', message: 'network id + items required' });
    const ids = cart.map((c) => c.product_id).filter(Boolean);
    const rows = (await withEntity(null, (db) => db.query(
      `SELECT item_id, entity_id, item_data FROM catalogue_items WHERE item_id = ANY($1::uuid[]) AND item_data->>'network_id' = $2 AND is_active = true`, [ids, nid]))).rows;
    if (!rows.length) return res.status(404).json({ error: 'Not found', message: 'No matching products in this network' });
    const operatorId = rows.map((r) => r.item_data && r.item_data.operator).find(Boolean);
    if (!operatorId) return res.status(409).json({ error: 'No operator', message: 'This network has no fulfilment operator set.' });
    const idset = [...new Set([operatorId, ...rows.map((r) => r.entity_id)])];
    const idents = {}; (await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [idset])).rows.forEach((r) => { idents[r.identity_id] = { id: r.identity_id, bridge_id: r.bridge_id, display_name: r.display_name }; });
    const operator = idents[operatorId]; if (!operator) return res.status(409).json({ error: 'No operator', message: 'Operator not found' });
    // resolve-or-create the customer — attaches to the NETWORK (a lightweight buyer identity)
    const cemail = String(cust.email || '').trim().toLowerCase() || ('cust-' + uuidv4().slice(0, 8) + '@shopper.cb');
    let crow = (await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE email = $1 LIMIT 1`, [cemail])).rows[0];
    if (!crow) { const cid = uuidv4(), cb = genBridge();
      await query(`INSERT INTO identities (identity_id, bridge_id, display_name, email, identity_type, status) VALUES ($1,$2,$3,$4,'entity','active')`, [cid, cb, String(cust.name || 'Customer').slice(0, 80), cemail]);
      crow = { identity_id: cid, bridge_id: cb, display_name: String(cust.name || 'Customer') }; }
    const customer = { id: crow.identity_id, bridge_id: crow.bridge_id, display_name: crow.display_name };
    const items = rows.map((r) => { const c = cart.find((x) => x.product_id === r.item_id) || {}; const d = r.item_data || {};
      // `Number(d.price || 0)` read a stamped price as NaN and an absent one as a FREE item. Both now fail loudly.
      const amt = money.amountOfLoose(d.price);
      if (!Number.isFinite(amt)) { const e = new Error(`"${d.name || 'item'}" has no usable price — order cannot be placed`); e.status = 422; throw e; }
      return { item_id: r.item_id, store: r.entity_id, name: d.name || 'item', price: amt, qty: Number(c.qty || 1), category: d.category || '' }; });
    // ⚠ CROSS-ENTITY TOTAL. These items come from SEVERAL stores in one network, and a network can span countries —
    // so unlike every other total in this file the denomination is NOT a constant here. Before the money type this
    // line added INR to AED without complaint and produced a confident wrong number. It now refuses.
    //
    // Stores whose price is still an unstamped bare number contribute no currency, so a wholly unmigrated network
    // totals exactly as it did before. Once ANY store is stamped, a genuine mismatch surfaces as a 409 rather than
    // a plausible figure — which is the entire reason for doing this.
    const perStore = rows.map((r) => (r.item_data || {}).price).filter((p) => money.isMoney(p));
    if (perStore.length) money.sum(perStore);   // throws 409 naming both currencies
    const total = money.round2(items.reduce((s, i) => s + i.price * i.qty, 0));
    // The OPERATOR governs this network, so its governed currency denominates the order and every fragment beneath
    // it. Resolved ONCE here: the order and its fragments are one transaction and must not drift apart.
    const currency = await regional.currencyFor(operatorId);
    // 1) the ORDER chit (customer → operator) — the common id the customer sees
    const ORDER_ID = uuidv4();
    await deliverEdge({ sender: customer, receiver: operator, chit_id: ORDER_ID, currency, total_value: total,
      // Currency CODE, not a symbol. '₹' was hard-coded here and is unrenderable for any other currency; a code is
      // unambiguous in every locale and leaves symbol choice to the UI, where presentation belongs.
      subject: 'Order — ' + items.length + ' item(s), ' + currency + ' ' + total,
      trace: { is_origin: true, product: 'ORDER', qty: items.length, unit: 'items', network: { id: nid, operator: operatorId }, order: true },
      business: { kind: 'network_order', order_id: ORDER_ID, network_id: nid, items: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, category: i.category })), total, at: new Date().toISOString() },
      status: 'pending' });
    // 2) SILENT per-store fragments (operator → store), each parents:[ORDER_ID]
    const byStore = {}; items.forEach((i) => { (byStore[i.store] = byStore[i.store] || []).push(i); });
    const fragments = [];
    for (const storeId of Object.keys(byStore)) {
      const store = idents[storeId]; if (!store) continue;
      const sitems = byStore[storeId];
      const FRAG_ID = uuidv4();
      // A fragment carries THIS store's subtotal, not the order's. Stamping the whole total on each fragment would
      // multiply the network's apparent trade value by the number of stores the moment anyone sums the column.
      await deliverEdge({ sender: operator, receiver: store, chit_id: FRAG_ID, currency,
        total_value: money.round2(sitems.reduce((s, i) => s + i.price * i.qty, 0)),
        subject: 'Fulfil order ' + ORDER_ID.slice(0, 8) + ' — ' + sitems.length + ' item(s)',
        trace: { parents: [ORDER_ID], product: 'FULFIL', qty: sitems.length, unit: 'items', network: { id: nid, operator: operatorId } },
        business: { kind: 'order_fragment', order_id: ORDER_ID, network_id: nid, items: sitems.map((i) => ({ name: i.name, qty: i.qty })), at: new Date().toISOString() },
        status: 'pending' });
      fragments.push(FRAG_ID);
    }
    res.json({ ok: true, order_id: ORDER_ID, item_count: items.length, total, currency, fragment_count: fragments.length });   // customer sees only the order — no stores
  } catch (err) {
    res.status(500).json({ error: 'Order failed', message: safeErr(err) });
  }
});


/**
 * GET /api/catalogue/network/:bridge_id — the NETWORK STOREFRONT.
 *
 * Athi: *"when the storefront is calling, it will call the NETWORK, not the individual stores under the network,
 * so the catalogue of all the entities should be visible where the entity is public."*
 *
 * PUBLIC and unauthenticated, like a shop link. It resolves the network root, finds its members on the tree, and
 * runs each one through the SAME buildPublicView the individual storefront uses — so a private or network-only
 * department is simply absent, decided in one place. No visibility rule lives in this route or in network-view.js.
 *
 * ⚠️ COST: one query for the members, then one buildPublicView PER member. That is O(departments), not O(items),
 * and it is the honest floor -- each department has its own catalogue, adoptions and face, and there is no single
 * query that answers for all of them. Capped at MAX_DEPARTMENTS so a deep tree cannot turn one page load into a
 * hundred reads; the cap is REPORTED, never silent.
 */
const MAX_DEPARTMENTS = 40;

router.get('/network/:bridge_id', async (req, res) => {
  try {
    const root = await resolveEntity(req.params.bridge_id);
    if (!root) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });

    // The members: everything under this root on the cb_entity tree. One query whatever the depth.
    let members = [];
    try {
      const r = await query(
        `SELECT e.bridge_id FROM cb_entity e
          WHERE e.path <@ (SELECT path FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
          ORDER BY nlevel(e.path), e.name`, [root.bridge_id]);
      members = r.rows.map((x) => x.bridge_id);
    } catch (_) { members = []; }   // no tree → not a network

    if (!members.length) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    const truncated = members.length > MAX_DEPARTMENTS;
    const use = members.slice(0, MAX_DEPARTMENTS);

    const departments = [];
    for (const bid of use) {
      if (String(bid) === String(root.bridge_id)) continue;      // the root is the front, not a department
      const ent = await resolveEntity(bid);
      if (!ent) continue;
      const view = await catalogueView.buildPublicView({ entity: ent, query, withEntity, catalogueBuild, orderInput,
        identity: require('../lib/identity'), catalogueRead: require('../lib/catalogue-read'),
        container: require('../lib/container'), visibilityCap: require('../lib/visibility-cap') });
      departments.push({ entity: ent, view });
    }

    const nv = require('../lib/network-view');
    let shopfront = nv.assemble({
      network: { bridge_id: root.bridge_id, display_name: root.display_name },
      departments,
    });
    if (req.query.q) shopfront = nv.search(shopfront, req.query.q);
    if (truncated) shopfront.truncated = { shown: use.length, total: members.length };

    // A network with no PUBLIC department is indistinguishable from no network at all — same rule as a shop.
    if (!shopfront.departments.length && !req.query.q) {
      return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    }
    res.json(shopfront);
  } catch (err) { res.status(500).json({ error: 'Network storefront failed', message: safeErr(err) }); }
});
// ── CJ-02: public catalogue (only when visibility='public') ──
router.get('/:bridge_id', async (req, res) => {
  try {
    const entity = await resolveEntity(req.params.bridge_id);
    if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    // ONE catalogue read, shared with the B2B/supplier view (lib/catalogue-view.js). The payload is unchanged.
    const view = await catalogueView.buildPublicView({ entity, query, withEntity, catalogueBuild, orderInput, identity: require('../lib/identity'), catalogueRead: require('../lib/catalogue-read'), container: require('../lib/container'), visibilityCap: require('../lib/visibility-cap') });
    // ⚠️ A PRIVATE SHOP MUST BE INDISTINGUISHABLE FROM ONE THAT DOES NOT EXIST.
    //
    // Athi, 2026-08-06: *"make the entity private and try to open the store using the storefront — it should say
    // that such entity does not exist."*
    //
    // He was right, and this line was the leak. `Not available · This shop has no public catalogue` versus
    // `Not found · Shop not found` is an EXISTENCE ORACLE: walk the bridge-id space, and the two messages tell you
    // which ids are real businesses — including every private one. The id is short and guessable enough that this
    // is a real enumeration, not a theoretical one.
    //
    // catalogue-view.js already got this right and says so in its own header — "identical shape to 'this owner has
    // published nothing'" — and returns {available:false} either way. The library did its job; this line undid it
    // one step later, which is where these things usually go wrong.
    //
    // Both cases now answer with the SAME status and the SAME body. A private catalogue costs nothing and reveals
    // nothing, including whether it is there at all.
    if (!view.available) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    res.json({ shop: view.shop, schema: view.schema, fields: view.fields, items: view.items,
      groups: view.groups, lines: view.lines, catalogue_summary: view.catalogue_summary,
      unpriced_hidden: view.unpriced_hidden,
      finishes: view.finishes });
  } catch (err) { console.error('catalogue get:', err.message); res.status(500).json({ error: 'Catalogue failed', message: safeErr(err) }); }
});

// GET /api/catalogue/:bridge_id/capture-fields — what the storefront must ASK the customer for (increment 3): the
// chit-scope required items from THIS shop's assimilated standards. The order form renders these; order/confirm captures
// them → conformance passes. Public (the customer isn't logged in).
router.get('/:bridge_id/capture-fields', async (req, res) => {
  try {
    const entity = await resolveEntity(req.params.bridge_id);
    if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    const fields = await require('../lib/conformance').captureFieldsForEntity(entity.identity_id);
    res.json({ shop: entity.display_name, fields });
  } catch (err) { res.status(500).json({ error: 'Capture fields failed', message: safeErr(err) }); }
});

// ── CJ-05a: order-first — enter phone → create/find end_customer scoped to entity → OTP ──
router.post('/:bridge_id/order/start',
  validate,   // identifier (phone|email) validated in-handler via resolveContact
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      if (entity.business_status === 'closed')
        return res.status(403).json({ error: 'Shop closed', message: 'This shop is currently closed and not accepting orders.' });
      const c = resolveContact(req.body);
      if (c.error) return res.status(422).json({ error: 'Bad request', message: c.error });
      const { channel, raw } = c;
      const name   = sanitise(req.body.name || '') || raw;
      const handle = crHandle(channel, raw, entity.bridge_id);    // per-entity .cr key (full-email = collision-free)

      let existing = await query(`SELECT identity_id, bridge_id FROM identities WHERE email = $1`, [handle]);
      let identity_id, bridge_id;
      if (existing.rows.length) {
        identity_id = existing.rows[0].identity_id; bridge_id = existing.rows[0].bridge_id;
      } else {
        identity_id = uuidv4(); bridge_id = genBridge();
        await query(
          `INSERT INTO identities
             (identity_id, bridge_id, display_name, email, phone, otp_contact, identity_type, parent_entity_id, owner_scope, auth_method, status)
           VALUES ($1,$2,$3,$4,$5,$6,'customer',$7,'entity','otp','pending')`,
          [identity_id, bridge_id, name, handle, channel === 'phone' ? raw : null, raw, entity.identity_id]);
      }
      const otp = genOTP();
      // T3.12 · re-issuing a code no longer ZEROES the attempt counter. verifyOtp caps at 5 guesses, but this reset
      // it on every /order/start — so "start → 5 guesses → start" looped indefinitely and the cap bounded nothing.
      // The counter now decays with the TTL instead: a fresh window costs a wait, not a single extra request.
      // The TTL also drops from 60 minutes to 15 — an hour-long reusable ticket has no legitimate use here.
      const OTP_TTL_MS = 15 * 60 * 1000;
      await query(
        `UPDATE identities
            SET otp_code = $1, otp_expires_at = $2, otp_contact = $3,
                otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW() THEN 0 ELSE COALESCE(otp_attempts, 0) END
          WHERE identity_id = $4`,
        [otp, new Date(Date.now() + OTP_TTL_MS), raw, identity_id]);
      // F2: deliver the OTP on the SAME channel, to the RAW contact (never the .cr handle).
      const sent = await sendOtp(channel, raw, name, otp);
      res.json({
        message: channel === 'email' ? 'Code sent to your email' : 'Code sent to your phone',
        channel,
        ...(sent.dev && { dev_otp: otp })   // dev/dormant only — NEVER returned in production
      });
    } catch (err) { console.error('order/start:', err.message); res.status(500).json({ error: 'Order start failed', message: safeErr(err) }); }
  });

// ── CJ-05b + CJ-06: verify OTP → place guaranteed chit (customer → shop) + auto-add to CRM ──
router.post('/:bridge_id/order/confirm',
  [ body('otp').trim().isLength({ min: 6, max: 6 }),
    body('line_items').isArray({ min: 1 }).withMessage('Order is empty') ],
  validate,
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      if (entity.business_status === 'closed')
        return res.status(403).json({ error: 'Shop closed', message: 'This shop is currently closed and not accepting orders.' });
      const c0 = resolveContact(req.body);
      if (c0.error) return res.status(422).json({ error: 'Verify failed', message: c0.error });
      const handle = crHandle(c0.channel, c0.raw, entity.bridge_id);

      const cr = await query(
        `SELECT identity_id, bridge_id, display_name, otp_code, otp_expires_at, otp_attempts
         FROM identities WHERE email = $1`, [handle]);
      if (!cr.rows.length) return res.status(400).json({ error: 'Verify failed', message: 'Start the order first' });
      const c = cr.rows[0];
      const otpCheck = await verifyOtp(query, c, req.body.otp);
      if (!otpCheck.ok) return res.status(otpCheck.status).json({ error: 'Verify failed', message: otpCheck.message });
      // build the guaranteed chit: customer = sender, shop = receiver
      // PRICE INTEGRITY (CJ-07): re-price every line against the shop's catalogue; reject anything that can't be
      // matched/priced. `line_items` + `total` below are now SERVER-authoritative, not customer-supplied.
      let line_items, total, pendingDocs = [];   // pendingDocs: validated+hashed bytes, stored per-copy after commit
      // The shop's OWN method decides whether a buyer offer is admissible at all — read server-side, never trusted
      // from the request, so a customer cannot claim a shop is negotiable when it is not.
      const oi = await getOrderInput(entity.identity_id);
      if (oi.pipeline === 'payload') {
        // PAYLOAD PIPELINE — the catalogue receives DATA, not a purchase (an enquiry, or a form to be filled).
        // There is no price and no quantity, so repricing is skipped entirely: on the commerce path a form would be
        // (correctly) rejected as unpriced. Same rail, same chit, same governance — only the middle step differs.
        try {
          const raw = Array.isArray(req.body.line_items) ? req.body.line_items : [];
          // A BUNDLE: one purpose often needs SEVERAL forms (an export = invoice + packing list + certificate of
          // origin; a loan = application + KYC + income proof). Each entry is still ONE form, validated against ITS
          // OWN declaration. Mixing a purchase with a form stays impossible for free — the pipeline is shop-level, so
          // every line here is a payload line by construction.
          if (!raw.length) throw _422('Nothing to submit');
          if (raw.length > MAX_FORMS_PER_SUBMISSION) throw _422(`At most ${MAX_FORMS_PER_SUBMISSION} forms in one submission`);
          line_items = [];
          // T1.6 — ONE budget for the whole submission. validateDocuments is called per form, so without a shared
          // accumulator a 5-form bundle could carry 25 files / 150 MB against a stated ceiling of 5 files / 12 MB.
          const docBudget = { count: 0, bytes: 0 };
          const declCache = {};   // T3.5 — one adoption resolve for the whole submission, not one per line
          for (let idx = 0; idx < raw.length; idx++) {
          const li = raw[idx] || {};
          const label = String(li.finish || li.name || li.particulars || 'Submission').slice(0, 200);
          // WHICH template is this entry? Its own declaration governs, so a store offering ITR-2 and a
          // Commercial Invoice validates each against ITS OWN fields — not one catalogue-wide set.
          const itemOi = orderInput.forItem(oi, await itemDeclFor(entity.identity_id, label, declCache));
          // T3.2 · forItem refuses an item declaration that would switch the pipeline; surface it rather than
          // proceeding under a contract the item did not actually get.
          if (itemOi.errors && itemOi.errors.length) throw _422(`"${label}": ${itemOi.errors.join('; ')}`);
          const v = orderInput.validate(li.payload, itemOi.schema);
          if (!v.ok) throw _422(`"${label}": ${v.errors.join('; ')}`);
          // THE LINE ITEM IS THE FILLED FORM **AND ITS PROOF**. Documents are validated and hashed BEFORE anything is
          // written; the sha256 is sealed onto the chit in the same transaction as the answers, so the record of what
          // was submitted can never be lost. The bytes are replicated per-copy afterwards (see below) — if that fails
          // the proof still stands and the blob is re-uploadable against a known hash.
          const dv = orderInput.validateDocuments(li.documents, itemOi.documents, crypto, docBudget);
          if (!dv.ok) throw _422(`"${label}": ${dv.errors.join('; ')}`);
          dv.docs.forEach((d) => pendingDocs.push({ ...d, line_index: idx }));   // the proof stays attached to ITS form
          line_items.push({ kind: 'payload', name: label, particulars: label, quantity: 1, price: 0, total: 0, payload: v.value,
                            ...(dv.docs.length ? { documents: dv.docs.map((d) => ({ name: d.name, mime: d.mime, size: d.size, sha256: d.sha256 })) } : {}) });
          }
          total = 0;
        } catch (ve) {
          // T3.7 · only a DELIBERATE validation message (one we set a status on) is safe to show. Everything else is
          // an internal error and went out verbatim on an unauthenticated endpoint, without safeErr().
          const known = ve && (ve.status === 422 || ve.status === 503);
          if (!known) console.error('order/confirm payload:', ve && ve.message);
          return res.status(known ? ve.status : 500)
                    .json({ error: 'Submission rejected', message: known ? ve.message : safeErr(ve) });
        }
      } else {
        try { ({ items: line_items, total } = await repriceAgainstCatalogue(entity.identity_id, req.body.line_items, oi)); }
        catch (ve) { return res.status(ve.status || 422).json({ error: 'Order rejected', message: ve.message }); }
      }
      // ── T2.1 · AN OFFER MUST NOT CARRY AN ORDER'S MONEY ──────────────────────────────────────────────────────
      // It used to stamp total_value = the SELLER's list price on a negotiation and label it purpose:'order'. That is
      // arithmetically defensible (CJ-07 was never breached) and semantically false: it seals a two-party record
      // asserting a figure NEITHER PARTY AGREED. And it is consumed as fact — lib/kyb.js sums total_value into
      // per-counterparty trade-history trust signals, so a buyer offering 40% of list inflated the seller's KYB
      // volume at 100%. On a rail whose USP is disputes, that is a tamper-evident lie.
      // So: an offer carries NO total_value and is labelled 'offer'. The only numbers on it are the seller's price
      // per line and the buyer's `proposal`. A settled figure appears if and when the seller accepts.
      const negotiation = line_items.some((li) => li && li.proposal);
      const purpose = negotiation ? 'offer' : 'order';
      const chit_id = uuidv4();
      const custLocality = (req.body && typeof req.body.location === 'string') ? req.body.location.trim().slice(0, 80) : '';   // STONE 4: consent-provided coarse locality
      // MONETARY OR NOT — Athi, 2026-07-31: "if the chit does not hold a currency, that means it is information or
      // helpdesk kind of activity."
      //
      // That distinction is not a new flag: it is already carried by the preset's PIPELINE. `commerce` (cart, qty,
      // range, choice, qtyprice) moves money; `payload` (enquiry, form) carries data and never had a price to state.
      // So currency presence becomes a DERIVED classification, and a summary can tell the three states apart:
      //
      //   currency + value   a monetary claim both parties hold
      //   currency + null    monetary, not yet agreed — an offer under negotiation
      //   NO currency        not about money at all — a help desk ticket, an enquiry, a filled form
      //
      // Before this, a help-desk chit was stamped 'INR' with total_value 0, so lib/kyb.js counted every support
      // ticket as a zero-value TRADE and diluted the concentration ratio it exists to compute.
      const monetary = oi.pipeline === 'commerce';
      const summary_json = { line_item_count: line_items.length,
                             total_value: (!monetary || negotiation) ? null : Math.round(total * 100) / 100,
                             currency_code: monetary ? (entity.currency_code || 'INR') : null, purpose, is_promotion: false,
                             customer_locality: custLocality || null,
                             order_preset: oi.preset, pipeline: oi.pipeline,
                             ...(negotiation ? { negotiation: true, indicative_total: Math.round(total * 100) / 100 } : {}) };
      // Assimilate the governance SEAM + advisory conformance onto the storefront chit — parity with /chits/send, so a
      // STOREFRONT order carries the same full stamp (constitution · capability · work-pattern · N standards) as any
      // other chit, PLUS a runtime conformance verdict. Governed by the SHOP (the selling entity). Best-effort: never
      // blocks the order. (This is IN ADDITION to the per-line source governance already carried on each line_item.)
      try {
        const cfg = await require('../lib/workpattern').resolveWorkPattern('send-chit', { entity_id: entity.identity_id });
        if (cfg) summary_json.governed = { pattern: cfg._blueprint, capability: cfg._capability,
          constitution: cfg._constitution, standard: cfg._standard, standards: cfg._standards, boilerplate: cfg._boilerplate };
      } catch (_) { /* seam is best-effort */ }
      // CAPTURE (increment 3): the storefront GATHERS the standard's required fields from the customer (hs_code,
      // incoterms, …) and sends them as `captured`. They're stored on the chit and fed into conformance → it now
      // PASSES instead of flagging. (Fields the standard requires but the form didn't gather still show as gaps.)
      // ── T2.3 · `captured` was an unbounded, unvalidated object from the customer ───────────────────────────────
      // It was spread over summary_json INTO the conformance input, and `hasItem()` only checks presence — so
      // {"captured":{"hs_code":"x","incoterms":"x"}} flipped the verdict to PASS and that verdict was sealed onto
      // both copies. It also overrode authoritative keys in the checker's view, and had no key allow-list and no size
      // cap, so an 8 MB blob landed in chit_header.summary_json twice. It sat three functions from a closed schema
      // that rejects every undeclared field.
      // Now: only the fields THIS SHOP's standards actually ask for are accepted, each a short scalar, and they can
      // never shadow an authoritative key.
      let captured = {};
      try {
        const allowed = await require('../lib/conformance').captureFieldsForEntity(entity.identity_id);
        // captureFieldsForEntity returns [{field, standard, facet, title}] — the key is `field`. Getting this wrong
        // yields an EMPTY allow-list, which silently drops every captured field rather than failing loudly.
        const allow = new Set((allowed || []).map((f) => (typeof f === 'string' ? f : (f && (f.field || f.key)))).filter(Boolean));
        const raw = (req.body && typeof req.body.captured === 'object' && !Array.isArray(req.body.captured)) ? req.body.captured : {};
        for (const k of Object.keys(raw)) {
          if (!allow.has(k)) continue;                                        // not asked for → not carried
          const v = raw[k];
          if (v === null || typeof v === 'object') continue;                  // scalars only
          captured[k] = String(v).slice(0, 200);
        }
      } catch (_) { captured = {}; }                                          // cannot resolve what is asked for → carry nothing
      if (Object.keys(captured).length) summary_json.captured = captured;
      try {
        // captured goes in UNDER its own key, never spread over the authoritative summary — a customer must not be
        // able to decide what the checker sees for total_value or line_item_count.
        const v = await require('../lib/conformance').checkConformance({ ...summary_json, ...captured, line_items }, 'chit');
        summary_json.conformance = { status: v.status, advisory: true, gaps: (v.gaps || []).map(g => g.missing), captured: Object.keys(captured) };
      } catch (_) { /* advisory is best-effort */ }
      const auto_subject = `Order from ${c.display_name} — ` +
        new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const all_recipients = [
        { entity_id: c.identity_id,      bridge_id: c.bridge_id,      display_name: c.display_name,      role: 'sender' },
        { entity_id: entity.identity_id, bridge_id: entity.bridge_id, display_name: entity.display_name, role: 'receiver' }
      ];
      const li = JSON.stringify(line_items);
      const ar = JSON.stringify(all_recipients);
      const sj = JSON.stringify(summary_json);

      // freeze-at-send (A10): governing schema = the SHOP's active default schema
      const schemaRow = await query(
        `SELECT schema_id, schema_version FROM entity_schemas
          WHERE entity_id = $1 AND status = 'active' AND is_default = true
          ORDER BY created_at DESC LIMIT 1`,
        [entity.identity_id]
      );
      const frozen_schema_id      = schemaRow.rows[0]?.schema_id      || null;
      const frozen_schema_version = schemaRow.rows[0]?.schema_version || null;

      // guaranteed write: OTP consume + both chit records + timeline, all-or-nothing (INV-2).
      // Delivery is a substrate op (writes the customer + shop copies) -> the b50 chit_deliver definer, run in
      // withEntity(sender = the customer), with the OTP consume in the SAME tx. Fallback to the legacy inline
      // fan-out when b50 isn't applied (chit_deliver missing -> the whole withEntity rolls back incl. the OTP,
      // then the fallback redoes it). NOTE: chit_deliver sets chit_ref = chit_id (was NULL here) — benign, matches /send.
      /* ⚠️ SHAPE from lib/mint.js. This copy pair carried NO manual_subject and NO created_by_actor_id where the
         other paths did — the customer is not an actor and the subject is generated. header() supplies both as
         null, which is what the INSERT stored anyway; the difference was that three paths said so and this one
         left the reader to work it out. */
      const orderHeader = mint.header({ sender_entity_id: c.identity_id, sender_entity_bridge_id: c.bridge_id,
        sender_entity_display_name: c.display_name, all_recipients, purpose, auto_subject, manual_subject: null,
        summary_json, schema_version: frozen_schema_version, schema_id: frozen_schema_id, detail_type: purpose });
      const orderCopies = [
        mint.party(orderHeader, { entity_id: c.identity_id, direction: 'sent', role: 'Act',
          current_status: 'delivered', payload_delivered: true, line_items,
          log: { action: 'created', action_by_identity_id: c.identity_id, action_by_display_name: c.display_name,
                 new_status: 'delivered', detail: `Order placed to ${entity.display_name}` } }),
        mint.party(orderHeader, { entity_id: entity.identity_id, direction: 'received', role: 'Act',
          current_status: 'pending', line_items,
          log: { action: 'delivered', action_by_identity_id: c.identity_id, action_by_display_name: c.display_name,
                 new_status: 'pending', detail: `Order received from ${c.display_name}` } }),
      ];
      try {
        await withEntity(c.identity_id, async (client) => {
          await client.query(
            `UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW()
              WHERE identity_id=$1`, [c.identity_id]);
          /* ⚠️ THE OPEN CLIENT IS PASSED IN, not a new connection — the OTP consume above and the documents below
             must commit with the chit or not at all. mint.deliver honours opts.client for exactly this. */
          await mint.deliver(c.identity_id, chit_id, orderCopies, { client });
          // T2.2 / T3.10 · the documents commit WITH the chit. Writing them afterwards forced an impossible choice:
          // 200 with documents_stored:false (a chit asserting evidence nobody holds, and — until the customer surface
          // existed — no way to ever supply it), or 500 on a submission that had already committed. Inside the
          // transaction there is no partial state to reconcile: either the form and its proof both land, or neither.
          if (pendingDocs.length) {
            const storage = require('../lib/storage');
            const participants = [c.identity_id, entity.identity_id];
            for (const d of pendingDocs) {
              await storage.putForParticipantsInTx(client, { chit_id, message_id: null, line_index: d.line_index,
                name: d.name, mime: d.mime, size: d.size, buffer: d.buffer, uploaded_by: c.identity_id,
                participants, forEntity: c.identity_id });
            }
            // restore the customer's context — set_config above is transaction-local, and anything after this
            // (now or later) must not inherit the shop's.
            await client.query(`SELECT set_config('app.current_entity', $1, true)`, [String(c.identity_id)]);
          }
        });
      } catch (e) {
        if (!(e && (e.code === '42883' || /chit_deliver/.test(e.message || '')))) throw e;
        // pre-b50 fallback: the legacy inline OTP consume + dual-copy fan-out (unchanged).
        await withTransaction(async (client) => {
        await client.query(
          `UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW()
            WHERE identity_id=$1`, [c.identity_id]);

        // sender (customer) record
        await client.query(
          `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
             all_recipients, purpose, auto_subject, summary_json, schema_version, schema_id, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$11,$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, c.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id, purpose]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items, payload_delivered_at)
           VALUES ($1,$2,$7,$3,$4,$5,$6,NOW())`,
          [chit_id, c.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li, purpose]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'delivered')`, [chit_id, c.identity_id]);

        // receiver (shop) record
        await client.query(
          `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
             all_recipients, purpose, auto_subject, summary_json, schema_version, schema_id, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$11,$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, entity.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id, purpose]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items)
           VALUES ($1,$2,$7,$3,$4,$5,$6)`,
          [chit_id, entity.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li, purpose]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'pending')`, [chit_id, entity.identity_id]);

        // timeline — both sides, in the same commit (was best-effort; now guaranteed)
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           VALUES ($1,$2,'created',$3,$4,'delivered',$5),($1,$6,'delivered',$3,$4,'pending',$7)`,
          [chit_id, c.identity_id, c.identity_id, c.display_name, `Order placed to ${entity.display_name}`,
           entity.identity_id, `Order received from ${c.display_name}`]);

        // T2.2 · documents commit with the chit on THIS path too, or the fallback would silently lose them.
        if (pendingDocs.length) {
          const storage = require('../lib/storage');
          const participants = [c.identity_id, entity.identity_id];
          for (const d of pendingDocs) {
            await storage.putForParticipantsInTx(client, { chit_id, message_id: null, line_index: d.line_index,
              name: d.name, mime: d.mime, size: d.size, buffer: d.buffer, uploaded_by: c.identity_id,
              participants, forEntity: c.identity_id });
          }
        }
        });
      }

      // CJ-06: best-effort CRM auto-add — after commit, never breaks the order.
      // B1 RLS: customer_list is owner-scoped (owner_entity_id = the shop) -> withEntity(shop).
      try {
        await withEntity(entity.identity_id, (db) => db.query(
          `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
           VALUES ($1,$2,'end_customer','catalogue',1,NOW())
           ON CONFLICT (owner_entity_id, customer_identity_id)
           DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
          [entity.identity_id, c.identity_id]));
      } catch (e) { console.log('customer auto-add skipped:', e.message); }

      // STONE 4: penetration capture — AGGREGATE-ONLY (source + distributor + coarse locality; NO customer identity).
      // Best-effort, post-commit, never breaks the order; self-heals if b79 isn't applied. Feeds the brand's heatmap.
      if (custLocality) {
        try {
          const srcs = Array.from(new Set(line_items.filter((l) => l.source).map((l) => l.source)));
          for (const sk of srcs) await query('INSERT INTO source_penetration (source_key, distributor_entity_id, locality) VALUES ($1,$2,$3)', [sk, entity.identity_id, custLocality]);
        } catch (e) { /* b79 not applied → skip (self-healing) */ }
      }

      // 6b: ERP HANDOFF (receipt-only, process-then-forget). Hand the order + its governance (source@v, frozen
      // container, routing, locality) to the ERP; keep a RECEIPT (refs + hash), NOT the raw payload. CB does NOT
      // route/fulfill — the ERP does. This is where CB stops at the information. Best-effort, self-healing.
      try {
        const govLines = line_items.filter((l) => l.governed).map((l) => ({ finish: l.name, source: l.governed.under, container: l.governed.container || null, routing: l.governed.routing || null, qty: l.quantity }));
        if (govLines.length) {
          const summary = { chit_id, total: summary_json.total_value, currency: summary_json.currency_code, locality: custLocality || null, lines: govLines };
          const payload_hash = crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
          await withEntity(entity.identity_id, (db) => db.query(
            `INSERT INTO erp_handoff (handoff_id, entity_id, chit_id, summary, payload_hash, status) VALUES ($1,$2,$3,$4::jsonb,$5,'handed_off')`,
            [uuidv4(), entity.identity_id, chit_id, JSON.stringify(summary), payload_hash]));
        }
      } catch (e) { /* b82 not applied → skip (self-healing) */ }

      // customer token (for future order tracking — CJ-F1)
      const token = jwt.sign(
        { identity_id: c.identity_id, bridge_id: c.bridge_id, display_name: c.display_name,
          email: handle, identity_type: 'customer', parent_entity_id: entity.identity_id },
        process.env.JWT_SECRET, { expiresIn: '7d' });

      // T2.2 · the documents were written INSIDE the chit transaction above, so reaching here means they committed.
      // There is no `documents_stored:false` any more: a storage failure rolls the whole submission back and the
      // customer still has the file on screen to retry with. `documents` is reported so the caller can record the
      // sealed hashes, with line_index so a bundle can tell which form each proof belongs to.
      res.json({ message: purpose === 'offer' ? 'Offer sent' : 'Order placed', chit_id, shop: entity.display_name,
                 summary: summary_json, token,
                 ...(pendingDocs.length ? { documents: pendingDocs.map((d) => ({ name: d.name, sha256: d.sha256, line_index: d.line_index })) } : {}) });
    } catch (err) { console.error('order/confirm:', err.message); res.status(500).json({ error: 'Order failed', message: safeErr(err) }); }
  });

// ── CJ-F1: verify OTP for sign-in (no order) → customer token ──
router.post('/:bridge_id/login/verify',
  [ body('otp').trim().isLength({ min: 6, max: 6 }) ],
  validate,
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      const c0 = resolveContact(req.body);
      if (c0.error) return res.status(422).json({ error: 'Sign-in failed', message: c0.error });
      const handle = crHandle(c0.channel, c0.raw, entity.bridge_id);
      const cr = await query(
        `SELECT identity_id, bridge_id, display_name, otp_code, otp_expires_at, otp_attempts
         FROM identities WHERE email = $1`, [handle]);
      if (!cr.rows.length) return res.status(400).json({ error: 'Sign-in failed', message: 'No account — place an order first' });
      const c = cr.rows[0];
      const otpCheck = await verifyOtp(query, c, req.body.otp);
      if (!otpCheck.ok) return res.status(otpCheck.status).json({ error: 'Sign-in failed', message: otpCheck.message });
      await query(`UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW() WHERE identity_id=$1`, [c.identity_id]);
      const token = jwt.sign(
        { identity_id: c.identity_id, bridge_id: c.bridge_id, display_name: c.display_name,
          email: handle, identity_type: 'customer', parent_entity_id: entity.identity_id },
        process.env.JWT_SECRET, { expiresIn: '7d' });
      res.json({ message: 'Signed in', token, name: c.display_name });
    } catch (err) { res.status(500).json({ error: 'Sign-in failed', message: safeErr(err) }); }
  });

// ── CJ-F1: the signed-in customer's orders + live status ──
// T2.4 · THE CUSTOMER'S OWN SURFACE. This route existed but was mounted on `auth`, which fails closed on
// identity_type 'customer' — so its only intended caller could never reach it. It now uses customerAuth.
// Also: `purpose = 'order'` would have hidden every OFFER since T2.1 renamed those; both are listed.
router.get('/:bridge_id/my-orders', customerAuth, async (req, res) => {
  try {
    const me = req.customer.identity_id;
    // B1 RLS: the customer's OWN copies -> withEntity(me). Never the shop's copies.
    const r = await withEntity(me, (db) => db.query(
      `SELECT ch.chit_id, ch.auto_subject, ch.summary_json, ch.created_at, cs.current_status
       FROM chit_header ch
       JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id
       WHERE ch.entity_id = $1 AND ch.purpose IN ('order', 'offer')
       ORDER BY ch.created_at DESC`, [me]));
    res.json({ orders: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ error: 'Orders failed', message: safeErr(err) }); }
});

// T2.4 · the documents the customer themselves submitted — their OWN per-copy rows, nobody else's.
router.get('/:bridge_id/my-documents', customerAuth, async (req, res) => {
  try {
    const me = req.customer.identity_id;
    const r = await withEntity(me, (db) => db.query(
      `SELECT id, chit_id, line_index, name, mime, size, created_at
         FROM cb_attachment WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 200`, [me]));
    res.json({ documents: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ error: 'Documents failed', message: safeErr(err) }); }
});

// T2.4 · and the right to PURGE their own copy. Per-copy independence means each party can delete what it holds
// without touching the other's — that is the whole point of replicating rather than sharing, and until now the
// customer's side of it was a claim the code could not honour. The shop's copy is untouched.
router.delete('/:bridge_id/my-documents/:id', customerAuth, async (req, res) => {
  try {
    const me = req.customer.identity_id;
    const r = await withEntity(me, (db) => db.query(
      `DELETE FROM cb_attachment WHERE id = $1 AND entity_id = $2 RETURNING id`, [req.params.id, me]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such document of yours' });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Delete failed', message: safeErr(err) }); }
});


/**
 * POST /photo-extract — read products out of a photo (SPEC-catalogue-photo-vision.md, step 5's server half).
 *
 * The thin route the spec describes: it takes already-downscaled bytes from the client and hands them to the
 * co-assist. It owns no vision logic of its own — the caps, the fence and the multimodal branch all live in
 * invokeSkill, so there is exactly one place where an image can reach a model.
 *
 * ⚠️ PROPOSES, NEVER COMMITS. gate:'confirm' — the owner edits and accepts every row. An AI-read price that
 * committed itself would be a fabricated number wearing the appearance of evidence.
 */
router.post('/photo-extract', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const images = (req.body && req.body.images) || [];
    if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: 'No images', message: 'Send images: [{ mime, b64 }].' });
    const out = await require('../lib/ai').invokeSkill(entity_id, 'photo-to-items', { images });
    res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Photo read failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) });
  }
});

module.exports = router;
module.exports.resolveContact = resolveContact;   // exported for unit tests (F2 channel detection)
module.exports.crHandle = crHandle;               // exported for unit tests (collision-free .cr handle)
