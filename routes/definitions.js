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
const router  = express.Router();
const { body } = require('express-validator');
const { query, withEntity, withTransaction, readBatch } = require('../db');
const { validate } = require('../middleware/validate');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');
/* The jurisdiction's tax slabs (region_layer, b201) — served beside the entity's own definitions, read-only. */
const regional = require('../lib/regional');
const taxGov = require('../lib/tax-governance');
const slabCites = require('../lib/slab-cites');

const ctx = (req) => auth.entityOf(req);

/* b160 not applied yet → say so plainly rather than 500. The API deploys before migrations by design, so this
   window is real: a 500 here would read as "definitions are broken" when they are merely not provisioned. */
const notMigrated = (e) => e && (e.code === '42P01');
const gone = (res) => res.status(503).json({ error: 'Not provisioned',
  message: 'Definitions need migration b160. Ask the operator to run it.' });

const MAX_NAME = 120, MAX_NOTE = 500;

/** GET / — the shelf. ?kind= narrows; ?status= narrows (default: everything except retired). */
router.get('/', auth, async (req, res) => {
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
    if (req.query.kind)   { params.push(String(req.query.kind));   where += ` AND d.kind = $${params.length}`; }
    if (req.query.status) { params.push(String(req.query.status)); where += ` AND d.status = $${params.length}`; }
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
    const wantsTax = !req.query.kind || String(req.query.kind) === 'tax';
    const wantsLive = !req.query.status || String(req.query.status) === 'live';
    /* ⭐⭐ ONE ROUND TRIP (db.readBatch): the list, my identity row and the region layers that decide the governed
       slabs go as one message — this was a transaction (4 trips) plus two plain queries. Falls back to the old
       path if the batch cannot be built. */
    let rows = null;
    try {
      const stmts = [{ text: listSql, params }];
      if (wantsTax && wantsLive) {
        stmts.push({ text: 'SELECT country, currency_code FROM identities WHERE identity_id = $1', params: [entity_id] });
        stmts.push({ text: `SELECT region_code, currency, units, language, jurisdiction FROM region_layer WHERE region_code IN ('IN', (SELECT upper(trim(country)) FROM identities WHERE identity_id = $1))`, params: [entity_id] });
      }
      const res = await readBatch(entity_id, req.identity && req.identity.identity_id, stmts);
      rows = res[0].rows;
      if (wantsTax && wantsLive) {
        const juris = taxGov.jurisdictionOf(res[1].rows[0]);
        const layers = new Map(res[2].rows.map((x) => [String(x.region_code).toUpperCase(), x]));
        const gov = taxGov.governedFromRows(juris, layers.get(juris) || null, layers.get('IN') || null);
        if (gov.length) rows = rows.concat(gov);
      }
    } catch (_) { rows = null; }
    const r = rows === null ? await withEntity(entity_id, (db) => db.query(listSql, params)) : null;
    /**
     * ⭐⭐ THE JURISDICTION'S SLABS RIDE ALONG WITH THE ENTITY'S OWN. Athi, 2026-09-04: *"why each entity should
     * create one for them … it has to come from governance layer and across the country."* India's GST slabs live
     * on region_layer (b201) and every entity whose jurisdiction is IN receives them here as live, read-only rows
     * (`governance` set, `entity_id` null, id `IN-GST-18`). Same array, same shape — the product page, the category
     * and the catalogue default pick from both without a second code path. `?status=draft|retired` never includes
     * them: a governed slab is always live. See lib/tax-governance.js.
     */
    if (rows === null) {
      rows = r.rows;
      if (wantsTax && wantsLive) {
        const gov = await taxGov.governedSlabsFor(entity_id, { query, regionLayer: regional.regionLayer });
        if (gov.length) rows = rows.concat(gov);
      }
    }
    res.json({ definitions: rows, count: rows.length });
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/** GET /:id — one definition with its FULL version history. The history is the point, so it is not optional. */
router.get('/:id', auth, async (req, res) => {
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
          WHERE definition_id = $1 ORDER BY version DESC`, [req.params.id]);
      return { definition: d.rows[0], versions: v.rows };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/** POST / — author one. Creates the definition AND version 1 in ONE transaction. */
router.post('/', auth,
  [ body('kind').isString().trim().notEmpty(), body('name').isString().trim().notEmpty() ], validate,
  async (req, res) => {
    try {
      const entity_id = ctx(req);
      const { kind, sub_kind, name, note } = req.body || {};
      /* 'live' on create — the planner authors several dated offers at once; a second call per row to flip each
         to live doubled its round trips. Anything else is a draft, as before. */
      const status0 = (req.body && req.body.status === 'live') ? 'live' : 'draft';
      const rules = (req.body && typeof req.body.rules === 'object' && req.body.rules) || {};
      /* a rule without its value is refused here too (lib/definition-check.js — the form's own sentences) */
      { const bad = require('../lib/definition-check').missingValue(String(kind || '').trim(), sub_kind ? String(sub_kind).trim() : null, rules); if (bad) return res.status(422).json({ error: 'Incomplete rule', message: bad }); }

      /**
       * ⚠️ ONE TRANSACTION, BOTH ROWS. A definition whose version 1 failed to write is a definition with no
       * rules — it would list on the shelf, resolve to nothing, and freeze nothing onto a chit that cited it.
       * The pair is the unit, exactly as putForParticipantsInTx treats a chit and its documents.
       */
      const out = await withEntity(entity_id, async (db) => {
        const d = await db.query(
          `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
           VALUES ($1,$2,$3,$4,$5,$7,1,$6) RETURNING *`,
          [entity_id, String(kind).trim(), sub_kind ? String(sub_kind).trim() : null,
           String(name).trim().slice(0, MAX_NAME), note ? String(note).slice(0, MAX_NOTE) : null,
           req.identity && req.identity.identity_id, status0]);
        const row = d.rows[0];
        await db.query(
          `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
           VALUES ($1,1,$2,$3,$4,$5)`,
          [row.definition_id, entity_id, rules, note ? String(note).slice(0, MAX_NOTE) : null,
           req.identity && req.identity.identity_id]);
        return row;
      });
      res.status(201).json({ message: 'Definition created', definition: out, version: 1 });
    } catch (e) {
      if (notMigrated(e)) return gone(res);
      /* The unique index is a real rule, not an internal failure — a name is how people cite a definition, so
         two with the same name in the same kind would make every citation ambiguous. */
      if (e && e.code === '23505') return res.status(409).json({ error: 'Name taken',
        message: 'You already have a definition of this kind with that name.' });
      res.status(500).json({ error: 'Failed', message: safeErr(e) });
    }
  });

/**
 * ⭐⭐ PUT /:id — an edit is a NEW VERSION, never an overwrite.
 *
 * This route is the freeze rule made mechanical. The old rules stay on the old version row forever, so a chit
 * stamped against version 2 can still be explained after the shelf has moved to version 5.
 */
/* A governed slab is the jurisdiction's, not the entity's: a sentence, not a uuid-cast error. */
const governedRefusal = (res) => res.status(403).json({ error: 'Governed',
  message: 'This slab is declared by the jurisdiction and cannot be edited or retired here. To differ from it, declare a slab of your own.' });

router.put('/:id', auth, async (req, res) => {
  try {
    if (taxGov.isGovernedId(req.params.id)) return governedRefusal(res);
    const entity_id = ctx(req);
    const rules = (req.body && typeof req.body.rules === 'object') ? req.body.rules : null;
    const { name, note, status } = req.body || {};

    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT * FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!cur.rows.length) return { missing: true };
      const d = cur.rows[0];
      /* an edit that removes the value is refused like a create without one */
      if (rules) { const bad = require('../lib/definition-check').missingValue(d.kind, d.sub_kind, rules); if (bad) return { bad }; }
      let version = d.current_version;

      /* ⚠️ A NEW VERSION ONLY WHEN THE RULES CHANGE. Renaming a definition or retiring it is not a change to
         what it MEANS, and minting a version for it would fill the history with noise and make "what changed"
         unanswerable — which is the one question the history exists to answer. */
      if (rules) {
        version = d.current_version + 1;
        await db.query(
          `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, version, entity_id, rules, note ? String(note).slice(0, MAX_NOTE) : null,
           req.identity && req.identity.identity_id]);
      }
      const upd = await db.query(
        `UPDATE definition
            SET name = COALESCE($2, name),
                note = COALESCE($3, note),
                status = COALESCE($4, status),
                current_version = $5,
                updated_at = now()
          WHERE definition_id = $1 RETURNING *`,
        [req.params.id, name ? String(name).trim().slice(0, MAX_NAME) : null,
         note != null ? String(note).slice(0, MAX_NOTE) : null,
         status ? String(status) : null, version]);
      return { row: upd.rows[0], version, versioned: !!rules };
    });

    if (out.missing) return res.status(404).json({ error: 'Not found' });
    if (out.bad) return res.status(422).json({ error: 'Incomplete rule', message: out.bad });
    res.json({ message: out.versioned ? 'Saved as version ' + out.version : 'Saved',
               definition: out.row, version: out.version, new_version: out.versioned });
  } catch (e) {
    if (notMigrated(e)) return gone(res);
    if (e && e.code === '23505') return res.status(409).json({ error: 'Name taken',
      message: 'You already have a definition of this kind with that name.' });
    res.status(500).json({ error: 'Failed', message: safeErr(e) });
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
    const gov = await taxGov.governedSlabsFor(entity_id, { query, regionLayer: regional.regionLayer });
    const g = gov.find((x) => String(x.definition_id) === String(id));
    return g ? slabCites.S.slabOf(g) : null;
  }
  const r = await db.query(`SELECT d.definition_id, d.name, d.status, v.rules FROM definition d
                            LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
                           WHERE d.definition_id = $1 AND d.kind = 'tax' AND d.status = 'live'`, [id]);
  return r.rows.length ? slabCites.S.slabOf(r.rows[0]) : null;
}
router.delete('/:id', auth, async (req, res) => {
  try {
    if (taxGov.isGovernedId(req.params.id)) return governedRefusal(res);
    const entity_id = ctx(req);
    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT kind FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!cur.rows.length) return { status: 404, body: { error: 'Not found' } };
      let moved = null;
      if (cur.rows[0].kind === 'tax') {
        /* ⭐ A SLAB DOES NOT GO DARK UNDER ITS PRODUCTS. Refused with the counts; accepted with ?takeover=<slab id>,
           which re-points every citer first — all inside this one transaction (Athi, 2026-09-05). */
        const g = await slabCites.guard(db, req.params.id, req.query.takeover, (id) => liveSlabById(db, entity_id, id));
        if (g && g.status) return g;
        moved = g ? g.moved : null;
      }
      await db.query(`UPDATE definition SET status = 'retired', updated_at = now() WHERE definition_id = $1`, [req.params.id]);
      return { status: 200, body: { message: 'Retired — not deleted. Chits that cite it stay explainable.', retired: true, moved } };
    });
    res.status(out.status).json(out.body);
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
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
router.post('/freeze', auth, [ body('definition_ids').isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const ids = (req.body.definition_ids || []).map(String).filter(Boolean);
    if (!ids.length) return res.json({ frozen: [], missing: [] });

    /* ⚠️ A GOVERNED ID IS NOT A UUID and would make the cast below refuse the whole request. Split: the entity's
       own definitions freeze from their version row; the jurisdiction's slabs freeze as a copy of the regional
       layer (there is no version row to point at — the copy IS the record, keyed by effective_from). */
    const govIds = ids.filter(taxGov.isGovernedId);
    const ownIds = ids.filter((i) => !taxGov.isGovernedId(i));

    const r = ownIds.length ? await withEntity(entity_id, (db) => db.query(
      `SELECT d.definition_id, d.kind, d.sub_kind, d.name, d.status,
              v.version, v.rules
         FROM definition d
         JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.definition_id = ANY($1::uuid[])`, [ownIds])) : { rows: [] };

    const at = new Date().toISOString();
    const frozen = r.rows.map((x) => ({
      definition_id: x.definition_id, version: x.version, kind: x.kind, sub_kind: x.sub_kind,
      name: x.name, rules: x.rules, frozen_at: at
    }));
    /**
     * ⚠️ WHAT WAS NOT FOUND IS RETURNED, NOT SWALLOWED. A caller freezing three definitions and silently
     * receiving two would stamp a chit missing a term it believed it had — and would not find out until the
     * dispute. RLS also means "not yours" and "does not exist" look identical here, which is correct: neither is
     * something this entity may learn more about.
     */
    if (govIds.length) {
      const gov = await taxGov.governedSlabsFor(entity_id, { query, regionLayer: regional.regionLayer });
      gov.filter((g) => govIds.includes(g.definition_id)).forEach((g) => frozen.push(taxGov.frozenCopy(g, at)));
    }
    const found = new Set(frozen.map((f) => String(f.definition_id)));
    res.json({ frozen, missing: ids.filter((i) => !found.has(i)), frozen_at: at });
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

module.exports = router;
