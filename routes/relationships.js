// routes/relationships.js — B3.6 Supplier List + Customer List + Promotions
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const catalogueView  = require('../lib/catalogue-view');    // the SAME catalogue read the public storefront uses
const catalogueBuild = require('../lib/catalogue-build');
const customerGroups = require('../lib/customer-groups');   // the one segment expression + the viewer's groups
const orderInput     = require('../lib/order-input');

// actors act in their parent entity's context
const ctx = (req) => auth.entityOf(req);

// ── SUPPLIERS (no consent — D-056) ──────────────────────────

// Add a supplier by bridge_id — with optional owner-side fields (your naming / preferred / notes)
router.post('/suppliers',
  [ body('supplier_bridge_id').trim().notEmpty().withMessage('Supplier bridge ID required'),
    body('category').optional().trim().isLength({ max: 50 }),
    body('nickname').optional().trim().isLength({ max: 80 }),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean() ],
  validate, auth,
  async (req, res) => {
    try {
      const owner     = ctx(req);
      const bridge    = req.body.supplier_bridge_id.trim();
      const category  = sanitise(req.body.category || '') || null;
      const nickname  = sanitise(req.body.nickname || '') || null;
      const notes     = sanitise(req.body.notes || '') || null;
      const preferred = req.body.preferred === true || req.body.preferred === 'true';

      // Resolve by bridge_id OR external user_id OR email — the panel prompts "User ID or email",
      // so bridge-id-only lookup would 404 those. (Matches the ATH-114 user_id resolution.)
      const sup = await query(
        `SELECT identity_id, display_name FROM identities
         WHERE bridge_id = $1 OR LOWER(user_id) = LOWER($1) OR LOWER(email) = LOWER($1)
         LIMIT 1`, [bridge]);
      if (sup.rows.length === 0)
        return res.status(404).json({ error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
      if (sup.rows[0].identity_id === owner)
        return res.status(400).json({ error: 'Invalid', message: 'Cannot add yourself' });

      const dup = await query(
        `SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
        [owner, sup.rows[0].identity_id]);
      if (dup.rows.length > 0)
        return res.status(409).json({ error: 'Exists', message: 'Already in your supplier list' });

      await query(
        `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, category, nickname, notes, preferred, added_via)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual')`,
        [owner, sup.rows[0].identity_id, category, nickname, notes, preferred]);

      res.json({ message: 'Supplier added',
        supplier: { bridge_id: bridge, display_name: sup.rows[0].display_name, category, nickname, notes, preferred } });
    } catch (err) {
      console.error('Add supplier error:', err.message);
      res.status(500).json({ error: 'Add supplier failed', message: safeErr(err) });
    }
  });

// List my suppliers — has_catalogue reflects an active default schema only
router.get('/suppliers', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await query(
      `SELECT sl.supplier_list_id, sl.category, sl.nickname, sl.preferred, sl.notes, sl.created_at,
              i.bridge_id, i.user_id, i.display_name, i.identity_id AS supplier_entity_id,
              i.gstn, i.country, i.policy_flags,
              EXISTS (SELECT 1 FROM entity_schemas es
                      WHERE es.entity_id = i.identity_id
                        AND es.status = 'active' AND es.is_default = true) AS has_catalogue
       FROM supplier_list sl
       JOIN identities i ON i.identity_id = sl.supplier_entity_id
       WHERE sl.owner_entity_id = $1
       ORDER BY sl.preferred DESC, sl.created_at DESC`, [owner]);
    /* ⭐ the public facts with their rung (lib/public-facts.js) — the row's raw flags never leave the server */
    const { factsOf } = require('../lib/public-facts');
    const rows = r.rows.map((x) => { const facts = factsOf(x); const o = Object.assign({}, x); delete o.policy_flags; delete o.gstn; o.facts = facts; return o; });
    res.json({ suppliers: rows, count: rows.length });
  } catch (err) {
    console.error('Get suppliers error:', err.message);
    res.status(500).json({ error: 'Get suppliers failed', message: safeErr(err) });
  }
});

// Update owner-side fields on a supplier relationship — your naming / preferred / notes / category.
// Does NOT touch the supplier's own entity (that's theirs). Only the fields the owner controls.
router.patch('/suppliers/:id',
  [ body('nickname').optional({ nullable: true }).trim().isLength({ max: 80 }),
    body('category').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean() ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req);
      const sets = [], vals = []; let n = 1;
      if ('nickname'  in req.body) { sets.push(`nickname = $${n++}`);  vals.push(sanitise(req.body.nickname || '') || null); }
      if ('category'  in req.body) { sets.push(`category = $${n++}`);  vals.push(sanitise(req.body.category || '') || null); }
      if ('notes'     in req.body) { sets.push(`notes = $${n++}`);     vals.push(sanitise(req.body.notes || '') || null); }
      if ('preferred' in req.body) { sets.push(`preferred = $${n++}`); vals.push(req.body.preferred === true || req.body.preferred === 'true'); }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update', message: 'Provide nickname, category, notes, or preferred' });
      vals.push(req.params.id, owner);
      const r = await query(
        `UPDATE supplier_list SET ${sets.join(', ')}
         WHERE supplier_list_id = $${n++} AND owner_entity_id = $${n} RETURNING supplier_list_id`, vals);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Supplier updated' });
    } catch (err) {
      console.error('Update supplier error:', err.message);
      res.status(500).json({ error: 'Update failed', message: safeErr(err) });
    }
  });

// Remove from my list (does not affect the supplier)
router.delete('/suppliers/:id', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await query(
      `DELETE FROM supplier_list WHERE supplier_list_id = $1 AND owner_entity_id = $2 RETURNING supplier_list_id`,
      [req.params.id, owner]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Supplier removed' });
  } catch (err) {
    res.status(500).json({ error: 'Remove supplier failed', message: safeErr(err) });
  }
});

/**
 * ⭐⭐ GET /api/relationships/suppliers/availability?q=<text> — ONE QUESTION, EVERY SUPPLIER (backlog 8).
 *
 * Athi, 2026-08-16: *"do we have a chance to seach the product under all the suppliers, similar to network?"* →
 * *"we need to have endpoint, keep it as backlog and build it."*
 *
 * Shipped first as a CLIENT-SIDE FAN-OUT — the browser fetched every supplier's whole catalogue and filtered
 * locally. Correct and honest, and the wrong shape past a couple of dozen suppliers: N sequential whole-catalogue
 * round trips to answer one word.
 *
 * ── THE THREE-STATE ANSWER IS THE WHOLE VALUE ───────────────────────────────────────────────────────────────────
 * `has` · `nocat` · `miss`, and they must stay three.
 *   · **has**   — their catalogue was read and the product is in it
 *   · **nocat** — they have published no catalogue, so WE CANNOT TELL. Not "no".
 *   · **miss**  — their catalogue was read and the product is not in it. This one IS "no".
 * ⚠️ Collapsing `nocat` into `miss` is the same lie as drawing an unreported store as 0 stock in
 * lib/availability.js — *absent is not zero*, and a buyer who is told "nobody stocks it" will stop looking.
 * `err` is a fourth state for the same reason: a read that FAILED is not a supplier who does not stock it.
 *
 * ── ACCESS: PUBLIC TIER, DELIBERATELY ───────────────────────────────────────────────────────────────────────────
 * ⚠️ This calls the SAME `buildPublicView` the anonymous storefront uses, with the same viewer, so it returns no
 * more than anyone could read without a session. That is load-bearing, not incidental: adding a supplier is
 * UNILATERAL (see POST /suppliers — no consent from the supplier), so "related" is SELF-ASSERTED and must not
 * authorise anything. ⚠️ A server-side join is exactly where that would quietly widen, because nothing on screen
 * would show it had. A tier that shows more needs bilateral consent, which supplier_list does not model.
 *
 * ⚠️ Declared BEFORE `/suppliers/:supplier_entity_id/...` so a literal path can never be read as an id.
 */
const AVAIL_CONCURRENCY = 6;      // enough to hide latency, low enough not to stampede our own DB
const AVAIL_HITS_PER_SUPPLIER = 6;
router.get('/suppliers/availability', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const q = String(req.query.q || '').trim().toLowerCase();
    /* Two characters, same floor as the panel. A one-letter query matches most catalogues and answers nothing. */
    if (q.length < 2) return res.json({ q, results: [], count: 0, searched: 0 });

    const sup = await query(
      /* ⚠️ The SAME columns the single-catalogue route selects. buildPublicView reads `business_status` for the
         shop block; selecting a narrower row here would build a subtly different view from the same resolver. */
      `SELECT sl.supplier_list_id, sl.nickname, sl.preferred,
              i.identity_id AS supplier_entity_id, i.bridge_id, i.user_id, i.display_name, i.currency_code,
              i.business_status,
              EXISTS (SELECT 1 FROM entity_schemas es
                      WHERE es.entity_id = i.identity_id
                        AND es.status = 'active' AND es.is_default = true) AS has_catalogue
         FROM supplier_list sl
         JOIN identities i ON i.identity_id = sl.supplier_entity_id
        WHERE sl.owner_entity_id = $1
          AND COALESCE(i.sealed, false) = false
        ORDER BY sl.preferred DESC, sl.created_at DESC`, [owner]);

    const viewer = req.identity && req.identity.bridge_id;
    const deps = { query, withEntity, catalogueBuild, orderInput,
      identity: require('../lib/identity'), catalogueRead: require('../lib/catalogue-read'),
      container: require('../lib/container'), visibilityCap: require('../lib/visibility-cap'), viewer };

    const matches = (p) => {
      const d = (p && p.item_data) || p || {};
      return ((d.name || d.product || '') + ' ' + (d.code || d.hsn || d.sku || '')).toLowerCase().indexOf(q) >= 0;
    };

    const one = async (s) => {
      const base = { supplier_list_id: s.supplier_list_id, supplier_entity_id: s.supplier_entity_id,
                     bridge_id: s.bridge_id, display_name: s.display_name, nickname: s.nickname,
                     preferred: s.preferred, currency: s.currency_code || null };
      if (!s.has_catalogue) return Object.assign(base, { state: 'nocat', hits: [] });
      try {
        const view = await catalogueView.buildPublicView(Object.assign({ entity: {
          identity_id: s.supplier_entity_id, display_name: s.display_name, bridge_id: s.bridge_id,
          currency_code: s.currency_code, business_status: s.business_status } }, deps));
        /* ⚠️ `available:false` is NOT `miss`. The schema exists but the shop is not showing — that is the same
           "cannot tell" as having published nothing, and reporting it as "does not stock it" would be a guess. */
        if (!view.available) return Object.assign(base, { state: 'nocat', hits: [] });
        const hits = (view.items || []).filter(matches);
        return Object.assign(base, {
          state: hits.length ? 'has' : 'miss',
          /* ⚠️ `currency_code`, not `currency` — that is the key buildPublicView emits (catalogue-view.js:288).
             Reading `.currency` would have silently fallen through to the identities column, which is usually
             the same value, so the mistake would have been invisible until a shop overrode it. */
          currency: (view.shop && view.shop.currency_code) || s.currency_code || null,
          total_items: (view.items || []).length,
          hits: hits.slice(0, AVAIL_HITS_PER_SUPPLIER).map((p) => {
            const d = (p && p.item_data) || p || {};
            return { item_id: p.item_id || null, name: d.name || d.product || 'item',
                     unit: d.unit || 'unit', price: d.price == null ? null : d.price,
                     code: d.code || d.sku || d.hsn || null };
          }),
          more: Math.max(0, hits.length - AVAIL_HITS_PER_SUPPLIER),
        });
      } catch (e) {
        /* ⚠️ One unreadable supplier must not fail the whole answer — the other forty are still worth having. */
        return Object.assign(base, { state: 'err', hits: [], error: safeErr(e) });
      }
    };

    /* Bounded concurrency: the client's version was strictly sequential, which is what made 50 suppliers slow. */
    const rows = sup.rows, results = new Array(rows.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(AVAIL_CONCURRENCY, rows.length) }, async () => {
      for (;;) {
        const i = next++; if (i >= rows.length) return;
        results[i] = await one(rows[i]);
      }
    }));

    res.json({ q, results, count: results.filter((r) => r && r.state === 'has').length, searched: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Supplier availability failed', message: safeErr(err) });
  }
});

// Fetch a supplier's catalogue (schema fields + products) to draft an order chit (D-059).
// Mirrors the PHP supplierCompose flow: select supplier -> see their catalogue -> compose.
router.get('/suppliers/:supplier_entity_id/catalogue', auth, async (req, res) => {
  try {
    const sid = req.params.supplier_entity_id;
    const sup = await query(
      `SELECT identity_id, display_name, bridge_id, currency_code, business_status
       FROM identities WHERE identity_id = $1 AND identity_type = 'entity' AND COALESCE(sealed, false) = false`, [sid]);
    const supplier = sup.rows[0] || null;
    if (!supplier) return res.json({ supplier: null, schema: null, fields: [], items: [], finishes: [] });
    // ── ONE CATALOGUE READ (SPEC-one-path-many-principals) ────────────────────────────────────────────────────
    // This used to be a second, older implementation of "read a catalogue": it returned only the supplier's OWN
    // catalogue_items and knew nothing of `finishes` (where published/adopted TEMPLATES live) or `order_input` (the
    // declaration), so a buyer could not even learn what a form asks for. Proven live by scripts/journey-supplier-hop.js.
    // It now calls the SAME resolver the public storefront uses, so a new surface is a new principal, not a new endpoint.
    //
    // ACCESS: this returns exactly the ANONYMOUS storefront payload — no more. That is deliberate and load-bearing:
    //   • GET /api/catalogue/:bridge_id is PUBLIC, so everything here is already world-readable; serving it to a
    //     logged-in entity adds ZERO exposure, and the F7 concern (reading another entity's catalogue via the :id in
    //     the URL) is satisfied by the fact that anyone could read it anonymously anyway.
    //   • Adding a supplier is UNILATERAL (POST /suppliers inserts with no consent from the supplier), so being
    //     "related" is SELF-ASSERTED and must NOT authorise anything beyond public. A tier that shows more needs
    //     bilateral consent, which supplier_list does not model. Do not add one until it does.
    const view = await catalogueView.buildPublicView({ entity: supplier, asOwner: (String(sid) === String(ctx(req))) /* an entity reading its OWN catalogue sees it whole — Record a sale, Our own stock (2026-09-05) */, query, withEntity, catalogueBuild, orderInput, identity: require('../lib/identity'), catalogueRead: require('../lib/catalogue-read'), container: require('../lib/container'), visibilityCap: require('../lib/visibility-cap'),
      // The reader, so a NETWORK-tier catalogue resolves for a fellow member. A supplier link alone still sees
      // exactly public — membership is decided by the network tree, not by this list.
      viewer: req.identity && req.identity.bridge_id,
      /* ⭐ AND WHO THEY ARE TO THIS SELLER (2026-09-06): customer-only offers reach a reader the SELLER's customer list names — the seller's
         own record of a trade or a placement, so the bilateral precondition above holds; a supplier link by itself still sees exactly public. */
      viewer_id: ctx(req) });
    if (!view.available) return res.json({ supplier, schema: null, fields: [], items: [], groups: [], finishes: [] });
    /* ⚠️ THE WHOLE VIEW, NOT A HAND-PICKED SUBSET (Athi, 2026-09-05: "still offer not appearing?"). This list named nine
       fields and left out `offers` and `categories`, so a buyer's Suppliers screen never received the seller's live offers
       while the storefront — the same view — did. One source of truth means one projection: everything the view says. */
    res.json(Object.assign({ supplier }, view));
  } catch (err) {
    res.status(500).json({ error: 'Get catalogue failed', message: safeErr(err) });
  }
});

// ── CUSTOMERS (auto-added — D-065; segment computed on read — D-067) ──

router.get('/customers', auth, async (req, res) => {
  try {
    const owner   = ctx(req);
    const segment = (req.query.segment || '').trim();
    // B1 RLS: customer_list is owner-scoped (owner_entity_id) -> withEntity(me).
    const r = await withEntity(owner, (db) => db.query(
      `SELECT cl.customer_list_id, cl.customer_type, cl.added_via,
              cl.txn_count, cl.last_txn_at,
              i.identity_id AS customer_identity_id, i.bridge_id, i.user_id, i.display_name,
              i.email, i.phone, i.otp_contact, i.created_at AS customer_since, i.identity_type, i.owner_scope,
              ${customerGroups.SEGMENT_SQL} AS segment
       FROM customer_list cl
       JOIN identities i ON i.identity_id = cl.customer_identity_id
       WHERE cl.owner_entity_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM supplier_list sl
           WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = cl.customer_identity_id
         )
       ORDER BY cl.last_txn_at DESC NULLS LAST`, [owner]));
    const rows = segment ? r.rows.filter(c => c.segment === segment) : r.rows;
    res.json({ customers: rows, count: rows.length });
  } catch (err) {
    console.error('Get customers error:', err.message);
    res.status(500).json({ error: 'Get customers failed', message: safeErr(err) });
  }
});

/**
 * ⭐ ADD A CUSTOMER BY HAND (Athi, 2026-09-06: "Chola Auto Care should be coming as a customer — can we add a + icon to include a customer?").
 * The list filled itself only from trades (storefront order, a bill, since today a Suppliers-menu order). A seller who knows their customer
 * before the first order — to give them an "Only for" offer — adds them here: resolved the way a supplier is (User ID · bridge id · email),
 * never yourself, 'manual', no transactions yet (segment reads "new" until the count says otherwise).
 */
router.post('/customers',
  [ body('handle').trim().notEmpty().withMessage('User ID, bridge ID or email required') ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req), handle = req.body.handle.trim();
      const who = await query(
        `SELECT identity_id, display_name, user_id, bridge_id FROM identities
          WHERE bridge_id = $1 OR LOWER(user_id) = LOWER($1) OR LOWER(email) = LOWER($1)
          LIMIT 1`, [handle]);
      if (who.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
      const c = who.rows[0];
      if (c.identity_id === owner) return res.status(400).json({ error: 'Invalid', message: 'Cannot add yourself' });
      const r = await withEntity(owner, (db) => db.query(
        `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
         VALUES ($1, $2, 'entity', 'manual', 0, NULL)
         ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING
         RETURNING customer_list_id`, [owner, c.identity_id]));
      if (r.rows.length === 0) return res.status(409).json({ error: 'Exists', message: 'Already in your customer list' });
      res.json({ message: 'Customer added', customer: { customer_list_id: r.rows[0].customer_list_id, customer_identity_id: c.identity_id, display_name: c.display_name, user_id: c.user_id, bridge_id: c.bridge_id, segment: 'new', added_via: 'manual' } });
    } catch (err) {
      console.error('Add customer error:', err.message);
      res.status(500).json({ error: 'Add customer failed', message: safeErr(err) });
    }
  });

// Manual segment override (optional)
router.patch('/customers/:id',
  [ body('segment_override').isIn(['high_value','regular','new','inactive']) ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req);
      const r = await withEntity(owner, (db) => db.query(
        `UPDATE customer_list SET segment_override = $1
         WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id`,
        [req.body.segment_override, req.params.id, owner]));
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Segment updated' });
    } catch (err) {
      res.status(500).json({ error: 'Update segment failed', message: safeErr(err) });
    }
  });

/**
 * ── COUNTERPARTY SCORECARD ──────────────────────────────────────────────────────────────────────────────────────
 * Athi, 2026-08-10, after the procurement research: build the counterparty scorecard.
 *
 * ⚠️ IT ASKS NOBODY FOR DATA, AND THAT IS THE WHOLE POINT. Every ERP supplier scorecard is built from ONE side's
 * records, which is why suppliers argue with them. Here both parties hold matching copies of every chit counted, so
 * the supplier can run the same arithmetic against their own rows and reach the same answer. A scorecard nobody can
 * dispute is a different object from a scorecard you have to defend.
 *
 * ⚠️ AND IT SCORES BEHAVIOUR, NOT WORTH — no single 0-100 grade. One number invites a ranking, a ranking invites a
 * decision, and that decision would rest on a weighting nobody agreed to. The components are reported instead.
 *
 * GET /api/relationships/scorecard            — everyone you have actually traded with
 * GET /api/relationships/scorecard/:entity_id — one counterparty, in depth
 */
const select  = require('../lib/select');
const measure = require('../lib/measure');
const policy  = require('../lib/policy');

router.get('/scorecard', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    // Derived from the CHITS, not from a saved supplier list: a supplier you have never traded with has nothing
    // to score, and a counterparty you trade with daily belongs here whether or not anyone added them.
    const list = await select.counterparties(me, { since: req.query.since });
    res.json({ counterparties: list, note: list.length ? undefined : 'no trades yet — nothing to score' });
  } catch (err) { res.status(500).json({ error: 'Scorecard list failed', message: safeErr(err) }); }
});

router.get('/scorecard/:entity_id', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const flags = await policy.get(me);            // overdue is a POLICY, never a constant baked into a report
    const rows = await select.rows(me, { counterparty_id: req.params.entity_id, since: req.query.since, limit: 5000 });
    const card = measure.scorecard(rows, { overdue_days: flags.overdue_days });
    res.json(Object.assign({ counterparty_id: req.params.entity_id, name: (rows[0] || {}).counterparty_name || null }, card));
  } catch (err) { res.status(500).json({ error: 'Scorecard failed', message: safeErr(err) }); }
});

module.exports = router;
