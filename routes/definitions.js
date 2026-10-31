/* OWNS an entity's own named things: pack models ("Carton of 6"), tax slabs, categories - every edit writes a version
 * CALLED BY server.js (mounted at /api/definitions); the web Definitions workshop (cap-definitions.js)
 * FLOW auth -> schema check (lib/definitions-contract.js) -> ctx(entity) -> definition / definition_version (append-only) -> list adds the governed slabs of the entity's country (or says why there are none)
 *      a refusal -> problem(req, res, { status, ...words.x() } | definitionFault(e, req)) -> the old { error, message } kept beside the Problem fields (docs/contracts/api-legacy.json)
 * CARD 07-catalogue-and-pricing/definitions */
/**
 * routes/definitions.js — an entity's own named things: "Carton of 6", "Diwali 10%", a category list.
 *
 * Athi, 2026-08-16: **"frozen by value when stamped"** — the decision this whole module is shaped by.
 *
 * ── ⭐ KIND vs DEFINITION vs ADOPTION ────────────────────────────────────────────────────────────────────────────
 *   KIND        'a pack model exists'          CODE — a front-end registry — changes in a release
 *   DEFINITION  'Carton of 6'                  THIS MODULE — the entity's shelf (b160)
 *   ADOPTION    'this catalogue uses that'     a reference on the catalogue — NOT BUILT YET
 *
 * ── ⚠️⚠️ EVERY EDIT WRITES A VERSION. NOTHING IS OVERWRITTEN. ───────────────────────────────────────────────────
 * `definition_version` is append-only BY GRANT (no UPDATE, no DELETE for cb_app), so this is not a convention
 * anyone can quietly break. The reason is the freeze rule: a chit stamped in March that cites "Diwali 10%" must
 * still be explicable in December, when the shelf says 25%. Without the old version there is nothing to compare
 * the frozen copy against, and the chit holds a number it cannot justify.
 *
 * ⚠️ AND NOTHING IS DELETED — retiring sets `status`. A definition a chit once cited must stay resolvable
 * forever, or that chit's provenance dead-ends at a missing row.
 *
 * ── ⚠️ THE KIND IS NOT VALIDATED HERE, AND THAT IS DELIBERATE ───────────────────────────────────────────────────
 * The registry of kinds lives in the front end (cart-ui MODELS, offers KINDS, catalogue-model's palette) and
 * gains entries in a release. Validating against a server-side copy would create the second source of truth this
 * whole design exists to avoid — and would reject a kind the moment the two lists drifted. The server stores what
 * it is given; the screen offers only kinds the registry publishes.
 *
 * ⚠️ WITH RLS. Both tables are FORCE ROW LEVEL SECURITY on `app.current_entity`; every query runs inside
 * withEntity(), so a definition is as private as the catalogue it will govern.
 */
'use strict';
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const logger = require('../lib/logger');
const router = express.Router();
const { query, withEntity, withTransaction, readBatch } = require('../db');
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, words, definitionFault, schemaOptionsFor } = require('../lib/definitions-contract'); // the contract (each route's operation) and the words of a refusal
const auth = require('../middleware/auth');
const { shopChanged } = require('../lib/shopchanged'); /* ⭐ an offer is what a counter and a TV are SHOWING; they hear at once */
/* The jurisdiction's tax slabs (region_layer, b201) — served beside the entity's own definitions, read-only. */
const regional = require('../lib/regional');
const taxGov = require('../lib/tax-governance');
const slabCites = require('../lib/slab-cites');
const rateDoor = require('../lib/rate-door'); /* CAT-211: a category's rate (rules.default_slab) is owner or manager only, like every rate door */
const offerClash = require('../lib/offer-clash'); /* T2-LABS: a live offer that overlaps another live one is refused, in words (CBOffers.clashes) */

const ctx = (req) => auth.entityOf(req);

/* b160 not applied yet → say so plainly rather than 500. The API deploys before migrations by design, so this
   window is real: a 500 here would read as "definitions are broken" when they are merely not provisioned.
   That, a taken name and any other fault are worded by definitionFault (lib/definitions-contract.js). */

/** the schema check of one route (its own operation in lib/definitions-contract.js), as a list to spread after the sign-in: the old chains' 400 words are kept (schemaOptionsFor) */
function checked(route) {
  return [schemaValidate(contract.operationFor(route), schemaOptionsFor(route))];
}

const MAX_NAME = 120,
  MAX_NOTE = 500;

/** GET / — the shelf. ?kind= narrows; ?status= narrows (default: everything except retired). */
/** N1: the governed slabs of the entity's country, or - with no country - none and the one sentence that says where to set it */
async function governedNote(entityId) {
  const gov = await taxGov.governedSlabsFor(entityId, { query, regionLayer: regional.regionLayer });
  if (gov.length) return { rows: gov, why: null };
  return { rows: [], why: (await taxGov.jurisdictionFor(entityId, { query })) ? null : taxGov.NO_COUNTRY_SLABS_SAY };
}

router.get('/', auth, ...checked('GET /'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    /**
     * ⚠️⚠️ EVERY COLUMN IS QUALIFIED `d.` — the query LEFT JOINs definition_version, which also has `entity_id`,
     * so a bare `entity_id = $1` is AMBIGUOUS and Postgres refuses the whole statement. The route answered 500.
     *
     * ⚠️ AND THE TEST DID NOT NOTICE, which is the more useful lesson. It asserted "is my row in the array" —
     * and an error's empty array satisfies "not in the array" perfectly. A 500 read as a clean negative result.
     * An assertion about ABSENCE has to check the status code too, or it passes on a broken endpoint.
     */
    const params = [entity_id];
    let where = 'd.entity_id = $1';
    /**
     * ── ⭐⭐⭐ SEVERAL KINDS IN ONE CALL ────────────────────────────────────────────────────────────────────
     *
     * Athi, 2026-09-13: *"batch the defList calls into one."*
     *
     * ⭐ MEASURED FIRST, WITH CB_TRIPS ON: opening the Catalogue asked this route SEVEN times — category,
     * pricing, tax, ordermodel, offer, and two repeats — and each one cost about 65 ms INSIDE THE SERVER for
     * 273–642 ms of wall time. Nearly all of it was the wire. So the fix is not a faster query; it is fewer
     * journeys, and this is the end that has to allow it.
     *
     * ⚠️ ONE PARAMETER, NOT A NEW ROUTE. `?kind=tax,category` is the same question asked about more than one
     * shelf, and a second endpoint would be a second thing to keep in step with this one — the retired-row
     * rule, the governed slabs, the version join.
     *
     * ⚠️ A SINGLE KIND STILL COMPARES WITH `=`. Postgres plans `= ANY(array)` differently, and every existing
     * caller sends one kind; leaving the common path exactly as it was means this change cannot make anything
     * that works today slower.
     */
    const kinds = req.query.kind
      ? String(req.query.kind)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    if (kinds.length === 1) {
      params.push(kinds[0]);
      where += ` AND d.kind = $${params.length}`;
    } else if (kinds.length > 1) {
      params.push(kinds);
      where += ` AND d.kind = ANY($${params.length})`;
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      where += ` AND d.status = $${params.length}`;
    }
    /**
     * ⚠️ RETIRED IS HIDDEN BY DEFAULT BUT REACHABLE. `?status=retired` returns them, and `?all=1` returns
     * everything. A shelf that silently omits retired items is how someone re-creates a definition they already
     * retired — the same reasoning products.js applies to item status.
     */
    else if (!req.query.all) where += ` AND d.status <> 'retired'`;

    const listSql = `SELECT d.*, v.rules, v.created_at AS version_at
         FROM definition d
         LEFT JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE ${where}
        ORDER BY d.kind, d.name`;
    /* ⚠ among the kinds asked for, not equal to the whole parameter — `kind=tax,category` wants them too */
    const wantsTax = !kinds.length || kinds.indexOf('tax') >= 0;
    const wantsLive = !req.query.status || String(req.query.status) === 'live';
    /* ⭐⭐ ONE ROUND TRIP (db.readBatch): the list, my identity row and the region layers that decide the governed
       slabs go as one message — this was a transaction (4 trips) plus two plain queries. Falls back to the old
       path if the batch cannot be built. */
    /* ⭐ a brand's offers say whether its stores have them (see the note where they are stamped) */
    const wantsOffers = !kinds.length || kinds.indexOf('offer') >= 0;
    let rows = null;
    try {
      const stmts = [{ text: listSql, params }];
      const at = {};
      if (wantsTax && wantsLive) {
        at.id = stmts.push({ text: 'SELECT country, currency_code FROM identities WHERE identity_id = $1', params: [entity_id] }) - 1;
        at.layers =
          stmts.push({
            text: `SELECT region_code, currency, units, language, jurisdiction FROM region_layer WHERE region_code IN ('IN', (SELECT upper(trim(country)) FROM identities WHERE identity_id = $1))`,
            params: [entity_id]
          }) - 1;
      }
      if (wantsOffers) {
        at.net =
          stmts.push({
            text: `SELECT policy_flags#>'{network_offers,released}' AS released,
            ${require('../lib/network-membership').ACTIVE_COUNT_SQL} AS stores
            FROM identities WHERE identity_id = $1`,
            params: [entity_id]
          }) - 1;
      }
      const response = await readBatch(entity_id, req.identity && req.identity.identity_id, stmts);
      rows = response[0].rows;
      if (at.id !== undefined) {
        const juris = taxGov.jurisdictionOf(response[at.id].rows[0]);
        const layers = new Map(response[at.layers].rows.map((x) => [String(x.region_code).toUpperCase(), x]));
        const gov = taxGov.governedFromRows(juris, layers.get(juris) || null, layers.get('IN') || null);
        if (gov.length) rows = rows.concat(gov);
      }
      /**
       * ⭐⭐ "NOT RELEASED TO YOUR STORES" (Athi, 2026-09-17). He ticked a new offer on a brand product and expected his five stores
       * to have it; a network offer reaches them only when RELEASED, and no screen said so. Every offer of a shop that HAS member
       * stores now carries network { stores, released, changed, at } — read in the same message as the list, so it costs no trip.
       * A shop with no stores gets nothing: the words would be about a network it does not have.
       */
      if (at.net !== undefined) require('../lib/network-offers').stampReleases(rows, response[at.net].rows[0]);
    } catch (e) {
      logger.fellBack('definitions GET /: the read failed — answered with nothing', e);
      rows = null;
    }
    const r = rows === null ? await withEntity(entity_id, (db) => db.query(listSql, params)) : null;
    /**
     * ⭐⭐ THE JURISDICTION'S SLABS RIDE ALONG WITH THE ENTITY'S OWN. Athi, 2026-09-04: *"why each entity should
     * create one for them … it has to come from governance layer and across the country."* India's GST slabs live
     * on region_layer (b201) and every entity whose jurisdiction is IN receives them here as live, read-only rows
     * (`governance` set, `entity_id` null, id `IN-GST-18`). Same array, same shape — the product page, the category
     * and the catalogue default pick from both without a second code path. `?status=draft|retired` never includes
     * them: a governed slab is always live. See lib/tax-governance.js.
     */
    let governedWhy = null;
    if (rows === null) {
      rows = r.rows;
      if (wantsTax && wantsLive) {
        const governed = await governedNote(entity_id);
        rows = rows.concat(governed.rows);
        governedWhy = governed.why; /* N1: no country -> no slabs, and the sentence says why */
      }
    }
    res.json(
      Object.assign(
        { count: rows.length },
        governedWhy ? { governed_why: governedWhy } : {},
        PL.pageOut('definitions', rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))
      )
    );
  } catch (e) {
    problem(req, res, definitionFault(e, req));
  }
});

/** GET /:id — one definition with its FULL version history. The history is the point, so it is not optional. */
router.get('/:id', auth, ...checked('GET /:id'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    /**
     * ⚠️ ONE TRANSACTION, NOT TWO. `withEntity()` costs FOUR round trips each — BEGIN · set_config · the query ·
     * COMMIT (db/index.js) — so reading a definition and its versions cost eight, half of them ceremony. The
     * two queries always run together and always for the same entity; there was never a reason for two BEGINs.
     *
     * ⭐ AND THE VERSIONS ARE ONLY READ IF THE DEFINITION EXISTS, exactly as before. Sharing a transaction is
     * not merging the queries: the 404 still happens before any version row is fetched, so an id in the URL
     * still does not reveal that a definition exists. Same order, same guarantee, one BEGIN.
     *
     * ⭐ The response is sent OUTSIDE the transaction — holding a connection open across serialisation is the
     * cost this change exists to remove, not to relocate.
     */
    const out = await withEntity(entity_id, async (db) => {
      const d = await db.query(`SELECT * FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!d.rows.length) return null;
      const v = await db.query(
        `SELECT version, rules, note, created_at, created_by FROM definition_version
          WHERE definition_id = $1 ORDER BY version DESC`,
        [req.params.id]
      );
      /**
       * ⭐ [b268] "who approved the offer or made it live" — the name, not just the id: a LEFT JOIN so a
       * status_log row from an identity since removed still shows its status and timestamp rather than
       * vanishing or 500ing.
       */
      const sl = await db.query(
        `SELECT sl.status, sl.changed_at, sl.changed_by, i.display_name AS changed_by_name
           FROM definition_status_log sl
           LEFT JOIN identities i ON i.identity_id = sl.changed_by
          WHERE sl.definition_id = $1 ORDER BY sl.changed_at DESC`,
        [req.params.id]
      );
      return { definition: d.rows[0], versions: v.rows, status_log: sl.rows };
    });
    if (!out) return problem(req, res, { status: 404, ...words.notFound() });
    res.json(out);
  } catch (e) {
    problem(req, res, definitionFault(e, req));
  }
});

/** CAT-211: the 403 for a caller who may not set a rate (the whole request refused, nothing written) */
const rateRefused = (req, res) => problem(req, res, { status: 403, ...rateDoor.refusal() });
/** the rules the definition's current version holds (the one reader: the offer clash and the rate check both ask) */
const currentRulesOf = async (db, definition) =>
  ((await db.query(`SELECT rules FROM definition_version WHERE definition_id = $1 AND version = $2`, [definition.definition_id, definition.current_version])).rows[0] || {}).rules || {};
/** CAT-211: does this edit change the category's default rate? Only asked of a caller who may not set one (the owner and a manager never pay the read). */
const editorChangesRate = async (req, db, definition, rules) => !rateDoor.setsRate(req) && !!rules && rateDoor.defaultSlabChanged(rules, await currentRulesOf(db, definition));
/** the refusals an edit meets before anything is written: a rate the caller may not set, or a rule left without its value (null = go on) */
async function editRefusal(req, db, definition, rules) {
  if (liveNeedsYes(req, definition.kind, definition.status)) return { unconfirmed: true };
  if (await editorChangesRate(req, db, definition, rules)) return { rateRefused: true };
  const bad = rules && require('../lib/definition-check').missingValue(definition.kind, definition.sub_kind, rules);
  return bad ? { bad } : null;
}

/** answers what editRefusal found (a rate the caller may not set: 403; a rule without its value: 422); true when it answered */
function answerEditRefusal(req, res, out) {
  if (out.unconfirmed) problem(req, res, { status: 428, ...words.liveUnconfirmed() });
  else if (out.rateRefused) rateRefused(req, res);
  else if (out.bad) problem(req, res, { status: 422, ...words.incomplete(out.bad) });
  return !!(out.unconfirmed || out.rateRefused || out.bad);
}

/** CAT-211: a category born with a rate is refused for a caller who may not set one (a gate between the checks and the handler) */
const bornWithoutRate = (req, res, next) => {
  const rules = req.body && typeof req.body.rules === 'object' && req.body.rules;
  return !rateDoor.setsRate(req) && rateDoor.defaultSlabChanged(rules, {}) ? rateRefused(req, res) : next();
};

/** UX-110: an offer becomes live only with the shop's explicit yes — the page asks first (CBLabKit.confirm) and then sends `confirmed: true`. A draft, a pause, a retire, any other kind, and an offer already live are never asked. */
const liveNeedsYes = (req, kind, wasStatus) => kind === 'offer' && req.body && req.body.status === 'live' && wasStatus !== 'live' && req.body.confirmed !== true;

/** UX-110: an offer born live without the yes is refused before anything is read or written (a gate, like bornWithoutRate) */
const bornLiveWithoutYes = (req, res, next) => (liveNeedsYes(req, String((req.body && req.body.kind) || '').trim(), 'draft') ? problem(req, res, { status: 428, ...words.liveUnconfirmed() }) : next());

/** POST / — author one. Creates the definition AND version 1 in ONE transaction. */
router.post('/', auth, ...checked('POST /'), bornWithoutRate, bornLiveWithoutYes, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const { kind, sub_kind, name, note } = req.body || {};
    /* 'live' on create — the planner authors several dated offers at once; a second call per row to flip each
         to live doubled its round trips. Anything else is a draft, as before. */
    const status0 = req.body && req.body.status === 'live' ? 'live' : 'draft';
    const rules = (req.body && typeof req.body.rules === 'object' && req.body.rules) || {};
    /* a rule without its value is refused here too (lib/definition-check.js — the form's own sentences) */
    {
      const bad = require('../lib/definition-check').missingValue(String(kind || '').trim(), sub_kind ? String(sub_kind).trim() : null, rules);
      if (bad) return problem(req, res, { status: 422, ...words.incomplete(bad) });
    }

    /**
     * ⚠️ ONE TRANSACTION, BOTH ROWS. A definition whose version 1 failed to write is a definition with no
     * rules — it would list on the shelf, resolve to nothing, and freeze nothing onto a chit that cited it.
     * The pair is the unit, exactly as putForParticipantsInTx treats a chit and its documents.
     */
    const out = await withEntity(entity_id, async (db) => {
      /* ⭐ T2-LABS: born LIVE beside another live discount on the same items → refused before anything is written */
      const clash = await offerClash.check(db, entity_id, {
        definition_id: null,
        kind: String(kind).trim(),
        sub_kind: sub_kind ? String(sub_kind).trim() : null,
        name: String(name).trim(),
        rules,
        status: status0
      });
      if (clash) return { clash };
      const d = await db.query(
        `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
           VALUES ($1,$2,$3,$4,$5,$7,1,$6) RETURNING *`,
        [
          entity_id,
          String(kind).trim(),
          sub_kind ? String(sub_kind).trim() : null,
          String(name).trim().slice(0, MAX_NAME),
          note ? String(note).slice(0, MAX_NOTE) : null,
          req.identity && req.identity.identity_id,
          status0
        ]
      );
      const row = d.rows[0];
      await db.query(
        `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
           VALUES ($1,1,$2,$3,$4,$5)`,
        [row.definition_id, entity_id, rules, note ? String(note).slice(0, MAX_NOTE) : null, req.identity && req.identity.identity_id]
      );
      return row;
    });
    if (out && out.clash) return problem(req, res, { status: 409, ...words.clash(out.clash.body) });
    shopChanged(entity_id, 'definition created');
    res.status(201).json({ message: 'Definition created', definition: out, version: 1 });
  } catch (e) {
    /* The unique index is a real rule, not an internal failure — a name is how people cite a definition, so
         two with the same name in the same kind would make every citation ambiguous. */
    problem(req, res, definitionFault(e, req, { nameTaken: true }));
  }
});

/** one definition_status_log row per REAL transition (see the b268 note in PUT /:id): a no-op re-send of the same status writes nothing */
async function logStatusChange(db, req, entity_id, wasStatus, status) {
  if (!status || status === wasStatus) return;
  await db.query(
    `INSERT INTO definition_status_log (definition_id, entity_id, status, changed_by)
     VALUES ($1,$2,$3,$4)`,
    [req.params.id, entity_id, String(status), req.identity && req.identity.identity_id]
  );
}

/**
 * ⭐⭐ PUT /:id — an edit is a NEW VERSION, never an overwrite.
 *
 * This route is the freeze rule made mechanical. The old rules stay on the old version row forever, so a chit
 * stamped against version 2 can still be explained after the shelf has moved to version 5.
 */
/* A governed slab is the jurisdiction's, not the entity's: a sentence (words.governed), not a uuid-cast error. */
router.put('/:id', auth, ...checked('PUT /:id'), async (req, res) => {
  try {
    if (taxGov.isGovernedId(req.params.id)) return problem(req, res, { status: 403, ...words.governed() });
    const entity_id = ctx(req);
    const rules = req.body && typeof req.body.rules === 'object' ? req.body.rules : null;
    const { name, note, status } = req.body || {};

    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT * FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!cur.rows.length) return { missing: true };
      const d = cur.rows[0];
      /* a rate the caller may not set (CAT-211), or an edit that removes the value (refused like a create without one) */
      const refused = await editRefusal(req, db, d, rules);
      if (refused) return refused;
      /* ⭐ T2-LABS: a save that MAKES the offer live, or changes the rules of a live one, is asked whether it clashes with another
         live discount (lib/offer-clash — the engine's rule). A rename, a pause or a retire is never refused for it. */
      const after = status ? String(status) : d.status;
      if (d.kind === 'offer' && after === 'live' && (rules || d.status !== 'live')) {
        const rulesNow = rules || (await currentRulesOf(db, d));
        const clash = await offerClash.check(db, entity_id, {
          definition_id: d.definition_id,
          kind: d.kind,
          sub_kind: d.sub_kind,
          name: name ? String(name).trim() : d.name,
          rules: rulesNow,
          status: after
        });
        if (clash) return { clash };
      }
      let version = d.current_version;

      /* ⚠️ A NEW VERSION ONLY WHEN THE RULES CHANGE. Renaming a definition or retiring it is not a change to
         what it MEANS, and minting a version for it would fill the history with noise and make "what changed"
         unanswerable — which is the one question the history exists to answer. */
      if (rules) {
        version = d.current_version + 1;
        await db.query(
          `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, version, entity_id, rules, note ? String(note).slice(0, MAX_NOTE) : null, req.identity && req.identity.identity_id]
        );
      }
      const upd = await db.query(
        `UPDATE definition
            SET name = COALESCE($2, name),
                note = COALESCE($3, note),
                status = COALESCE($4, status),
                current_version = $5,
                updated_at = now()
          WHERE definition_id = $1 RETURNING *`,
        [
          req.params.id,
          name ? String(name).trim().slice(0, MAX_NAME) : null,
          note != null ? String(note).slice(0, MAX_NOTE) : null,
          status ? String(status) : null,
          version
        ]
      );
      /**
       * ⭐⭐⭐ [b268, 2026-09-27] "who approved the offer or made it live" — one row per REAL transition
       * (never a no-op "approved" PUT that leaves it already approved), so the log answers exactly the
       * question it exists for and never one nobody asked ("approved" appearing twice because a screen
       * re-sent the same status is noise, not history).
       */
      await logStatusChange(db, req, entity_id, d.status, status);
      return { row: upd.rows[0], version, versioned: !!rules };
    });

    if (out.missing) return problem(req, res, { status: 404, ...words.notFound() });
    if (answerEditRefusal(req, res, out)) return;
    if (out.clash) return problem(req, res, { status: 409, ...words.clash(out.clash.body) });
    /* CTR-157: an offer made live, paused or changed is what every open counter prices with, so they hear it now, as for a create or a retire */
    shopChanged(entity_id, 'definition saved');
    res.json({ message: out.versioned ? 'Saved as version ' + out.version : 'Saved', definition: out.row, version: out.version, new_version: out.versioned });
  } catch (e) {
    problem(req, res, definitionFault(e, req, { nameTaken: true }));
  }
});

/**
 * ⚠️ DELETE RETIRES. IT DOES NOT DELETE.
 *
 * A definition a chit once cited must stay resolvable forever — a stamped chit carries a copy of the rules AND a
 * pointer to the version it copied, and the pointer must not dead-end. So the verb is kept (a caller expects
 * DELETE) and the behaviour is honest, and the response says which it did rather than letting anyone assume.
 */
/** the takeover slab: one of my LIVE slabs, or a governed one (lib/slab-cites has the why) */
async function liveSlabById(db, entity_id, id) {
  if (taxGov.isGovernedId(id)) {
    const list = await taxGov.governedSlabsFor(entity_id, { query, regionLayer: regional.regionLayer });
    const g = list.find((x) => String(x.definition_id) === String(id));
    return g ? slabCites.S.slabOf(g) : null;
  }
  const r = await db.query(
    `SELECT d.definition_id, d.name, d.status, v.rules FROM definition d
                            LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
                           WHERE d.definition_id = $1 AND d.kind = 'tax' AND d.status = 'live'`,
    [id]
  );
  return r.rows.length ? slabCites.S.slabOf(r.rows[0]) : null;
}
/** CAT-211: would this retire hand the slab's citers (products and categories) to another slab? A takeover that moves nothing sets no rate, so it is not refused. */
const editorTakesOver = async (req, db, slabId) => {
  if (rateDoor.setsRate(req) || !req.query.takeover) return false;
  const citers = await slabCites.cites(db, slabId);
  return citers.products + citers.categories > 0;
};
router.delete('/:id', auth, ...checked('DELETE /:id'), async (req, res) => {
  try {
    if (taxGov.isGovernedId(req.params.id)) return problem(req, res, { status: 403, ...words.governed() });
    const entity_id = ctx(req);
    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT kind, status FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!cur.rows.length) return { missing: true };
      const wasRetired = cur.rows[0].status === 'retired';
      let moved = null;
      if (cur.rows[0].kind === 'tax') {
        /* ⭐ A SLAB DOES NOT GO DARK UNDER ITS PRODUCTS. Refused with the counts; accepted with ?takeover=<slab id>,
           which re-points every citer first — all inside this one transaction (Athi, 2026-09-05). */
        if (await editorTakesOver(req, db, req.params.id)) return { rateRefused: true }; /* CAT-211: a takeover re-points categories' rates */
        const g = await slabCites.guard(db, req.params.id, req.query.takeover, (id) => liveSlabById(db, entity_id, id));
        if (g && g.status) return { refused: g };
        moved = g ? g.moved : null;
      }
      await db.query(`UPDATE definition SET status = 'retired', updated_at = now() WHERE definition_id = $1`, [req.params.id]);
      /* ⭐ [b268] the same log the PUT status-change writes to — "who retired it" is exactly as real a question
         as "who approved it", and this is the ONE status transition that never goes through PUT at all.
         Guarded the same way PUT guards its own write: a retire called on something already retired is a
         no-op, not a second event. */
      if (!wasRetired) {
        await db.query(`INSERT INTO definition_status_log (definition_id, entity_id, status, changed_by) VALUES ($1,$2,'retired',$3)`, [
          req.params.id,
          entity_id,
          req.identity && req.identity.identity_id
        ]);
      }
      shopChanged(entity_id, 'definition retired');
      return { body: { message: 'Retired — not deleted. Chits that cite it stay explainable.', retired: true, moved } };
    });
    if (out.missing) return problem(req, res, { status: 404, ...words.notFound() });
    if (out.rateRefused) return rateRefused(req, res);
    /* the slab guard (lib/slab-cites.js) refuses 409 (cited) or 400 (the takeover is the same slab, or not a live one) */
    if (out.refused) return problem(req, res, out.refused.status === 409 ? { status: 409, ...words.cited(out.refused.body) } : { status: 400, ...words.takeover(out.refused.body) });
    const { message, retired, moved } = out.body; /* R2-13: the answer's keys written where it is sent, so the allow-list can read them */
    res.json({ message, retired, moved });
  } catch (e) {
    problem(req, res, definitionFault(e, req));
  }
});

/**
 * ⭐⭐ POST /freeze — THE DECISION, MADE MECHANICAL.
 *
 * Athi, 2026-08-16: *"frozen by value when stamped."* Give it definition ids; it returns a SNAPSHOT to embed in
 * whatever is being stamped:
 *
 *     [{ definition_id, version, kind, sub_kind, name, rules, frozen_at }]
 *
 * ⚠️ THE CALLER EMBEDS IT. This route deliberately does not write to a chit — the mint owns what goes on a chit,
 * and a route that reached into chits from here would be a second door into the same object.
 *
 * ⭐ THE SNAPSHOT CARRIES BOTH THE COPY AND THE POINTER. The copy is what makes the chit defensible on its own
 * ("this is what 'Diwali 10%' said"); the pointer is what makes it auditable against the shelf. A copy without
 * provenance cannot be traced back; a pointer without a copy is exactly the thing that changes underneath you.
 *
 * ⚠️ A RETIRED DEFINITION STILL FREEZES. Retiring means "do not offer this any more", not "this never happened" —
 * refusing here would block a chit citing terms that were live when the order was placed.
 */
router.post('/freeze', auth, ...checked('POST /freeze'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    const ids = (req.body.definition_ids || []).map(String).filter(Boolean);
    if (!ids.length) return res.json({ frozen: [], missing: [], frozen_at: null }); /* R2-13: one shape on both paths (laptop1, 24 Oct): frozen_at is null when nothing was frozen */

    /* ⚠️ A GOVERNED ID IS NOT A UUID and would make the cast below refuse the whole request. Split: the entity's
       own definitions freeze from their version row; the jurisdiction's slabs freeze as a copy of the regional
       layer (there is no version row to point at — the copy IS the record, keyed by effective_from). */
    const govIds = ids.filter(taxGov.isGovernedId);
    const ownIds = ids.filter((item) => !taxGov.isGovernedId(item));

    const r = ownIds.length
      ? await withEntity(entity_id, (db) =>
          db.query(
            `SELECT d.definition_id, d.kind, d.sub_kind, d.name, d.status,
              v.version, v.rules
         FROM definition d
         JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.definition_id = ANY($1::uuid[])`,
            [ownIds]
          )
        )
      : { rows: [] };

    const at = new Date().toISOString();
    const frozen = r.rows.map((x) => ({
      definition_id: x.definition_id,
      version: x.version,
      kind: x.kind,
      sub_kind: x.sub_kind,
      name: x.name,
      rules: x.rules,
      frozen_at: at
    }));
    /**
     * ⚠️ WHAT WAS NOT FOUND IS RETURNED, NOT SWALLOWED. A caller freezing three definitions and silently
     * receiving two would stamp a chit missing a term it believed it had — and would not find out until the
     * dispute. RLS also means "not yours" and "does not exist" look identical here, which is correct: neither is
     * something this entity may learn more about.
     */
    if (govIds.length) {
      const list = await taxGov.governedSlabsFor(entity_id, { query, regionLayer: regional.regionLayer });
      list.filter((item) => govIds.includes(item.definition_id)).forEach((item) => frozen.push(taxGov.frozenCopy(item, at)));
    }
    const found = new Set(frozen.map((item) => String(item.definition_id)));
    res.json({ frozen, missing: ids.filter((item) => !found.has(item)), frozen_at: at });
  } catch (e) {
    problem(req, res, definitionFault(e, req));
  }
});

router.openapi = { paths: contract.pathsOf() }; // S9: the 6 routes (lib/definitions-contract.js)
module.exports = router;
