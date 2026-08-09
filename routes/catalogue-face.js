// routes/catalogue-face.js — CATALOGUE FACE persistence: the catalogue setup config (purpose · method · units ·
// facets · tax · ERP mapping), stored per entity so the SAME setup follows the user across machines/browsers (was
// browser-localStorage only). The catalogue ITEMS live in catalogue_items (real products); this holds only the face.
// catalogue_face is RLS-protected (b112) -> every query runs inside withEntity(caller). One row per entity.
const express = require('express');
const router  = express.Router();
const { withEntity, query } = require('../db');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');

const ent = (req) => auth.entityOf(req);
const MAX_BYTES = 1_000_000;   // a face is a small config object; cap so this never becomes a document store

// GET /api/catalogue-face — this entity's saved face (null if none yet).
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(
      `SELECT face, updated_at FROM catalogue_face WHERE entity_id = $1`, [e]));
    res.json({ face: r.rows.length ? r.rows[0].face : null, updated_at: r.rows.length ? r.rows[0].updated_at : null });
  } catch (err) { res.status(500).json({ error: 'Load failed', message: safeErr(err) }); }
});

// PUT /api/catalogue-face — upsert the whole face config { face: {...} }.
router.put('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const face = req.body && req.body.face;
    if (face === undefined || face === null || typeof face !== 'object' || Array.isArray(face)) {
      return res.status(400).json({ error: 'Bad request', message: 'face must be an object' });
    }
    if (Buffer.byteLength(JSON.stringify(face)) > MAX_BYTES) {
      return res.status(413).json({ error: 'Too large', message: 'face exceeds ' + MAX_BYTES + ' bytes' });
    }
    // T1.1 follow-up — TELL THE OWNER when a declaration cannot be enforced.
    // resolve() reports unsupported keywords, but nothing surfaced them, so declaring `pattern` on a GSTIN field was
    // still silently dropped — the same class of problem the whitelist exists to end, moved one step later. The save
    // is REJECTED here, at the moment the owner writes it, which is the only point where the message is useful.
    const orderInput = require('../lib/order-input');
    const declErrors = [];
    if (face.order_input) declErrors.push(...orderInput.resolve(face.order_input).errors.map((m) => 'catalogue: ' + m));
    for (const it of (Array.isArray(face.items) ? face.items : [])) {
      if (it && it.order_input) {
        declErrors.push(...orderInput.resolve(it.order_input).errors.map((m) => `item "${(it.name || it.product || '?')}": ${m}`));
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
          WHERE es.entity_id = $1 AND es.status='active' AND es.is_default=true`, [e]).catch(() => ({ rows: [] }));
      const have = cols.rows.map((r) => r.field_key);
      // Only check when there is something to check against — an entity with no schema yet would otherwise be told
      // every field it names is missing.
      if (have.length) declErrors.push(...identity.check(ident, have).map((m) => 'identity: ' + m));
    }
    if (declErrors.length) {
      return res.status(422).json({ error: 'Declaration not supported', message: declErrors.join('; '), errors: declErrors });
    }
    const r = await withEntity(e, (db) => db.query(
      `INSERT INTO catalogue_face (entity_id, face, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (entity_id) DO UPDATE SET face = EXCLUDED.face, updated_at = now()
       RETURNING updated_at`, [e, face]));
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) { res.status(500).json({ error: 'Save failed', message: safeErr(err) }); }
});

module.exports = router;
