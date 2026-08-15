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
const { withEntity } = require('../db');
const { validate } = require('../middleware/validate');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');

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
    const params = [entity_id];
    let where = 'entity_id = $1';
    if (req.query.kind)   { params.push(String(req.query.kind));   where += ` AND kind = $${params.length}`; }
    if (req.query.status) { params.push(String(req.query.status)); where += ` AND status = $${params.length}`; }
    /**
     * ⚠️ RETIRED IS HIDDEN BY DEFAULT BUT REACHABLE. `?status=retired` returns them, and `?all=1` returns
     * everything. A shelf that silently omits retired items is how someone re-creates a definition they already
     * retired — the same reasoning products.js applies to item status.
     */
    else if (!req.query.all) where += ` AND status <> 'retired'`;

    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT d.*, v.rules, v.created_at AS version_at
         FROM definition d
         LEFT JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE ${where}
        ORDER BY d.kind, d.name`, params));
    res.json({ definitions: r.rows, count: r.rows.length });
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/** GET /:id — one definition with its FULL version history. The history is the point, so it is not optional. */
router.get('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const d = await withEntity(entity_id, (db) => db.query(
      `SELECT * FROM definition WHERE definition_id = $1`, [req.params.id]));
    if (!d.rows.length) return res.status(404).json({ error: 'Not found' });
    const v = await withEntity(entity_id, (db) => db.query(
      `SELECT version, rules, note, created_at, created_by FROM definition_version
        WHERE definition_id = $1 ORDER BY version DESC`, [req.params.id]));
    res.json({ definition: d.rows[0], versions: v.rows });
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
      const rules = (req.body && typeof req.body.rules === 'object' && req.body.rules) || {};

      /**
       * ⚠️ ONE TRANSACTION, BOTH ROWS. A definition whose version 1 failed to write is a definition with no
       * rules — it would list on the shelf, resolve to nothing, and freeze nothing onto a chit that cited it.
       * The pair is the unit, exactly as putForParticipantsInTx treats a chit and its documents.
       */
      const out = await withEntity(entity_id, async (db) => {
        const d = await db.query(
          `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
           VALUES ($1,$2,$3,$4,$5,'draft',1,$6) RETURNING *`,
          [entity_id, String(kind).trim(), sub_kind ? String(sub_kind).trim() : null,
           String(name).trim().slice(0, MAX_NAME), note ? String(note).slice(0, MAX_NOTE) : null,
           req.identity && req.identity.identity_id]);
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
router.put('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const rules = (req.body && typeof req.body.rules === 'object') ? req.body.rules : null;
    const { name, note, status } = req.body || {};

    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT * FROM definition WHERE definition_id = $1`, [req.params.id]);
      if (!cur.rows.length) return { missing: true };
      const d = cur.rows[0];
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
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE definition SET status = 'retired', updated_at = now()
        WHERE definition_id = $1 RETURNING definition_id`, [req.params.id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Retired — not deleted. Chits that cite it stay explainable.', retired: true });
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

    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT d.definition_id, d.kind, d.sub_kind, d.name, d.status,
              v.version, v.rules
         FROM definition d
         JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.definition_id = ANY($1::uuid[])`, [ids]));

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
    const found = new Set(frozen.map((f) => String(f.definition_id)));
    res.json({ frozen, missing: ids.filter((i) => !found.has(i)), frozen_at: at });
  } catch (e) { if (notMigrated(e)) return gone(res);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

module.exports = router;
