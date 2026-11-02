/*
 * OWNS      supplier list, customer list and promotions.
 * CALLED BY web Suppliers · Customers.
 * FLOW      handle lookup (businesses only) → list row → numbered party
 * CARD      11-crm-and-marketing/relationships
 */
// routes/relationships.js — B3.6 Supplier List + Customer List + Promotions
// owns: /api/relationships — supplier list · customer list · promotions · scorecard routes
// called by: server.js (mounted at /api/relationships)
// FLOW  auth → validate → schema check (lib/relationships-contract.js) → withEntity → lib/crm · lib/local-identity (the add/remove paths); a refusal → problem(req, res, spec): the old keys beside the Problem fields
// CARD 11-crm-and-marketing/relationships-routes
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const log = require('../lib/logger');
/* SEC-FIX3 S5 — a handle lookup finds a BUSINESS only: not a storefront customer (<phone>@<shop>.cr, identity_type 'customer') and not an
   employee (name@shop.br, an actor) — both carry a parent entity. Otherwise adding one confirmed it and returned their phone/contact. */
const A_BUSINESS = `identity_type = 'entity' AND parent_entity_id IS NULL`;

const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity } = require('../db');
const { validateAsProblem, sanitise, schemaValidate, queryDay } = require('../middleware/validate');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { words, partyRefusal, mintRefusal, removeFault, failed, contract, schemaOptions, PARTY_KEYS } = require('../lib/relationships-contract'); // the contract (each route's operation), the words of a refusal and the party fields a PATCH may carry
const auth = require('../middleware/auth');
const { isOwner } = require('../lib/owner');
const catalogueView = require('../lib/catalogue-view'); // the SAME catalogue read the public storefront uses
const catalogueBuild = require('../lib/catalogue-build');
const customerGroups = require('../lib/customer-groups'); // the one segment expression + the viewer's groups
const orderInput = require('../lib/order-input');
/* ⭐ SPEC-books-v2 §4: the party fields (legal name, party no, credit days/limit, state, tax ids) live ON these lists */
const partyFields = require('../lib/party-fields');
const hasParty = (b, side) => PARTY_KEYS.some((item) => item in (b || {}) && !(side === 'supplier' && item === 'nickname'));
/** the party half of a PATCH: its own answer (404 / 409 / 400 in words) or null when the body carries none */
async function partyPatch(req, res, side) {
  if (!hasParty(req.body, side)) return null;
  const owner = ctx(req);
  try {
    return await withEntity(owner, (db) => partyFields.patch(db, owner, side, req.params.id, req.body, req.identity && req.identity.identity_id));
  } catch (e) {
    const refusal = partyRefusal(e); /* a held tax id · a refusal of the party fields · a unique violation: in the words they always had */
    if (!refusal) throw e;
    problem(req, res, refusal);
    return false;
  }
}
/**
 * ⭐ A PARTY IS NUMBERED WHEN IT IS ADDED (Athi, 2026-10-02: *"each customer / supplier will have a customer id, and it should
 * be used in ledger"*). party-fields.ensureNo — the one numbering path (series 'P', shared by both lists) — was reached only
 * by a field save, books setup or the nightly job, so a customer added today showed no number until tonight.
 * ⚠️ Never fails the add: before b272/b274 there is no series, and the nightly job still catches up. → the number, or null.
 */
async function numberParty(owner, party_id) {
  try {
    return await withEntity(owner, (db) => require('../db').trySavepoint(db, () => partyFields.ensureNo(db, owner, party_id), null));
  } catch (e) {
    log.fellBack('relationships numberParty: the read failed — answered with nothing', e);
    return null;
  }
}

// actors act in their parent entity's context
const ctx = (req) => auth.entityOf(req);
/** the schema check of one route (its own operation in lib/relationships-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}

// ── SUPPLIERS (no consent — D-056) ──────────────────────────

/**
 * RAIL-101 (NS-3), a step BEFORE the add: the address a person typed, pasted or scanned, when it names a business on ANOTHER installation.
 * lib/remote-party asks that installation (ctpaddress + ctpquery, the existing seams) and makes the local party row linked to it, then the ordinary add
 * carries on with that row's bridge id (req.body.supplier_bridge_id is rewritten to it; req.remoteShown adds the address to the answer).
 * A bare id or an e-mail passes through untouched; nothing is written unless the far end confirmed the business.
 */
async function remoteAddress(req, res, next) {
  const typed = String((req.body && req.body.supplier_bridge_id) || '').trim();
  if (!(/^https?:\/\//i.test(typed) || typed.includes('@'))) return next();
  try {
    const adopted = await require('../lib/remote-party').adopt(ctx(req), typed);
    if (adopted.error) return problem(req, res, words.remoteRefused(adopted.error));
    req.body.supplier_bridge_id = adopted.party ? adopted.party.bridge_id : adopted.bridge;
    if (adopted.party) req.remoteShown = { address: adopted.party.address, installation_key: adopted.party.installation_key };
    return next();
  } catch (failure) {
    console.error('Add supplier by address error:', failure.message);
    return problem(req, res, failed(failure, req, 'Add supplier failed'));
  }
}
remoteAddress.addsStatuses = words.ADDRESS_GATE_STATUSES; /* tools/api-register.cjs reads the statuses a gate answers from here */

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
router.post(
  '/suppliers',
  [
    body('supplier_bridge_id').optional({ nullable: true }).trim(),
    body('name').optional({ nullable: true }).trim().isLength({ max: 120 }),
    body('supply_kind').optional().isIn(['resale', 'own_use']).withMessage('supply_kind must be resale or own_use'),
    body('category').optional().trim().isLength({ max: 50 }),
    body('nickname').optional().trim().isLength({ max: 80 }),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean()
  ],
  auth,
  validateAsProblem,
  ...checked('POST /suppliers'),
  remoteAddress, /* RAIL-101 / NET-39: `bridge_id@domain` or a URL names a business on another installation — adopted as a stub here, then added like any other */
  async (req, res) => {
    try {
      const owner = ctx(req);
      const bridge = String(req.body.supplier_bridge_id || '').trim();
      const localName = sanitise(String(req.body.name || '').trim()) || null;
      const kind = req.body.supply_kind === 'own_use' ? 'own_use' : 'resale';
      const category = sanitise(req.body.category || '') || null;
      const nickname = sanitise(req.body.nickname || '') || null;
      const notes = sanitise(req.body.notes || '') || null;
      const preferred = req.body.preferred === true || req.body.preferred === 'true';

      if (!bridge && !localName)
        return problem(req, res, { status: 400, ...words.needSupplierParty() });

      /* ⚠️⚠️ ANOTHER SHOP'S MINTED PARTY IS NOT ADDABLE. `~acmetraders.corner-hardware` resolves perfectly well by
         user_id — it is an ordinary entity row — so without this a competitor who guessed the handle could add
         acmetraders' private supplier to their own list. Who supplies you is a competitive fact, and the guess is
         not hard: the handle is the shop's own name plus their supplier's. */
      if (require('../lib/handle').isMinted(bridge)) return problem(req, res, { status: 404, ...words.noBusiness() });

      /* ── OFF THE RAIL: a name, and an id minted for it. ─────────────────────────────────────────────────── */
      if (!bridge) {
        const local = await require('../lib/local-identity').mint(owner, localName, { query });
        if (local.error) return problem(req, res, mintRefusal(local));
        const dupL = await withEntity(owner, (db) =>
          db.query(`SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`, [owner, local.identity_id])
        );
        if (dupL.rows.length > 0) return problem(req, res, { status: 409, ...words.listed(localName + ' is already in your supplier list') });
        await withEntity(owner, (db) =>
          db.query(
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
            [owner, local.identity_id, kind, category, nickname, notes, preferred]
          )
        );
        const localNo = await numberParty(owner, local.identity_id);
        return res.json({
          message: 'Supplier added',
          supplier: {
            supplier_entity_id: local.identity_id,
            bridge_id: local.bridge_id,
            party_no: localNo,
            display_name: local.display_name,
            on_rail: false,
            supply_kind: kind,
            category,
            nickname,
            notes,
            preferred
          }
        });
      }

      // Resolve by bridge_id OR external user_id OR email — the panel prompts "User ID or email",
      // so bridge-id-only lookup would 404 those. (Matches the ATH-114 user_id resolution.)
      const sup = await query(
        `SELECT identity_id, display_name FROM identities
         WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1) OR LOWER(email) = LOWER($1)) AND ${A_BUSINESS}
         LIMIT 1`,
        [bridge]
      );
      if (sup.rows.length === 0) return problem(req, res, { status: 404, ...words.noBusiness() });
      if (sup.rows[0].identity_id === owner) return problem(req, res, { status: 400, ...words.addSelf() });

      const dup = await withEntity(owner, (db) =>
        db.query(`SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`, [owner, sup.rows[0].identity_id])
      );
      if (dup.rows.length > 0) return problem(req, res, { status: 409, ...words.listed('Already in your supplier list') });

      await withEntity(owner, (db) =>
        db.query(
          `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, category, nickname, notes, preferred, added_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')`,
          [owner, sup.rows[0].identity_id, kind, category, nickname, notes, preferred]
        )
      );

      /* ⭐ ON THE RAIL WAS ASSERTED, NOW ASKED (2026-10-02): an inactive business, or one in another sandbox, is found by
         the lookup above but cannot trade with this shop — lib/istest mayTrade, b249's rule. Added anyway (the list is the
         shop's), but it says so now rather than at the first order. */
      const trade = await require('../lib/istest').mayTrade(owner, sup.rows[0].identity_id);
      const supNo = await numberParty(owner, sup.rows[0].identity_id);
      res.json({
        message: trade.ok ? 'Supplier added' : 'Supplier added — orders to them stay here only: ' + trade.why,
        supplier: {
          supplier_entity_id: sup.rows[0].identity_id, bridge_id: bridge, ...req.remoteShown, /* API-6 (25 Oct): the id the list and the catalogue read are addressed by, on every add · RAIL-101: the address, when the supplier was adopted from one */
          display_name: sup.rows[0].display_name,
          on_rail: !!trade.ok,
          party_no: supNo,
          ...(trade.ok ? {} : { one_sided: { why: trade.why } }),
          supply_kind: kind,
          category,
          nickname,
          notes,
          preferred
        }
      });
    } catch (err) {
      problem(req, res, failed(err, req, 'Add supplier failed'));
    }
  }
);

/** GET /suppliers: my supplier list with the facts the screen reads, on the connection withEntity hands out (RLS). One statement; the notes say why each column is there. */
function listSuppliers(db, owner) {
  return db.query(
        /* ⭐ `on_rail` COMES FROM THE HANDLE — a `~` handle was minted by a business, never registered by a person
         (lib/handle.js). The row is an ordinary entity in every other respect, so the join and every downstream
         lookup stay exactly as they were; that was the point of minting a real id rather than writing a null. */
        `SELECT sl.supplier_list_id, sl.category, sl.nickname, sl.preferred, sl.notes, sl.created_at,
              COALESCE(sl.supply_kind, 'resale') AS supply_kind,
              /* ⭐ lib/istest mayTradeSql — the ONE rule (b249 + on the rail); this was a second, handle-only copy of it */
              ${require('../lib/istest').mayTradeSql('i', '$1')} AS on_rail,
              i.bridge_id, i.user_id, i.display_name, i.identity_id AS supplier_entity_id,
              i.gstn, i.country, i.policy_flags, i.currency_code AS supplier_money,
              /* NET-39 (walk W6, 2026-10-25): a supplier on ANOTHER installation keeps its catalogue there, so no local schema
                 row exists; it counts as "has a catalogue — ask them", and GET /suppliers/:id/catalogue asks the far side
                 (lib/remote-catalogue), which answers what is published and whether it is shown outside (trade_mode export). */
              (EXISTS (SELECT 1 FROM entity_schemas es
                      WHERE es.entity_id = i.identity_id
                        AND es.status = 'active' AND es.is_default = true)
               OR ops.f_installation_of(i.identity_id) IS DISTINCT FROM ops.f_installation_of($1)) AS has_catalogue,
              /* API-6 (network owner, 25 Oct): WHERE the supplier lives, named only when it is another installation (null here), with that installation's label.
                 The web's money-promise confirm before a cross-installation send (supCrossParty → CBQuotes.askCross) decides "far" from it: a stub made from an
                 address carries no country or currency, so without this the confirm never fired (browser R16 on SIT). */
              CASE WHEN ops.f_installation_of(i.identity_id) IS DISTINCT FROM ops.f_installation_of($1) THEN ops.f_installation_of(i.identity_id) END AS installation_key,
              CASE WHEN ops.f_installation_of(i.identity_id) IS DISTINCT FROM ops.f_installation_of($1)
                   THEN (SELECT inst.label FROM installation inst WHERE inst.installation_key = ops.f_installation_of(i.identity_id)) END AS installation_label
       FROM supplier_list sl
       JOIN identities i ON i.identity_id = sl.supplier_entity_id
       WHERE sl.owner_entity_id = $1
       ORDER BY sl.preferred DESC, sl.created_at DESC`,
    [owner]
  );
}

// List my suppliers — has_catalogue reflects an active default schema only
router.get('/suppliers', auth, ...checked('GET /suppliers'), async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await withEntity(owner, (db) => listSuppliers(db, owner));
    /* ⭐ the public facts with their rung (lib/public-facts.js) — the row's raw flags never leave the server */
    const { factsOf } = require('../lib/public-facts');
    const rows = r.rows.map((x) => {
      const facts = factsOf(x);
      const o = Object.assign({}, x);
      delete o.policy_flags;
      delete o.gstn;
      o.facts = facts;
      return o;
    });
    /* ⭐ WHAT EACH SUPPLIER GIVES ME, ON THE LIST (Athi, 2026-09-06: "the customer knows without even clicking — special discount for you").
       Per supplier: their live offers scoped to a group I am in or to me by name (lib/customer-groups), by the supplier's own names and the
       engine's promise. Read in parallel; a supplier whose read fails simply shows no tag. A stranger gets [] everywhere. */
    try {
      const cg = require('../lib/customer-groups');
      const cv = require('../lib/catalogue-view');
      const eng = require('../lib/offers-engine').CBOffers;
      await Promise.all(
        rows.map(async (item) => {
          /* ⚠️ A LOCAL SUPPLIER HAS NO OFFERS AND NEVER WILL — they are not on the platform. Asking anyway costs two
           reads per row and can only ever answer []; a shop whose suppliers are mostly local is exactly the shop
           that would feel it. Skipping is cheaper AND more honest than an empty answer that looks computed. */
          if (item.on_rail === false) {
            item.for_you = [];
            return;
          }
          try {
            const [groups, all] = await Promise.all([
              cg.groupsOf({ seller_id: item.supplier_entity_id, viewer_id: owner, withEntity }),
              cv.liveOffers({ entity_id: item.supplier_entity_id, withEntity, all: true })
            ]);
            item.for_you = cg
              .offersFor(all, groups)
              .filter((x) => x.customer_group)
              .map((x) => {
                let p = null;
                try {
                  p =
                    eng && eng.promise ? eng.promise(x, { now: new Date(), money: (n) => offerMoney(n, item.supplier_money), customer_groups: groups }) : null;
                } catch (e) {
                  log.fellBack('relationships GET /suppliers: did not parse — carried on without it', e, 'debug');
                }
                return { label: x.label, promise: p || null, scope: x.scope || 'line', exclusive: !!x.exclusive };
              });
          } catch (e) {
            log.fellBack('relationships GET /suppliers: did not parse — answered with none', e, 'debug');
            item.for_you = [];
          }
        })
      );
    } catch (e) {
      log.fellBack('relationships GET /suppliers: did not parse — carried on without it', e, 'debug');
    }
    for (const row of rows) delete row.supplier_money; /* read above for the supplier's own offer wording; not part of the answer */
    await partyFields.decorate(withEntity, owner, rows, 'supplier_entity_id', 'supplier');
    res.json(Object.assign({ count: rows.length }, PL.pageOut('suppliers', rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    problem(req, res, failed(err, req, 'Get suppliers failed'));
  }
});

// Update owner-side fields on a supplier relationship — your naming / preferred / notes / category.
// Does NOT touch the supplier's own entity (that's theirs). Only the fields the owner controls.
router.patch(
  '/suppliers/:id',
  [
    body('nickname').optional({ nullable: true }).trim().isLength({ max: 80 }),
    body('category').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    body('supply_kind').optional().isIn(['resale', 'own_use']).withMessage('supply_kind must be resale or own_use'),
    body('display_name').optional({ nullable: true }).trim().isLength({ max: 120 }),
    body('preferred').optional().isBoolean()
  ],
  auth,
  validateAsProblem,
  ...checked('PATCH /suppliers/:id'),
  async (req, res) => {
    try {
      const owner = ctx(req);
      const party = await partyPatch(req, res, 'supplier');
      if (party === false) return;
      const sets = [],
        vals = [];
      let index = 1;
      if ('nickname' in req.body) {
        sets.push(`nickname = $${index++}`);
        vals.push(sanitise(req.body.nickname || '') || null);
      }
      if ('category' in req.body) {
        sets.push(`category = $${index++}`);
        vals.push(sanitise(req.body.category || '') || null);
      }
      if ('notes' in req.body) {
        sets.push(`notes = $${index++}`);
        vals.push(sanitise(req.body.notes || '') || null);
      }
      if ('preferred' in req.body) {
        sets.push(`preferred = $${index++}`);
        vals.push(req.body.preferred === true || req.body.preferred === 'true');
      }
      /* ⭐ Athi, 2026-09-10: *"while adding or may be later through edit set a flag — is he the supplier for my
         sales or is he the facilitator"*. Later matters: a shop learns what a supplier actually is by using them,
         and the first guess on the add form is often wrong. Moving the flag moves which tab they appear under and
         what a delivery from them does — a resale supplier's goods are OFFERED to the catalogue, an own_use
         supplier's never are (lib/adopt.js). ⚠️ It changes nothing already adopted; the past stays as it was. */
      if ('supply_kind' in req.body) {
        sets.push(`supply_kind = $${index++}`);
        vals.push(req.body.supply_kind === 'own_use' ? 'own_use' : 'resale');
      }

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
        const who = await withEntity(owner, (db) =>
          db.query(
            `SELECT i.identity_id, i.user_id FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
            WHERE sl.supplier_list_id = $1 AND sl.owner_entity_id = $2`,
            [req.params.id, owner]
          )
        );
        const row = who.rows[0];
        if (!row) return problem(req, res, { status: 404, ...words.notFound() });
        if (!require('../lib/handle').isMinted(row.user_id)) return problem(req, res, { status: 403, ...words.notYours() });
        const nm = sanitise(String(req.body.display_name).trim().replace(/\s+/g, ' ')).slice(0, 120);
        try {
          await query(`UPDATE identities SET display_name = $1 WHERE identity_id = $2`, [nm, row.identity_id]);
        } catch (e) {
          if (e && e.code === '23505') return problem(req, res, { status: 409, ...words.listed('You already have a supplier called ' + nm + '.') });
          throw e;
        }
        if (!sets.length) return res.json({ message: 'Supplier updated', display_name: nm });
      }
      if (!sets.length && party) return res.json({ message: 'Supplier updated', party });
      if (!sets.length) return problem(req, res, { status: 400, ...words.nothingToUpdate('Provide nickname, category, notes, supply_kind, or preferred') });
      vals.push(req.params.id, owner);
      const r = await withEntity(owner, (db) =>
        db.query(
          `UPDATE supplier_list SET ${sets.join(', ')}
         WHERE supplier_list_id = $${index++} AND owner_entity_id = $${index} RETURNING supplier_list_id`,
          vals
        )
      );
      if (r.rows.length === 0) return problem(req, res, { status: 404, ...words.notFound() });
      res.json({ message: 'Supplier updated', ...(party ? { party } : {}) });
    } catch (err) {
      problem(req, res, failed(err, req, 'Update failed'));
    }
  }
);

/**
 * Remove from my list (does not affect the supplier).
 *
 * ⚠️ A LOCAL SUPPLIER'S IDENTITY IS DELIBERATELY LEFT BEHIND. Purchases, supply items and spend all point at that
 * id; deleting it would either break those references or silently orphan a year of history. Leaving it costs one
 * unreferenced row and buys something useful: re-adding the same name finds the same id again (local-identity.mint
 * looks before it mints), so the history reconnects instead of starting over.
 */
router.delete('/suppliers/:id', auth, ...checked('DELETE /suppliers/:id'), async (req, res) => {
  try {
    /* R8: owner only, refused with money open, and it HIDES (CRM's own remove) — a staff login can no longer delete a supplier the shop owes */
    if (!isOwner(req)) return problem(req, res, { status: 403, ...words.ownerOnly() });
    const owner = ctx(req);
    const row = await withEntity(owner, (db) =>
      db.query(`SELECT supplier_entity_id FROM supplier_list WHERE supplier_list_id = $1 AND owner_entity_id = $2`, [req.params.id, owner])
    );
    if (row.rows.length === 0) return problem(req, res, { status: 404, ...words.notFound() });
    await require('../lib/crm').removeParty(owner, row.rows[0].supplier_entity_id);
    res.json({ message: 'Supplier removed' });
  } catch (err) {
    problem(req, res, removeFault(err, req)); /* a refusal of the CRM's own remove keeps its status, code and sentence; anything else is the 500 it always was */
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
const AVAIL_CONCURRENCY = 6; // enough to hide latency, low enough not to stampede our own DB
const AVAIL_HITS_PER_SUPPLIER = 6;
router.get('/suppliers/availability', auth, ...checked('GET /suppliers/availability'), async (req, res) => {
  try {
    const owner = ctx(req);
    const text = String(req.query.q || '')
      .trim()
      .toLowerCase();
    /* Two characters, same floor as the panel. A one-letter query matches most catalogues and answers nothing. */
    if (text.length < 2) return res.json({ q: text, results: [], count: 0, searched: 0 });

    const sup = await withEntity(owner, (db) =>
      db.query(
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
        ORDER BY sl.preferred DESC, sl.created_at DESC`,
        [owner]
      )
    );

    const viewer = req.identity && req.identity.bridge_id;
    const deps = {
      query,
      withEntity,
      catalogueBuild,
      orderInput,
      identity: require('../lib/identity'),
      catalogueRead: require('../lib/catalogue-read'),
      container: require('../lib/container'),
      visibilityCap: require('../lib/visibility-cap'),
      viewer
    };

    /* NET-39: ONE product matcher, shared with the cross-installation search (lib/business-search) */
    const matches = (p) => require('../lib/business-search').productMatches(p, text);

    const one = async (s) => {
      const base = {
        supplier_list_id: s.supplier_list_id,
        supplier_entity_id: s.supplier_entity_id,
        bridge_id: s.bridge_id,
        display_name: s.display_name,
        nickname: s.nickname,
        preferred: s.preferred,
        currency: s.currency_code || null
      };
      if (!s.has_catalogue) return Object.assign(base, { state: 'nocat', hits: [] });
      try {
        const view = await catalogueView.buildPublicView(
          Object.assign(
            {
              entity: {
                identity_id: s.supplier_entity_id,
                display_name: s.display_name,
                bridge_id: s.bridge_id,
                currency_code: s.currency_code,
                business_status: s.business_status
              }
            },
            deps
          )
        );
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
          hits: hits.slice(0, AVAIL_HITS_PER_SUPPLIER).map((item) => {
            const d = (item && item.item_data) || item || {};
            return {
              item_id: item.item_id || null,
              name: d.name || d.product || 'item',
              unit: d.unit || 'unit',
              price: d.price == null ? null : d.price,
              code: d.code || d.sku || d.hsn || null
            };
          }),
          more: Math.max(0, hits.length - AVAIL_HITS_PER_SUPPLIER)
        });
      } catch (e) {
        /* ⚠️ One unreadable supplier must not fail the whole answer — the other forty are still worth having. */
        return Object.assign(base, { state: 'err', hits: [], error: safeErr(e) });
      }
    };

    /* Bounded concurrency: the client's version was strictly sequential, which is what made 50 suppliers slow. */
    const rows = sup.rows,
      results = new Array(rows.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(AVAIL_CONCURRENCY, rows.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= rows.length) return;
          results[i] = await one(rows[i]);
        }
      })
    );

    res.json(
      Object.assign(
        { q: text, count: results.filter((item) => item && item.state === 'has').length, searched: rows.length },
        PL.pageOut('results', results, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))
      )
    );
  } catch (err) {
    problem(req, res, failed(err, req, 'Supplier availability failed'));
  }
});

// Fetch a supplier's catalogue (schema fields + products) to draft an order chit (D-059).
// Mirrors the PHP supplierCompose flow: select supplier -> see their catalogue -> compose.
router.get('/suppliers/:supplier_entity_id/catalogue', auth, ...checked('GET /suppliers/:supplier_entity_id/catalogue'), async (req, res) => {
  try {
    const sid = req.params.supplier_entity_id;
    /* SEC-91: a shop reads a supplier's catalogue only from ITS OWN supplier list (or its own); a stranger and an unknown id get the same refusal, so no name or id of anyone else comes back */
    const linked = String(sid) === String(ctx(req)) || (await withEntity(ctx(req), (db) => db.query(`SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`, [ctx(req), sid]))).rows.length > 0;
    if (!linked) return problem(req, res, { status: 404, ...words.notOnYourList() });
    const sup = await query(
      `SELECT identity_id, display_name, bridge_id, currency_code, business_status
       FROM identities WHERE identity_id = $1 AND identity_type = 'entity' AND COALESCE(sealed, false) = false`,
      [sid]
    );
    const supplier = sup.rows[0] || null;
    if (!supplier) return problem(req, res, { status: 404, ...words.notOnYourList() });
    /* NET-39: a supplier on ANOTHER installation is a stub row here; its catalogue is the seller's own public view, asked for over the signed door */
    const remote = await require('../lib/remote-catalogue').forSupplier(supplier);
    if (remote) return res.json(remote);
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
    const view = await catalogueView.buildPublicView({
      entity: supplier,
      asOwner: String(sid) === String(ctx(req)) /* an entity reading its OWN catalogue sees it whole — Record a sale, Our own stock (2026-09-05) */,
      query,
      withEntity,
      catalogueBuild,
      orderInput,
      identity: require('../lib/identity'),
      catalogueRead: require('../lib/catalogue-read'),
      container: require('../lib/container'),
      visibilityCap: require('../lib/visibility-cap'),
      // The reader, so a NETWORK-tier catalogue resolves for a fellow member. A supplier link alone still sees
      // exactly public — membership is decided by the network tree, not by this list.
      viewer: req.identity && req.identity.bridge_id,
      /* ⭐ AND WHO THEY ARE TO THIS SELLER (2026-09-06): customer-only offers reach a reader the SELLER's customer list names — the seller's
         own record of a trade or a placement, so the bilateral precondition above holds; a supplier link by itself still sees exactly public. */
      viewer_id: ctx(req)
    });
    if (!view.available) return res.json({ supplier, schema: null, fields: [], items: [], groups: [], finishes: [] });
    /* ⚠️ THE WHOLE VIEW, NOT A HAND-PICKED SUBSET (Athi, 2026-09-05: "still offer not appearing?"). This list named nine
       fields and left out `offers` and `categories`, so a buyer's Suppliers screen never received the seller's live offers
       while the storefront — the same view — did. One source of truth means one projection: everything the view says. */
    res.json(Object.assign({ supplier }, view));
  } catch (err) {
    problem(req, res, failed(err, req, 'Get catalogue failed'));
  }
});

// ── CUSTOMERS (auto-added — D-065; segment computed on read — D-067) ──

/** the seller's named groups — for the Customers pane's chips and the offer editor's "Only for" picker. Before the customers/:id routes. */
router.get('/customers/groups', auth, async (req, res) => {
  try {
    res.json(await customerGroups.namesOf({ seller_id: ctx(req), withEntity }));
  } catch (err) {
    problem(req, res, failed(err, req, 'Get groups failed'));
  }
});
router.get('/customers', auth, ...checked('GET /customers'), async (req, res) => {
  try {
    const owner = ctx(req);
    const segment = (req.query.segment || '').trim();
    // B1 RLS: customer_list is owner-scoped (owner_entity_id) -> withEntity(me).
    /* the groups column may not be migrated yet: ask with it, and once more without on 42703 */
    let _g = true,
      _seg = customerGroups.SEGMENT_SQL;
    const _run = () =>
      withEntity(owner, (db) =>
        db.query(
          `SELECT cl.customer_list_id, cl.customer_type, cl.added_via,
              cl.txn_count, cl.last_txn_at, ${_g ? 'cl.groups,' : ''}
              i.identity_id AS customer_identity_id, i.bridge_id, i.user_id, i.display_name,
              i.email, i.phone, i.otp_contact, i.created_at AS customer_since, i.identity_type, i.owner_scope,
              ${_seg} AS segment,
              /* ⭐ can bills reach them (lib/istest mayTradeSql, b249's rule) — the CRM table's "one-sided" mark */
              ${require('../lib/istest').mayTradeSql('i', '$1')} AS on_rail
       FROM customer_list cl
       JOIN identities i ON i.identity_id = cl.customer_identity_id
       WHERE cl.owner_entity_id = $1
         AND ${customerGroups.NOT_A_SUPPLIER_SQL}
       ORDER BY cl.last_txn_at DESC NULLS LAST`,
          [owner]
        )
      );
    /* no party_item yet (42P01) → the segment without high_value, as before b273 */
    let r;
    for (let count = 0; !r && count < 3; count++) {
      try {
        r = await _run();
      } catch (e) {
        if (e && e.code === '42703' && _g) _g = false;
        else if (e && e.code === '42P01' && _seg !== customerGroups.SEGMENT_SQL_BASE) _seg = customerGroups.SEGMENT_SQL_BASE;
        else throw e;
      }
    }
    const rows = (segment ? r.rows.filter((item) => item.segment === segment) : r.rows).map((item) =>
      Object.assign(item, { groups: Array.isArray(item.groups) ? item.groups : [] })
    );
    await partyFields.decorate(withEntity, owner, rows, 'customer_identity_id', 'customer');
    res.json(Object.assign({ count: rows.length, groups_migrated: _g }, PL.pageOut('customers', rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    problem(req, res, failed(err, req, 'Get customers failed'));
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
router.get('/customers/:id/rewards', auth, ...checked('GET /customers/:id/rewards'), async (req, res) => {
  try {
    const owner = ctx(req);
    const rewards = require('../lib/rewards');
    const store = require('../lib/reward-store');
    const holder = { scheme: 'identity', value: String(req.params.id || '') };
    if (!holder.value) return problem(req, res, { status: 400, ...words.needCustomerId() });
    const b = await store.balance(owner, holder, withEntity);
    if (!b.programme)
      return res.json({
        programme: null,
        points: 0,
        /* ⚠️ NOT AN ERROR AND NOT AN EMPTY BOX. Most shops run no programme; the pane says so plainly. */
        says: 'This shop does not run a points programme.'
      });
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
      programme: b.programme.name,
      points: b.points,
      worth: b.worth,
      negative: b.negative,
      earns: rewards.describeEarn(b.programme, {}),
      says: w.says,
      reach: w.reach,
      next: w.next,
      money_known: w.moneyKnown,
      expires_months: b.programme.expires_months || null,
      /* the last movements, so "where did those come from" has an answer on the same screen */
      recent: b.entries.slice(0, 12),
      expired_now: b.expired.reduce((total, e) => total + Math.abs(e.points), 0)
    });
  } catch (err) {
    /* ⚠️ BEFORE THE MIGRATION IS RUN the table does not exist, and a CRM pane must not break because of it */
    if (err && err.code === '42P01') return res.json({ programme: null, points: 0, says: 'Rewards are not switched on yet.' });
    problem(req, res, failed(err, req, 'Get rewards failed'));
  }
});

/**
 * ⭐ ADD A CUSTOMER BY HAND (Athi, 2026-09-06: "Chola Auto Care should be coming as a customer — can we add a + icon to include a customer?").
 * The list filled itself only from trades (storefront order, a bill, since today a Suppliers-menu order). A seller who knows their customer
 * before the first order — to give them an "Only for" offer — adds them here: resolved the way a supplier is (User ID · bridge id · email),
 * never yourself, 'manual', no transactions yet (segment reads "new" until the count says otherwise).
 */
router.post(
  '/customers',
  [
    body('handle').optional().trim(),
    body('name').optional().trim(),
    body().custom((b) => {
      if (!String((b && b.handle) || '').trim() && !String((b && b.name) || '').trim())
        throw new Error('Give a User ID or email for a ChitBridge business, or a name for a local customer');
      return true;
    })
  ],
  auth,
  validateAsProblem,
  ...checked('POST /customers'),
  async (req, res) => {
    try {
      const owner = ctx(req),
        handle = String(req.body.handle || '').trim();
      /* ⭐⭐ A NAME, NOT AN ID (Athi, 2026-10-02): a walk-in regular who is not on ChitBridge. The counter allows On credit only for a
         customer the shop KNOWS (till.html custKnown), and the snapshot lists every customer_list row — so a named row is what makes
         credit possible. The supplier door's own path: lib/local-identity.mint (kind 'cus') gives an ordinary entity row with a
         `~owner.cus-nnnn` handle, never a recipient (handle.isMinted), so a bill to them is one-sided: recorded and booked, not sent. */
      if (!handle) {
        const localName = sanitise(String(req.body.name || '').trim());
        const L = require('../lib/local-identity');
        const ph = L.phoneOf(req.body.phone); /* ⭐ CRM-MINT1: the one phone check (it was 6–20 characters here, ≥ 8 digits everywhere else) */
        if (ph.bad) return problem(req, res, { status: 400, ...words.badPhone() });
        const phone = ph.phone;
        /* ⭐ phone and GSTIN go where the till's customer query already reads them: identities.otp_contact (as phone) and .gstn —
           no schema change. Nothing looks an identity up BY otp_contact, so a minted row cannot be reached through it. */
        const gstin = sanitise(String(req.body.gstin || ''))
          .replace(/\s+/g, '')
          .toUpperCase();
        /* ⭐ CRM-MINT1: mint · contact · list row · number — the one add-customer, one transaction */
        const a = await withEntity(owner, (h) => L.addCustomer(h, owner, { name: localName, phone, gstin, via: 'manual' }));
        if (a.refused) return problem(req, res, mintRefusal(a.refused));
        if (a.exists) return problem(req, res, { status: 409, ...words.listed(L.existsWords(a, localName + ' is already in your customer list')) });
        const local = a.local;
        const why = 'not on ChitBridge — bills stay with you';
        return res.json({
          message: 'Customer added — ' + why,
          customer: {
            customer_list_id: a.customer_list_id,
            customer_identity_id: local.identity_id,
            display_name: local.display_name,
            user_id: local.user_id,
            bridge_id: local.bridge_id,
            segment: 'new',
            added_via: 'manual',
            party_no: a.party_no,
            phone: phone || null,
            gstin: gstin || null,
            on_rail: false,
            one_sided: { why }
          }
        });
      }
      /* ⚠️ Same fence as the supplier add: a `~` handle is a party some OTHER business minted, and it resolves by
         user_id like any entity. Answer as if it does not exist rather than confirming the guess. */
      if (require('../lib/handle').isMinted(handle)) return problem(req, res, { status: 404, ...words.noBusiness() });
      const who = await query(
        `SELECT identity_id, display_name, user_id, bridge_id FROM identities
          WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1) OR LOWER(email) = LOWER($1)) AND ${A_BUSINESS}
          LIMIT 1`,
        [handle]
      );
      if (who.rows.length === 0) return problem(req, res, { status: 404, ...words.noBusiness() });
      const c = who.rows[0];
      if (c.identity_id === owner) return problem(req, res, { status: 400, ...words.addSelf() });
      const r = await withEntity(owner, (db) =>
        db.query(
          `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
         VALUES ($1, $2, 'entity', 'manual', 0, NULL)
         ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING
         RETURNING customer_list_id`,
          [owner, c.identity_id]
        )
      );
      if (r.rows.length === 0) return problem(req, res, { status: 409, ...words.listed('Already in your customer list') });
      /* ⭐ ADDED, AND TOLD WHETHER BILLS CAN REACH THEM (Athi, 2026-10-02 — two bills sat pending for customers this door let
         in without a word). lib/istest mayTrade, b249's rule: inactive or another sandbox → the sale is still recorded and
         booked, only their copy is not sent. Said here, before the first bill, not discovered at the counter. */
      const trade = await require('../lib/istest').mayTrade(owner, c.identity_id);
      const custNo = await numberParty(owner, c.identity_id);
      res.json({
        message: trade.ok ? 'Customer added' : 'Customer added — bills to them stay here only: ' + trade.why,
        customer: {
          customer_list_id: r.rows[0].customer_list_id,
          customer_identity_id: c.identity_id,
          display_name: c.display_name,
          user_id: c.user_id,
          bridge_id: c.bridge_id,
          segment: 'new',
          added_via: 'manual',
          party_no: custNo,
          on_rail: !!trade.ok,
          ...(trade.ok ? {} : { one_sided: { why: trade.why } })
        }
      });
    } catch (err) {
      problem(req, res, failed(err, req, 'Add customer failed'));
    }
  }
);

/**
 * ⭐ PLACE A CUSTOMER IN NAMED GROUPS (decision 2, 2026-09-06). POST /customers/:id/groups { groups: ['dealers', 'wholesale'] } replaces the
 * customer's set. Names are cleaned (customer-groups.cleanGroups). Without the migration the answer is 409 and says which file to run.
 */
router.post('/customers/:id/groups', auth, ...checked('POST /customers/:id/groups'), async (req, res) => {
  try {
    if (req.api_key) return problem(req, res, { status: 403, ...words.keyFence() });
    const owner = ctx(req);
    const groups = customerGroups.cleanGroups(req.body && req.body.groups);
    const r = await withEntity(owner, (db) =>
      db.query(`UPDATE customer_list SET groups = $1 WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id, groups`, [
        groups,
        req.params.id,
        owner
      ])
    );
    if (!r.rows.length) return problem(req, res, { status: 404, ...words.notFound() });
    res.json({ ok: true, groups: r.rows[0].groups });
  } catch (err) {
    if (err && err.code === '42703') return problem(req, res, { status: 409, ...words.groupsNotMigrated() });
    problem(req, res, failed(err, req, 'Set groups failed'));
  }
});

// Manual segment override (optional)
const CUSTOMER_PATCH_KEYS = PARTY_KEYS.concat('segment_override');
router.patch(
  '/customers/:id',
  [body('segment_override').optional().isIn(['high_value', 'regular', 'new', 'inactive'])],
  auth,
  validateAsProblem,
  ...checked('PATCH /customers/:id'),
  async (req, res) => {
    try {
      const owner = ctx(req);
      /* R14: a key this route does not know is refused in words, naming it - never a 200 with nothing changed (silence is the bug) */
      const unknown = Object.keys(req.body || {}).filter((item) => CUSTOMER_PATCH_KEYS.indexOf(item) < 0);
      if (unknown.length) {
        const message = 'Not saved: ' + unknown.join(', ') + ' cannot be changed here. You can change ' + CUSTOMER_PATCH_KEYS.join(', ') + '.';
        return problem(req, res, { status: 400, code: 'UNKNOWN_FIELD', detail: message, legacy: { error: 'validation', code: 'UNKNOWN_FIELD', fields: unknown, message } });
      }
      const party = await partyPatch(req, res, 'customer');
      if (party === false) return;
      if (!('segment_override' in (req.body || {}))) {
        if (party) return res.json({ message: 'Customer updated', party });
        return problem(req, res, {
          status: 400,
          ...words.nothingToUpdate('Provide segment_override or a party field (legal_name, nickname, phone, email, credit_days, credit_limit, state_code, tax_ids)')
        });
      }
      const r = await withEntity(owner, (db) =>
        db.query(
          `UPDATE customer_list SET segment_override = $1
         WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id`,
          [req.body.segment_override, req.params.id, owner]
        )
      );
      if (r.rows.length === 0) return problem(req, res, { status: 404, ...words.notFound() });
      res.json({ message: 'Segment updated' });
    } catch (err) {
      problem(req, res, failed(err, req, 'Update segment failed'));
    }
  }
);

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
const select = require('../lib/select');
const costView = require('../lib/cost-view'); /* RAIL-146k: the ONE way a route measures (a cost-blind reader's money stands only over the shop own sales) */
const policy = require('../lib/policy');

/** N1: an offer's amount in the SUPPLIER's own money (its stated currency; none stated → the bare amount); only a rupee supplier reads ₹ */
function offerMoney(amount, currency) {
  const stated = require('../lib/country-setup').currencyStated(currency),
    digits = require('../lib/money').decimals(stated);
  const figure = Number(amount).toFixed(digits);
  if (stated === 'INR') return '₹' + figure; /* IN-only branch: the rupee shop reads exactly what it read before */
  return stated ? stated + ' ' + figure : figure;
}

/**
 * S35: has this shop a chit with the counterparty at all? A scorecard is drawn only from the chits both sides hold, so an id this shop
 * never traded with (an unknown id, another shop's stranger, a real business it has not met) is one answer, the unknown id's 404, and says
 * nothing of whether that business exists. The window's own rows answer it; only an empty window (since=) asks once more, without the window,
 * so a real counterparty with nothing in the window keeps its empty card.
 * (Kept above GET /scorecard: tests/list-paging-guard reads a route's body up to the next route, so a helper between the two would count as the list's.)
 */
async function tradedWith(shop, counterparty_id, since, windowRows) {
  if (windowRows.length || !since) return windowRows.length > 0;
  return (await select.rows(shop, { counterparty_id, limit: 1 })).length > 0;
}

router.get('/scorecard', auth, queryDay('since'), ...checked('GET /scorecard'), async (req, res) => {
  try {
    const me = auth.entityOf(req);
    // Derived from the CHITS, not from a saved supplier list: a supplier you have never traded with has nothing
    // to score, and a counterparty you trade with daily belongs here whether or not anyone added them.
    const list = await select.counterparties(me, { since: req.query.since });
    res.json({ counterparties: list, note: list.length ? undefined : 'no trades yet — nothing to score' });
  } catch (err) {
    problem(req, res, failed(err, req, 'Scorecard list failed'));
  }
});

router.get('/scorecard/:entity_id', auth, queryDay('since'), ...checked('GET /scorecard/:entity_id'), async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const flags = await policy.get(me); // overdue is a POLICY, never a constant baked into a report
    const rows = await select.rows(me, { counterparty_id: req.params.entity_id, since: req.query.since, limit: 5000 });
    if (!(await tradedWith(me, req.params.entity_id, req.query.since, rows))) return problem(req, res, { status: 404, ...words.notFound() });
    const card = await costView.measureFor(req, me, rows, { overdue_days: flags.overdue_days, card: true });
    res.json(Object.assign({ counterparty_id: req.params.entity_id, name: (rows[0] || {}).counterparty_name || null }, card));
  } catch (err) {
    problem(req, res, failed(err, req, 'Scorecard failed'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
