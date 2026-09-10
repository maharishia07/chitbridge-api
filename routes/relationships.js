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

/**
 * ⭐⭐ ADD A SUPPLIER — ON THE RAIL, OR JUST A NAME (b218).
 *
 * Athi, 2026-09-10: *"still a non-CB person can be a supplier, we can set the flag again — he is not part of CB?"*
 *
 * Two ways in, and the row remembers which:
 *   `supplier_bridge_id`  a ChitBridge business — User ID, bridge id or email. Their catalogue is callable, an
 *                         order can be sent, a delivery chit can arrive and be adopted.
 *   `name`                the hardware shop on the corner with a paper bill. Nothing to call, nothing to adopt —
 *                         purchases from them are RECORDED. Most of a small shop's suppliers are these.
 *
 * ⭐⭐⭐ AND A LOCAL SUPPLIER STILL GETS A REAL ID. Athi: *"still we need the user id, so we can attach item and so
 * on against that id. We create id internally, so the existing mechanism will not break."* Exactly right, and it
 * is why this route mints an identity instead of writing a NULL. `supplier_list.supplier_entity_id` carries a
 * foreign key; adoption, availability, purchases and spend all address a supplier BY ID. A null would have needed
 * a branch in every one of them — and every branch is a place the next query forgets to look.
 *
 * ⭐ AND HE IS AN ORDINARY ENTITY. Athi: *"follow the existing path — for all practical purposes he is a bridge
 * user. Only thing is he is not a recipient."* Same table, same identity_type, same bridge id, same joins. What
 * marks him is his HANDLE: `~acmetraders.corner-hardware`, where `~` means minted-not-registered (lib/handle.js).
 * The handle embeds the owner, so the unique index on lower(user_id) already gives one Corner Hardware per shop —
 * while two different shops may each have their own, which they must.
 *
 * ⚠️ "NOT A RECIPIENT" IS ENFORCED WHERE IT MATTERS, not here: the bridge path below refuses a `~` handle, so one
 * shop cannot add another shop's private supplier; the recipient resolver and the business search refuse them too.
 *
 * ⭐ `supply_kind` (b216) is INDEPENDENT of that. resale = goods you sell on; own_use = what the business consumes.
 * The two flags cross freely — a ChitBridge supplier can be your packaging supplier, and the corner shop can sell
 * you stock. The screen shows them as two tabs; adoption reads only supply_kind (lib/adopt.js).
 *
 * ⚠️ STILL UNILATERAL. Nobody is asked or notified, which is why the read tier stays at public storefront.
 */
router.post('/suppliers',
  [ body('supplier_bridge_id').optional({ nullable: true }).trim(),
    body('name').optional({ nullable: true }).trim().isLength({ max: 120 }),
    body('supply_kind').optional().isIn(['resale', 'own_use']).withMessage('supply_kind must be resale or own_use'),
    body('category').optional().trim().isLength({ max: 50 }),
    body('nickname').optional().trim().isLength({ max: 80 }),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean() ],
  validate, auth,
  async (req, res) => {
    try {
      const owner     = ctx(req);
      const bridge    = String(req.body.supplier_bridge_id || '').trim();
      const localName = sanitise(String(req.body.name || '').trim()) || null;
      const kind      = req.body.supply_kind === 'own_use' ? 'own_use' : 'resale';
      const category  = sanitise(req.body.category || '') || null;
      const nickname  = sanitise(req.body.nickname || '') || null;
      const notes     = sanitise(req.body.notes || '') || null;
      const preferred = req.body.preferred === true || req.body.preferred === 'true';

      if (!bridge && !localName)
        return res.status(400).json({ error: 'Invalid',
          message: 'Give a User ID or email for a ChitBridge business, or a name for a local supplier' });

      /* ⚠️⚠️ ANOTHER SHOP'S MINTED PARTY IS NOT ADDABLE. `~acmetraders.corner-hardware` resolves perfectly well by
         user_id — it is an ordinary entity row — so without this a competitor who guessed the handle could add
         acmetraders' private supplier to their own list. Who supplies you is a competitive fact, and the guess is
         not hard: the handle is the shop's own name plus their supplier's. */
      if (require('../lib/handle').isMinted(bridge))
        return res.status(404).json({ error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });

      /* ── OFF THE RAIL: a name, and an id minted for it. ─────────────────────────────────────────────────── */
      if (!bridge) {
        const local = await require('../lib/local-identity').mint(owner, localName, { query });
        if (local.error) return res.status(local.status).json(local.error);
        const dupL = await query(
          `SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`, [owner, local.identity_id]);
        if (dupL.rows.length > 0)
          return res.status(409).json({ error: 'Exists', message: localName + ' is already in your supplier list' });
        await query(
          /**
           * ⚠️ added_via = 'manual', NOT 'local'. `added_via` has a CHECK constraint (manual/transaction/import)
           * and 'local' failed it — a 500 that reached the screen as "Something went wrong", caught by [SUP-02]
           * on its first run.
           * ⭐ AND 'manual' IS ALSO THE RIGHT ANSWER, not just the permitted one. The column records HOW the row
           * arrived — a person typed it — which is true of both kinds. WHETHER they are on the rail is the
           * handle's job, and putting it here as well would be the same fact in two places, free to disagree.
           */
          `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind,
                                      category, nickname, notes, preferred, added_via)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')`,
          [owner, local.identity_id, kind, category, nickname, notes, preferred]);
        return res.json({ message: 'Supplier added',
          supplier: { supplier_entity_id: local.identity_id, bridge_id: local.bridge_id,
                      display_name: local.display_name, on_rail: false,
                      supply_kind: kind, category, nickname, notes, preferred } });
      }

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
        `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, category, nickname, notes, preferred, added_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')`,
        [owner, sup.rows[0].identity_id, kind, category, nickname, notes, preferred]);

      res.json({ message: 'Supplier added',
        supplier: { bridge_id: bridge, display_name: sup.rows[0].display_name, on_rail: true,
                    supply_kind: kind, category, nickname, notes, preferred } });
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
      /* ⭐ `on_rail` COMES FROM THE HANDLE — a `~` handle was minted by a business, never registered by a person
         (lib/handle.js). The row is an ordinary entity in every other respect, so the join and every downstream
         lookup stay exactly as they were; that was the point of minting a real id rather than writing a null. */
      `SELECT sl.supplier_list_id, sl.category, sl.nickname, sl.preferred, sl.notes, sl.created_at,
              COALESCE(sl.supply_kind, 'resale') AS supply_kind,
              (COALESCE(i.user_id, '') NOT LIKE '~%') AS on_rail,
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
    /* ⭐ WHAT EACH SUPPLIER GIVES ME, ON THE LIST (Athi, 2026-09-06: "the customer knows without even clicking — special discount for you").
       Per supplier: their live offers scoped to a group I am in or to me by name (lib/customer-groups), by the supplier's own names and the
       engine's promise. Read in parallel; a supplier whose read fails simply shows no tag. A stranger gets [] everywhere. */
    try {
      const cg = require('../lib/customer-groups'); const cv = require('../lib/catalogue-view'); const eng = require('../lib/offers-engine').CBOffers;
      await Promise.all(rows.map(async (o) => {
        /* ⚠️ A LOCAL SUPPLIER HAS NO OFFERS AND NEVER WILL — they are not on the platform. Asking anyway costs two
           reads per row and can only ever answer []; a shop whose suppliers are mostly local is exactly the shop
           that would feel it. Skipping is cheaper AND more honest than an empty answer that looks computed. */
        if (o.on_rail === false) { o.for_you = []; return; }
        try {
          const [groups, all] = await Promise.all([cg.groupsOf({ seller_id: o.supplier_entity_id, viewer_id: owner, withEntity }), cv.liveOffers({ entity_id: o.supplier_entity_id, withEntity, all: true })]);
          o.for_you = cg.offersFor(all, groups).filter((x) => x.customer_group).map((x) => { let p = null; try { p = eng && eng.promise ? eng.promise(x, { now: new Date(), money: (n) => '₹' + Number(n).toFixed(2), customer_groups: groups }) : null; } catch (_) {} return { label: x.label, promise: p || null, scope: x.scope || 'line', exclusive: !!x.exclusive }; });
        } catch (_) { o.for_you = []; }
      }));
    } catch (_) {}
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
    body('supply_kind').optional().isIn(['resale', 'own_use']).withMessage('supply_kind must be resale or own_use'),
    body('display_name').optional({ nullable: true }).trim().isLength({ max: 120 }),
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
      /* ⭐ Athi, 2026-09-10: *"while adding or may be later through edit set a flag — is he the supplier for my
         sales or is he the facilitator"*. Later matters: a shop learns what a supplier actually is by using them,
         and the first guess on the add form is often wrong. Moving the flag moves which tab they appear under and
         what a delivery from them does — a resale supplier's goods are OFFERED to the catalogue, an own_use
         supplier's never are (lib/adopt.js). ⚠️ It changes nothing already adopted; the past stays as it was. */
      if ('supply_kind' in req.body) { sets.push(`supply_kind = $${n++}`); vals.push(req.body.supply_kind === 'own_use' ? 'own_use' : 'resale'); }

      /**
       * ⭐⭐ RENAME A SUPPLIER YOU MINTED. Athi, 2026-09-10: *"user id we generate, but the shop name — they can
       * keep it as per the shop name. So internal id never gets mixed up."*
       *
       * ⭐ That is CB's three-names rule holding at a new kind of row, and it is why the id had to be a number
       * rather than a slug of the name: the HANDLE is generated and set once, the DISPLAY NAME is theirs and free
       * to change. Correcting "Corner Hardwre" to "Corner Hardware & Sons" moves nothing — not the id, not a
       * purchase, not a rupee of spend. A name-shaped handle would have frozen the typo into the identifier.
       *
       * ⚠️ ONLY FOR A PARTY THIS SHOP MINTED. Renaming a real ChitBridge business in their own row is not this
       * shop's to do — for those, `nickname` is the owner-side label and always has been.
       * ⚠️ A duplicate name is REFUSED by the b218 index rather than merged: two suppliers with one name is the
       * mix-up he is guarding against, and a silent merge would move history between two real records.
       */
      if ('display_name' in req.body && String(req.body.display_name || '').trim()) {
        const who = await query(
          `SELECT i.identity_id, i.user_id FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
            WHERE sl.supplier_list_id = $1 AND sl.owner_entity_id = $2`, [req.params.id, owner]);
        const row = who.rows[0];
        if (!row) return res.status(404).json({ error: 'Not found' });
        if (!require('../lib/handle').isMinted(row.user_id))
          return res.status(403).json({ error: 'Not yours',
            message: 'That is their own business name. Use "your name for them" instead.' });
        const nm = sanitise(String(req.body.display_name).trim().replace(/\s+/g, ' ')).slice(0, 120);
        try {
          await query(`UPDATE identities SET display_name = $1 WHERE identity_id = $2`, [nm, row.identity_id]);
        } catch (e) {
          if (e && e.code === '23505') return res.status(409).json({ error: 'Exists',
            message: 'You already have a supplier called ' + nm + '.' });
          throw e;
        }
        if (!sets.length) return res.json({ message: 'Supplier updated', display_name: nm });
      }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update', message: 'Provide nickname, category, notes, supply_kind, or preferred' });
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

/**
 * Remove from my list (does not affect the supplier).
 *
 * ⚠️ A LOCAL SUPPLIER'S IDENTITY IS DELIBERATELY LEFT BEHIND. Purchases, supply items and spend all point at that
 * id; deleting it would either break those references or silently orphan a year of history. Leaving it costs one
 * unreferenced row and buys something useful: re-adding the same name finds the same id again (local-identity.mint
 * looks before it mints), so the history reconnects instead of starting over.
 */
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
          /* ⚠️ NOT LOCAL SUPPLIERS (b218). "Who stocks this?" is answered by reading catalogues, and a local
             supplier has none — including them would spend a read per row to learn nothing and then report "no",
             which reads as "they don't stock it" rather than "we cannot ask them". Silence is the truer answer. */
          AND COALESCE(i.identity_type, 'entity') <> 'local'
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

/** the seller's named groups — for the Customers pane's chips and the offer editor's "Only for" picker. Before the customers/:id routes. */
router.get('/customers/groups', auth, async (req, res) => {
  try { res.json(await customerGroups.namesOf({ seller_id: ctx(req), withEntity })); }
  catch (err) { res.status(500).json({ error: 'Get groups failed', message: safeErr(err) }); }
});
router.get('/customers', auth, async (req, res) => {
  try {
    const owner   = ctx(req);
    const segment = (req.query.segment || '').trim();
    // B1 RLS: customer_list is owner-scoped (owner_entity_id) -> withEntity(me).
    /* the groups column may not be migrated yet: ask with it, and once more without on 42703 */
    let _g = true; const _run = () => withEntity(owner, (db) => db.query(
      `SELECT cl.customer_list_id, cl.customer_type, cl.added_via,
              cl.txn_count, cl.last_txn_at, ${_g ? 'cl.groups,' : ''}
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
    let r; try { r = await _run(); } catch (e) { if (e && e.code === '42703') { _g = false; r = await _run(); } else throw e; }
    const rows = (segment ? r.rows.filter(c => c.segment === segment) : r.rows).map((c) => Object.assign(c, { groups: Array.isArray(c.groups) ? c.groups : [] }));
    res.json({ customers: rows, count: rows.length, groups_migrated: _g });
  } catch (err) {
    console.error('Get customers error:', err.message);
    res.status(500).json({ error: 'Get customers failed', message: safeErr(err) });
  }
});

/**
 * ⭐⭐ WHAT THIS CUSTOMER HOLDS, AND WHAT IT MEANS.
 *
 * Athi, 2026-09-10: *"can we showcase rewards accumulated in customer and supplier screen? Otherwise how anyone
 * knows the value of the rewards and its interpretation."*
 *
 * ⭐ THE INTERPRETATION IS THE POINT, and it is why this returns sentences and a money value rather than a number.
 * "412 points" tells a shopkeeper nothing — it does not say what the shop owes, what the customer can do with it,
 * or whether it is about to disappear. So the answer carries: what the shop owes (the liability, at the declared
 * rate), what it converts into in the shop's own words, and how it was earned.
 *
 * ⚠️ THE LIABILITY IS THE SHOPKEEPER'S NUMBER, and it is a real one — points outstanding are money the shop has
 * promised and not yet paid. A screen that showed only the count would be hiding a debt from the person carrying it.
 */
router.get('/customers/:id/rewards', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const rewards = require('../lib/rewards');
    const store = require('../lib/reward-store');
    const holder = { scheme: 'identity', value: String(req.params.id || '') };
    if (!holder.value) return res.status(400).json({ error: 'validation', message: 'a customer id is required' });
    const b = await store.balance(owner, holder, withEntity);
    if (!b.programme) return res.json({ programme: null, points: 0,
      /* ⚠️ NOT AN ERROR AND NOT AN EMPTY BOX. Most shops run no programme; the pane says so plainly. */
      says: 'This shop does not run a points programme.' });
    /**
     * ⭐⭐ worthOf IS THE INTERPRETATION, and it already existed — it says what the balance is worth in money, what
     * it is already enough for, and what the NEXT reward is and how far off. I nearly wrote a second function for
     * this. Athi's standing rule is to reuse what CB already has rather than invent again, and this is exactly the
     * case it is aimed at: the answer was in the engine, one call away, better than what I would have written.
     * ⚠️ NO ctx.money HERE — a pure module has no currency, so the caller formats. The pane does it in the browser
     * where the shop's own locale is, and this returns the bare figure beside the sentence.
     */
    const w = rewards.worthOf(b.programme, b.points, {});
    res.json({
      programme: b.programme.name, points: b.points, worth: b.worth, negative: b.negative,
      earns: rewards.describeEarn(b.programme, {}),
      says: w.says, reach: w.reach, next: w.next, money_known: w.moneyKnown,
      expires_months: b.programme.expires_months || null,
      /* the last movements, so "where did those come from" has an answer on the same screen */
      recent: b.entries.slice(0, 12),
      expired_now: b.expired.reduce((a, e) => a + Math.abs(e.points), 0),
    });
  } catch (err) {
    /* ⚠️ BEFORE THE MIGRATION IS RUN the table does not exist, and a CRM pane must not break because of it */
    if (err && err.code === '42P01') return res.json({ programme: null, points: 0, says: 'Rewards are not switched on yet.' });
    console.error('Get customer rewards error:', err.message);
    res.status(500).json({ error: 'Get rewards failed', message: safeErr(err) });
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
      /* ⚠️ Same fence as the supplier add: a `~` handle is a party some OTHER business minted, and it resolves by
         user_id like any entity. Answer as if it does not exist rather than confirming the guess. */
      if (require('../lib/handle').isMinted(handle))
        return res.status(404).json({ error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
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

/**
 * ⭐ PLACE A CUSTOMER IN NAMED GROUPS (decision 2, 2026-09-06). POST /customers/:id/groups { groups: ['dealers', 'wholesale'] } replaces the
 * customer's set. Names are cleaned (customer-groups.cleanGroups). Without the migration the answer is 409 and says which file to run.
 */
router.post('/customers/:id/groups', auth, async (req, res) => {
  try {
    if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Sign in to place a customer in a group.' });
    const owner = ctx(req); const groups = customerGroups.cleanGroups(req.body && req.body.groups);
    const r = await withEntity(owner, (db) => db.query(`UPDATE customer_list SET groups = $1 WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id, groups`, [groups, req.params.id, owner]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, groups: r.rows[0].groups });
  } catch (err) {
    if (err && err.code === '42703') return res.status(409).json({ error: 'Not migrated', message: 'Named groups need the customer_groups migration (migrations/b205_customer_groups.sql) — run it in the Supabase SQL editor.' });
    res.status(500).json({ error: 'Set groups failed', message: safeErr(err) });
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
