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
const crypto = require('crypto');

/** a short, stable stamp for "which copy of the catalogue was this bill priced from" */
function versionOf(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

router.get('/snapshot', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);

    /* the shop, as its own books know it — the slip's header, and what decides tax invoice vs cash memo */
    const me = await query(
      `SELECT display_name, gstn, country, policy_flags FROM identities WHERE identity_id = $1`, [entity_id]);
    const row = me.rows[0] || {};
    const flags = await policy.get(entity_id).catch(() => ({}));
    let profile = {};
    try {
      const p = await query(`SELECT profile_json FROM entity_profile WHERE entity_id = $1`, [entity_id]);
      profile = (p.rows[0] && p.rows[0].profile_json) || {};
    } catch (_) { /* an entity with no profile still bills */ }

    /**
     * ⚠️ THE ITEMS ARE NOT THE TAX SHELF. readShelf() answers null for a seller with no GSTIN — the one place that decides "no GSTIN,
     * no GST" for the cart, the send and the invoice alike — and most shops we are building this counter for have none. So the shelf
     * is asked only for slabs, categories and the face; the items come from the catalogue, whoever the shop is.
     */
    const [shelf, itemRows] = await Promise.all([
      taxShelf.readShelf(entity_id, { withEntity, query, regionLayer: regional.regionLayer,
        getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) }, { withItems: false }).catch(() => null),
      withEntity(entity_id, (db) => db.query(
        'SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY updated_at DESC NULLS LAST LIMIT 5000',
        [entity_id])).catch(() => ({ rows: [] })),
    ]);

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

    const items = ((itemRows && itemRows.rows) || []).map((it) => {
      const d = it.item_data || {};
      return { item_id: it.item_id, name: d.name, code: d.code || d.sku || null, unit: d.unit || 'piece',
               price: d.price != null ? Number(d.price) : null, mrp: d.mrp != null ? Number(d.mrp) : null,
               hsn: d.hsn || d.hs_code || d.hsn_code || null, tax_slab: d.tax_slab || null, category: d.category || null,
               barcode: d.barcode || d.ean || null, avail: d.avail || null };
    }).filter((x) => x.name);

    const body = {
      at: new Date().toISOString(),
      shop: {
        name: profile.trade_name || row.display_name || 'This shop',
        legal_name: profile.legal_name || null,
        address: [profile.address, profile.city, profile.state, profile.pincode].filter(Boolean).join(', ') || null,
        phone: profile.phone || null,
        gstin: row.gstn || profile.gstin || null,
        state_code: String(row.gstn || '').slice(0, 2) || null,
        reg_type: String(flags.gst_registration || 'regular'),
        currency: profile.currency || 'INR',
      },
      items, offers,
      slabs: (shelf && shelf.slabs) || [], categories: (shelf && shelf.categories) || [], face: (shelf && shelf.face) || {},
      customers,
      policy: { books_at: flags.books_at || 'accepted', qty_zero_hides: flags.qty_zero_hides || 'off' },
    };
    body.version = versionOf({ i: items, o: offers, s: body.slabs, sh: body.shop });
    res.json(body);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐ THE ENGINES, SERVED (2026-09-07). A till has to price with the line down, so it keeps its own copy of the two engines — and it
 * gets them from here rather than from a second host, so there is one place that answers "which version is the counter running".
 * Cached by the till at install and refreshed with the snapshot; both files are the SAME code the server and the app run.
 */
const ENGINES = { offers: '../lib/offers-engine.js', tax: '../lib/tax-engine.browser.js' };
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
