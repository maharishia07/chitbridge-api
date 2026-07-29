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
const { verifyOtp } = require('../lib/otp');   // per-account OTP attempt cap
const { sendOtp } = require('../lib/notify');  // F2 — dual-channel OTP delivery (email via Resend, SMS pluggable)
const catalogueBuild = require('../lib/catalogue-build');   // B3.7-ref: resolve the shop's adopted REFERENCE catalogue for the storefront
const container = require('../lib/container');              // CONTAINER MODEL (b80) — freeze the container ref+version on the order chit

const genBridge = () => {   // S4 — CSPRNG (bridge ids are public, but no reason to use a weak PRNG)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[require('crypto').randomInt(0, chars.length)];
  return id;
};
// Customer (storefront) OTP: fixed 123123 in dev (distinct from the entity dev OTP 123456); CSPRNG in real prod (S4).
const genOTP = () => ((process.env.DEV_OTP || '').trim() ? '123123' : require('crypto').randomInt(100000, 1000000).toString());
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
const MAX_FORMS_PER_SUBMISSION = 5;   // one purpose, several forms (an export bundle, a loan pack) — but bounded
// The catalogue DECLARES what it receives (lib/order-input.js). Read server-side from the face (b112) and never from
// the request, so a customer cannot claim a shop is negotiable — or priceless — when it is not.
async function getOrderInput(entity_id) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    const face = (r.rows[0] && r.rows[0].face) || {};
    // `order_input` is the declaration; `method` is the pre-declaration field, still honoured as a preset name.
    return orderInput.resolve(face.order_input || (face.method ? { preset: face.method } : null));
  } catch (_) { return orderInput.resolve(null); }       // no face / table absent → cart/commerce, today's behaviour
}
// Validate the buyer's proposal. NOTHING here feeds price/total — CJ-07 price integrity is untouched: the line price
// and total stay server-authoritative. This only decides whether a NON-authoritative position is admissible.
// It is strictly a NEW restriction (a fixed-price shop now REJECTS an offer that it previously ignored).
// A store may offer SEVERAL templates, and each asks for different things — the customer must be shown the fields of
// the template THEY picked, not one catalogue-wide set. So an item may carry its own `order_input`, merge-patched over
// the catalogue's (opt-in: no item declaration → the catalogue governs). Resolved SERVER-SIDE at submit, so what gets
// validated is what the ITEM declares, never what the client claims it declares.
async function itemDeclFor(entity_id, itemName) {
  if (!itemName) return null;
  try {
    const ado = await withEntity(entity_id, (db) => db.query(
      `SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true`, [entity_id]));
    const want = _norm(itemName);
    for (const row of ado.rows) {
      const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {});
      for (const it of ((resolved && resolved.items) || [])) {
        if (_norm(it.name) === want) return it.order_input || null;
      }
    }
  } catch (_) { /* no adoption → the catalogue declaration governs */ }
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
    `SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id]));
  const byId = new Map(), byName = new Map(), nameCount = new Map();   // F6: nameCount flags ambiguous names
  for (const row of cat.rows) {
    const d = row.item_data || {};
    // null/undefined/'' price = NOT SET -> NaN (rejected below). A deliberate 0 stays a valid price.
    const price = (d.price === null || d.price === undefined || d.price === '') ? NaN : Number(d.price);
    const rec = { item_id: row.item_id, name: d.name ?? d.particulars ?? '', price, unit: d.unit ?? null };
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
        const p = (_raw != null && _raw !== '') ? Number(_raw) : NaN;
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
      const combo = li.combination ?? li.combo ?? null;
      if (combo && fref.combos.size && !fref.combos.has(_norm(combo))) throw _422(`"${combo}" is not a colour combination of "${fref.name}"`);
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
    return { item_id: ref.item_id, particulars: ref.name, name: ref.name, unit: ref.unit, quantity: qty, price: ref.price, total };
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
        price: (d.price != null ? Number(d.price) : null), unit: d.unit || null, image: d.image || null }; });
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
async function deliverEdge({ sender, receiver, chit_id, subject, trace, business, status }) {
  const all_recipients = [
    { entity_id: sender.id, bridge_id: sender.bridge_id, display_name: sender.display_name, role: 'sender' },
    { entity_id: receiver.id, bridge_id: receiver.bridge_id, display_name: receiver.display_name, role: 'receiver' },
  ];
  const summary_json = { line_item_count: 0, total_value: 0, currency_code: 'INR', priority_external: 'normal', purpose: 'order', is_promotion: false, forwarded_from: null, trace };
  const headerCommon = { sender_entity_id: sender.id, sender_entity_bridge_id: sender.bridge_id, sender_entity_display_name: sender.display_name,
    all_recipients, purpose: 'order', auto_subject: subject, manual_subject: subject, summary_json,
    schema_version: null, schema_id: null, created_by_actor_id: sender.id, detail_type: 'order', line_item_count: 0, total_value: 0, currency_code: 'INR' };
  const copies = [
    { ...headerCommon, business_json: business, entity_id: sender.id, direction: 'sent', role: 'Act', current_status: 'delivered', priority_flag: 'normal',
      log: { action: 'created', action_by_identity_id: sender.id, action_by_display_name: sender.display_name, new_status: 'delivered', detail: subject } },
    { ...headerCommon, business_json: business, entity_id: receiver.id, direction: 'received', role: 'Act', current_status: status || 'pending', priority_flag: 'normal',
      log: { action: 'delivered', action_by_identity_id: sender.id, action_by_display_name: sender.display_name, new_status: status || 'pending', detail: subject } },
  ];
  await withEntity(sender.id, (dbx) => dbx.query(`SELECT chit_deliver($1,$2,$3::jsonb)`, [chit_id, false, JSON.stringify(copies)]));
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
      return { item_id: r.item_id, store: r.entity_id, name: d.name || 'item', price: Number(d.price || 0), qty: Number(c.qty || 1), category: d.category || '' }; });
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    // 1) the ORDER chit (customer → operator) — the common id the customer sees
    const ORDER_ID = uuidv4();
    await deliverEdge({ sender: customer, receiver: operator, chit_id: ORDER_ID,
      subject: 'Order — ' + items.length + ' item(s), ₹' + total,
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
      await deliverEdge({ sender: operator, receiver: store, chit_id: FRAG_ID,
        subject: 'Fulfil order ' + ORDER_ID.slice(0, 8) + ' — ' + sitems.length + ' item(s)',
        trace: { parents: [ORDER_ID], product: 'FULFIL', qty: sitems.length, unit: 'items', network: { id: nid, operator: operatorId } },
        business: { kind: 'order_fragment', order_id: ORDER_ID, network_id: nid, items: sitems.map((i) => ({ name: i.name, qty: i.qty })), at: new Date().toISOString() },
        status: 'pending' });
      fragments.push(FRAG_ID);
    }
    res.json({ ok: true, order_id: ORDER_ID, item_count: items.length, total, currency: 'INR', fragment_count: fragments.length });   // customer sees only the order — no stores
  } catch (err) {
    res.status(500).json({ error: 'Order failed', message: safeErr(err) });
  }
});

// ── CJ-02: public catalogue (only when visibility='public') ──
router.get('/:bridge_id', async (req, res) => {
  try {
    const entity = await resolveEntity(req.params.bridge_id);
    if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    const sch = await query(
      `SELECT schema_id, schema_name FROM entity_schemas
       WHERE entity_id = $1 AND status = 'active' AND is_default = true AND visibility = 'public' LIMIT 1`,
      [entity.identity_id]);
    const hasSchema = sch.rows.length > 0;
    let fieldsRows = [], itemsRows = [];
    if (hasSchema) {
      fieldsRows = (await query(
        `SELECT field_key, field_name, field_type, required, min_value, display_order
         FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`, [sch.rows[0].schema_id])).rows;
      // B1 RLS: public storefront read (unauthenticated) -> withEntity(null) = no tenant context, so the
      // visibility-aware policy returns only PUBLIC items.
      itemsRows = (await withEntity(null, (db) => db.query(
        `SELECT item_id, item_data FROM catalogue_items
         WHERE entity_id = $1 AND is_active = true ORDER BY created_at DESC`,
        [entity.identity_id]))).rows;
    }
    // B3.7-ref: the shop's adopted REFERENCE catalogue (Royale Play finishes) — design/colour by reference + its
    // commercials. Read inside withEntity(shop) so the shop's own RLS lets us project its VISIBLE adoptions; resolve
    // against the shared source. Best-effort: b75 absent / no adoption → no finishes (storefront still works).
    let finishes = [];
    try {
      const ado = await withEntity(entity.identity_id, (db) => db.query(
        `SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true`, [entity.identity_id]));
      for (const row of ado.rows) {
        const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {});
        if (resolved) finishes.push({ source: row.source_key, title: resolved.title, collection: resolved.collection, items: resolved.items,
          owner_entity_id: resolved.owner_entity_id || null,   // b78 — the item runs under its SOURCE's governance, not the host's
          experience: resolved.experience || {}, formatting: resolved.formatting || {} });
      }
    } catch (_) { /* no reference catalogue for this shop */ }
    // Storefront available if it has EITHER a public products catalogue OR adopted designer finishes.
    if (!hasSchema && !finishes.length) return res.status(404).json({ error: 'Not available', message: 'This shop has no public catalogue' });
    // b77 (self-healing): storefront access mode; default 'browse' if the column isn't present yet.
    let storefront_access = 'browse';
    try { const sf = await query('SELECT storefront_access FROM identities WHERE identity_id = $1', [entity.identity_id]); if (sf.rows[0] && sf.rows[0].storefront_access) storefront_access = sf.rows[0].storefront_access; } catch (_) {}
    // SPEC-negotiation-position §1 — the shop's ORDER METHOD (cart | qty | range | qtyprice | text) decides what the
    // storefront asks the customer for, and therefore what data comes back. It lives on the face (b112). Best-effort:
    // no face / table absent → 'cart', so every existing storefront is unaffected.
    const oi = await getOrderInput(entity.identity_id);
    res.json({
      shop: {
        bridge_id: entity.bridge_id, display_name: entity.display_name,
        currency_code: entity.currency_code,
        gstn: entity.gstn, is_verified: entity.is_verified,
        logo_url: entity.logo_url, address: entity.address,   // B3.9 — identity/trust
        business_status: entity.business_status || 'open',     // B3.11 — open | closed | away
        storefront_access: storefront_access,                   // b77 — browse | login (self-healing)
        // the DECLARED contract: what this catalogue receives, and which pipeline a submission runs through.
        order_input: { preset: oi.preset, pipeline: oi.pipeline, showsPrice: oi.showsPrice, negotiable: oi.negotiable, schema: oi.schema },
        order_method: oi.preset                                 // back-compat alias for the preset name
      },
      schema: hasSchema ? sch.rows[0] : null,
      fields: fieldsRows,
      items:  itemsRows,           // B3.7a — the actual products
      finishes: finishes           // B3.7-ref — the adopted designer finishes (reference + commercials)
    });
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
      await query(`UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0, otp_contact = $3 WHERE identity_id = $4`,
        [otp, new Date(Date.now() + 60 * 60 * 1000), raw, identity_id]);
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
          for (let idx = 0; idx < raw.length; idx++) {
          const li = raw[idx] || {};
          const label = String(li.finish || li.name || li.particulars || 'Submission').slice(0, 200);
          // WHICH template is this entry? Its own declaration governs, so a store offering ITR-2 and a
          // Commercial Invoice validates each against ITS OWN fields — not one catalogue-wide set.
          const itemOi = orderInput.forItem(oi, await itemDeclFor(entity.identity_id, label));
          const v = orderInput.validate(li.payload, itemOi.schema);
          if (!v.ok) throw _422(`"${label}": ${v.errors.join('; ')}`);
          // THE LINE ITEM IS THE FILLED FORM **AND ITS PROOF**. Documents are validated and hashed BEFORE anything is
          // written; the sha256 is sealed onto the chit in the same transaction as the answers, so the record of what
          // was submitted can never be lost. The bytes are replicated per-copy afterwards (see below) — if that fails
          // the proof still stands and the blob is re-uploadable against a known hash.
          const dv = orderInput.validateDocuments(li.documents, itemOi.documents, crypto);
          if (!dv.ok) throw _422(`"${label}": ${dv.errors.join('; ')}`);
          dv.docs.forEach((d) => pendingDocs.push({ ...d, line_index: idx }));   // the proof stays attached to ITS form
          line_items.push({ kind: 'payload', name: label, particulars: label, quantity: 1, price: 0, total: 0, payload: v.value,
                            ...(dv.docs.length ? { documents: dv.docs.map((d) => ({ name: d.name, mime: d.mime, size: d.size, sha256: d.sha256 })) } : {}) });
          }
          total = 0;
        } catch (ve) { return res.status(ve.status || 422).json({ error: 'Submission rejected', message: ve.message }); }
      } else {
        try { ({ items: line_items, total } = await repriceAgainstCatalogue(entity.identity_id, req.body.line_items, oi)); }
        catch (ve) { return res.status(ve.status || 422).json({ error: 'Order rejected', message: ve.message }); }
      }
      // A negotiation is an OFFER, not a settled order: total_value stays the seller's catalogue price (CJ-07
      // untouched); the buyer's numbers ride along under `proposal` on each line.
      const negotiation = line_items.some((li) => li && li.proposal);
      const chit_id = uuidv4();
      const custLocality = (req.body && typeof req.body.location === 'string') ? req.body.location.trim().slice(0, 80) : '';   // STONE 4: consent-provided coarse locality
      const summary_json = { line_item_count: line_items.length, total_value: Math.round(total * 100) / 100,
                             currency_code: entity.currency_code || 'INR', purpose: 'order', is_promotion: false,
                             customer_locality: custLocality || null,
                             order_preset: oi.preset, pipeline: oi.pipeline,
                             // reads as an OFFER awaiting the seller, not a settled order. total_value above is still
                             // the seller's catalogue price — the buyer's numbers live on the lines under `proposal`.
                             ...(negotiation ? { negotiation: true } : {}) };
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
      const captured = (req.body && typeof req.body.captured === 'object' && req.body.captured) ? req.body.captured : {};
      if (Object.keys(captured).length) summary_json.captured = captured;
      try {
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
      const orderCopies = [
        { entity_id: c.identity_id, sender_entity_id: c.identity_id, sender_entity_bridge_id: c.bridge_id,
          sender_entity_display_name: c.display_name, all_recipients, purpose: 'order', auto_subject,
          summary_json, schema_version: frozen_schema_version, schema_id: frozen_schema_id,
          current_status: 'delivered', payload_delivered: true, detail_type: 'order',
          direction: 'sent', role: 'Act', priority_flag: 'normal',
          line_item_count: summary_json.line_item_count, total_value: summary_json.total_value,
          currency_code: summary_json.currency_code, line_items,
          log: { action: 'created', action_by_identity_id: c.identity_id, action_by_display_name: c.display_name,
                 new_status: 'delivered', detail: `Order placed to ${entity.display_name}` } },
        { entity_id: entity.identity_id, sender_entity_id: c.identity_id, sender_entity_bridge_id: c.bridge_id,
          sender_entity_display_name: c.display_name, all_recipients, purpose: 'order', auto_subject,
          summary_json, schema_version: frozen_schema_version, schema_id: frozen_schema_id,
          current_status: 'pending', detail_type: 'order',
          direction: 'received', role: 'Act', priority_flag: 'normal',
          line_item_count: summary_json.line_item_count, total_value: summary_json.total_value,
          currency_code: summary_json.currency_code, line_items,
          log: { action: 'delivered', action_by_identity_id: c.identity_id, action_by_display_name: c.display_name,
                 new_status: 'pending', detail: `Order received from ${c.display_name}` } },
      ];
      try {
        await withEntity(c.identity_id, async (client) => {
          await client.query(
            `UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW()
              WHERE identity_id=$1`, [c.identity_id]);
          await client.query(`SELECT chit_deliver($1,$2,$3::jsonb)`, [chit_id, false, JSON.stringify(orderCopies)]);
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
           VALUES ($1,$2,$3,$4,$5,$6,'order',$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, c.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items, payload_delivered_at)
           VALUES ($1,$2,'order',$3,$4,$5,$6,NOW())`,
          [chit_id, c.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'delivered')`, [chit_id, c.identity_id]);

        // receiver (shop) record
        await client.query(
          `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
             all_recipients, purpose, auto_subject, summary_json, schema_version, schema_id, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'order',$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, entity.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items)
           VALUES ($1,$2,'order',$3,$4,$5,$6)`,
          [chit_id, entity.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'pending')`, [chit_id, entity.identity_id]);

        // timeline — both sides, in the same commit (was best-effort; now guaranteed)
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           VALUES ($1,$2,'created',$3,$4,'delivered',$5),($1,$6,'delivered',$3,$4,'pending',$7)`,
          [chit_id, c.identity_id, c.identity_id, c.display_name, `Order placed to ${entity.display_name}`,
           entity.identity_id, `Order received from ${c.display_name}`]);
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

      // ── carry the documents: replicate the bytes PER COPY (b66 — each party owns and can purge its own row) ──
      // Deliberately AFTER the commit. The proof (sha256) is already sealed onto the chit, so a storage failure can
      // never erase the record of what was submitted — it only means the blob must be re-uploaded against a known
      // hash. Reuses lib/storage.putForParticipants, which already runs each insert in its own entity context so the
      // FORCE-RLS WITH CHECK passes for that participant's copy.
      let documents_stored = pendingDocs.length ? true : undefined;
      if (pendingDocs.length) {
        try {
          const storage = require('../lib/storage');
          const participants = [c.identity_id, entity.identity_id];
          for (const d of pendingDocs) {
            await storage.putForParticipants({ chit_id, message_id: null, line_index: d.line_index, name: d.name, mime: d.mime,
              size: d.size, buffer: d.buffer, uploaded_by: c.identity_id, participants, forEntity: c.identity_id });
          }
        } catch (e) {
          documents_stored = false;
          console.error('order/confirm document storage failed (proof is sealed on the chit):', e.message);
        }
      }
      res.json({ message: 'Order placed', chit_id, shop: entity.display_name, summary: summary_json, token,
                 ...(documents_stored === undefined ? {} : { documents_stored, documents: pendingDocs.map((d) => ({ name: d.name, sha256: d.sha256 })) }) });
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
router.get('/:bridge_id/my-orders', auth, async (req, res) => {
  try {
    const me = req.identity.identity_id;
    // B1 RLS: the customer's OWN order copies -> withEntity(me).
    const r = await withEntity(me, (db) => db.query(
      `SELECT ch.chit_id, ch.auto_subject, ch.summary_json, ch.created_at, cs.current_status
       FROM chit_header ch
       JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id
       WHERE ch.entity_id = $1 AND ch.purpose = 'order'
       ORDER BY ch.created_at DESC`, [me]));
    res.json({ orders: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ error: 'Orders failed', message: safeErr(err) }); }
});

module.exports = router;
module.exports.resolveContact = resolveContact;   // exported for unit tests (F2 channel detection)
module.exports.crHandle = crHandle;               // exported for unit tests (collision-free .cr handle)
