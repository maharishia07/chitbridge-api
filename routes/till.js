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
    const [shelf, itemRows] = await Promise.all([
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
    const sellable = (r) => r.is_active !== false && itemstatus.isOfferable(r.item_data || {});
    const removed = since ? all.filter((r) => !sellable(r)).map((r) => r.item_id) : [];
    const items = all.filter(sellable).map((it) => {
      const d = it.item_data || {};
      return { item_id: it.item_id, name: d.name, code: d.code || d.sku || null, unit: d.unit || 'piece',
               /* ⚠️ A PRICE IS SOMETIMES MONEY, NOT A NUMBER: the catalogue stores { amount, currency } as well as a bare figure,
                  and reading only the bare one gave the counter a shelf of zeroes ([TILL-01], first run). Same reader as pricing-engine. */
               price: amountOf(d.price), mrp: amountOf(d.mrp),
               hsn: d.hsn || d.hs_code || d.hsn_code || null, tax_slab: d.tax_slab || null, category: d.category || null,
               barcode: d.barcode || d.ean || null, avail: d.avail || null,
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
      items, removed, delta: !!since, since: since || null, offers, staff,
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
        WHERE h.entity_id = $1 AND h.direction = 'sent' AND h.purpose IN ('order','offer')
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
