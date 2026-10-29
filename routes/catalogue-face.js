// CARD storefront-and-catalogue/products-routes
// OWNS /api/catalogue-face: this entity's saved catalogue setup (read, and save whole, refusing a declaration the catalogue cannot enforce) · CALLED BY server.js (app.use('/api/catalogue-face')), the catalogue setup screens.
// FLOW  auth → schema check (lib/catalogue-contract.js) → withEntity → catalogue_face; a refusal → problem(req, res, { status, ...words.x() }), its old body frozen in docs/contracts/api-legacy.json
// routes/catalogue-face.js — CATALOGUE FACE persistence: the catalogue setup config (purpose · method · units ·
// facets · tax · ERP mapping), stored per entity so the SAME setup follows the user across machines/browsers (was
// browser-localStorage only). The catalogue ITEMS live in catalogue_items (real products); this holds only the face.
// catalogue_face is RLS-protected (b112) -> every query runs inside withEntity(caller). One row per entity.
const express = require('express');
const log = require('../lib/logger');
const router = express.Router();
const { withEntity, query } = require('../db');
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { words, failed, schemaOptionsFor, face: faceContract } = require('../lib/catalogue-contract'); // the contract (each route's operation) and the words of a refusal
const auth = require('../middleware/auth');
const rateDoor = require('../lib/rate-door'); // CAT-211: the shop's default rate (face.tax.default_slab) is owner or manager only, like every rate door

const ent = (req) => auth.entityOf(req);
/** CAT-211: would this save change the shop's default rate? Only asked of a caller who may not set one (an editor pays the one stored read; an owner or manager never does). */
async function editorChangesDefaultRate(req, entityId, face) {
  if (rateDoor.setsRate(req)) return false;
  const stored = await withEntity(entityId, (db) => db.query(`SELECT face FROM catalogue_face WHERE entity_id = $1`, [entityId]));
  return rateDoor.faceRateChanged(face, stored.rows.length ? stored.rows[0].face : null);
}
/** every declaration of this face that the catalogue cannot enforce, in words (T1.1 follow-up; moved out of the PUT so the route reads as its steps) */
async function declarationErrors(face, e) {
  // T1.1 follow-up — TELL THE OWNER when a declaration cannot be enforced.
  // resolve() reports unsupported keywords, but nothing surfaced them, so declaring `pattern` on a GSTIN field was
  // still silently dropped — the same class of problem the whitelist exists to end, moved one step later. The save
  // is REJECTED here, at the moment the owner writes it, which is the only point where the message is useful.
  const orderInput = require('../lib/order-input');
  const declErrors = [];
  if (face.order_input) declErrors.push(...orderInput.resolve(face.order_input).errors.map((item) => 'catalogue: ' + item));
  for (const it of Array.isArray(face.items) ? face.items : []) {
    if (it && it.order_input) {
      declErrors.push(...orderInput.resolve(it.order_input).errors.map((item) => `item "${it.name || it.product || '?'}": ${item}`));
    }
  }
  // Same rule for the IDENTITY declaration: what makes a line unique, which field names the product it belongs
  // to, and which fields distinguish variants. A declaration naming a column the catalogue does not have is worse
  // than no declaration — every line would fail to identify, so every upload would look like a catalogue full of
  // brand new products, and a second upload of the same sheet would duplicate all of them.
  if (face.identity) {
    const identity = require('../lib/identity');
    const ident = identity.resolve(face);
    // Plain query, like products.js: schema_fields/entity_schemas are read the same way there.
    const cols = await query(
      `SELECT sf.field_key FROM schema_fields sf
         JOIN entity_schemas es ON es.schema_id = sf.schema_id
        WHERE es.entity_id = $1 AND es.status='active' AND es.is_default=true`,
      [e]
    ).catch(log.orElse('catalogue-face PUT /: the read failed — answered with none', { rows: [] }));
    const have = cols.rows.map((item) => item.field_key);
    // Only check when there is something to check against — an entity with no schema yet would otherwise be told
    // every field it names is missing.
    if (have.length) declErrors.push(...identity.check(ident, have).map((item) => 'identity: ' + item));
  }
  return declErrors;
}
const MAX_BYTES = 1_000_000; // a face is a small config object; cap so this never becomes a document store

// GET /api/catalogue-face — this entity's saved face (null if none yet).
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(`SELECT face, updated_at FROM catalogue_face WHERE entity_id = $1`, [e]));
    res.json({ face: r.rows.length ? r.rows[0].face : null, updated_at: r.rows.length ? r.rows[0].updated_at : null });
  } catch (err) {
    problem(req, res, failed(err, req, 'Load failed'));
  }
});

// PUT /api/catalogue-face — upsert the whole face config { face: {...} }.
router.put('/', auth, schemaValidate(faceContract.operationFor('PUT /'), schemaOptionsFor('PUT /')), async (req, res) => {
  try {
    const e = ent(req);
    const face = req.body && req.body.face;
    if (face === undefined || face === null || typeof face !== 'object' || Array.isArray(face)) {
      return problem(req, res, { status: 400, ...words.faceNotAnObject() });
    }
    if (Buffer.byteLength(JSON.stringify(face)) > MAX_BYTES) {
      return problem(req, res, { status: 413, ...words.faceTooLarge(MAX_BYTES) });
    }
    if (await editorChangesDefaultRate(req, e, face)) return problem(req, res, { status: 403, ...words.rateOwnerOnly() }); // the whole save is refused, nothing written
    const declErrors = await declarationErrors(face, e);
    if (declErrors.length) {
      return problem(req, res, { status: 422, ...words.notSupported(declErrors) });
    }
    const r = await withEntity(e, (db) =>
      db.query(
        `INSERT INTO catalogue_face (entity_id, face, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (entity_id) DO UPDATE SET face = EXCLUDED.face, updated_at = now()
       RETURNING updated_at`,
        [e, face]
      )
    );
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) {
    problem(req, res, failed(err, req, 'Save failed'));
  }
});

router.openapi = { paths: faceContract.pathsOf() }; // S9: the 2 routes (lib/catalogue-contract.js)

module.exports = router;
