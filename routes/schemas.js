// routes/schemas.js — Schema engine basic
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
/* ⚠️ withEntity, not bare query, for anything reading catalogue_items: that table carries the b49 per-entity
   policy, and a read with no tenant context matches NOTHING rather than everything. */
const { query, withEntity } = require('../db');
const { validate } = require('../middleware/validate');
/* ⭐ ONE PLACE DECIDES REMOVABILITY — the GET reports it and the DELETE enforces it from the same function, so a
   screen can never be told a column is removable and then refused. */
const columnRules = require('../lib/column-rules');
const auth = require('../middleware/auth');

// GET /api/schemas/my — does entity have a schema?
router.get('/my', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;
    const schema = await query(
      `SELECT es.*, json_agg(sf ORDER BY sf.display_order) as fields
       FROM entity_schemas es
       LEFT JOIN schema_fields sf ON sf.schema_id = es.schema_id
       WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
       GROUP BY es.schema_id`,
      [entity_id]
    );
    res.json({ schema: schema.rows[0] || null });
  } catch (err) {
    console.error('Schema fetch error:', err.message);
    res.status(500).json({ error: 'Failed to get schema', message: safeErr(err) });
  }
});

// POST /api/schemas/create-default — create Product Qty Price schema
router.post('/create-default', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;
    // ONE implementation (also called at mint) — idempotent: returns the existing active schema instead of 400.
    const r = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
    if (r.error || !r.schema_id) return res.status(500).json({ error: 'Failed to create schema', message: r.error || 'no schema' });
    const result = await query(
      `SELECT es.*, json_agg(sf ORDER BY sf.display_order) as fields
       FROM entity_schemas es
       JOIN schema_fields sf ON sf.schema_id = es.schema_id
       WHERE es.schema_id = $1
       GROUP BY es.schema_id`,
      [r.schema_id]
    );
    res.json({ message: r.created ? 'Schema created' : 'Schema already exists', schema: result.rows[0] });
  } catch (err) {
    console.error('Schema create error:', err.message);
    res.status(500).json({ error: 'Failed to create schema', message: safeErr(err) });
  }
});

// GET /api/schemas/fields — get fields for compose form
/**
 * GET /api/schemas/fields — the catalogue's columns, and HOW MANY PRODUCTS USE EACH.
 *
 * Athi, 2026-09-02: *"it should be very flexible initially, but once data loaded, the panel has to be tightened
 * what they can do, what they cannot."*
 *
 * ⭐⭐ THE USAGE COUNT IS WHAT MAKES THAT RULE OPERABLE. "Tightened once data is loaded" is not a property of the
 * catalogue as a whole — it is a property of EACH COLUMN. A shop with 400 products may still have added `grade`
 * an hour ago and used it nowhere, and that column is as free to remove as it was on day one. Counting per
 * column is the difference between a rule that fits the work and one that locks the screen the moment anything
 * exists.
 *
 * ⚠️ ONE QUERY, NOT ONE PER COLUMN. A lateral count per field would be O(columns) round trips on a screen that
 * opens on every visit to Catalogue setup — Athi's standing rule: *"any of this implementation, if it is greater
 * than O(1), is not required."* The jsonb keys of every active item are unrolled once and counted.
 *
 * ⚠️ AND AN EMPTY VALUE IS NOT USE. `''` and null mean the column exists on the row and says nothing — removing
 * it loses no fact. Only a value somebody actually recorded counts, which is the same line `isMatchable` and
 * `countedZero` draw elsewhere: absent is not zero.
 */
router.get('/fields', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf ? auth.entityOf(req) : req.identity.identity_id;
    const fields = await query(
      `SELECT sf.* FROM schema_fields sf
       JOIN entity_schemas es ON es.schema_id = sf.schema_id
       WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
       ORDER BY sf.display_order ASC`,
      [entity_id]
    );
    let used = {};
    try {
      const u = await withEntity(entity_id, (db) => db.query(
        `SELECT kv.key AS field_key, count(*)::int AS n
           FROM catalogue_items ci, LATERAL jsonb_each_text(ci.item_data) AS kv
          WHERE ci.entity_id = $1 AND ci.is_active = true
            AND kv.value IS NOT NULL AND btrim(kv.value) <> ''
          GROUP BY kv.key`, [entity_id]));
      u.rows.forEach((r) => { used[r.field_key] = r.n; });
    } catch (_) { used = {}; }   /* a counting failure must not hide the columns themselves */

    res.json({ fields: fields.rows.map((f) => Object.assign({}, f, {
      used_by: used[f.field_key] || 0,
      /* ⭐ THE ANSWER, COMPUTED ONCE, SO EVERY SURFACE AGREES. A screen that decides removability for itself is a
         screen that will disagree with the server the day one of them changes. */
      removable: columnRules.removable({ field_key: f.field_key, field_name: f.field_name, required: f.required, used_by: used[f.field_key] || 0 }),
      /* ⭐ AND THE REASON TRAVELS WITH IT, so the screen can say WHY a control is dead rather than only that it is. */
      locked_because: columnRules.why({ field_key: f.field_key, field_name: f.field_name, required: f.required, used_by: used[f.field_key] || 0 }),
    })),
      /* ⭐ SHOWN BESIDE THE DECLARED ONES, NEVER MIXED WITH THEM. A product records these, so a panel headed
         "what every product records" must list them — but they are managed elsewhere and their SHAPE is
         load-bearing, so they travel in their own array rather than as columns with a disabled tickbox. */
      system: columnRules.SYSTEM_FIELDS.map(function(f){ return Object.assign({}, f, { used_by: used[f.field_key] || 0 }); }),
    });
  } catch (err) {
    console.error('Schema fields error:', err.message);
    res.status(500).json({ error: 'Failed to get fields', message: safeErr(err) });
  }
});


/**
 * DELETE /api/schemas/fields/:field_key — remove a column, but only while nothing has said anything in it.
 *
 * ⭐⭐ THIS IS THE "FLEXIBLE INITIALLY" HALF, AND IT WAS THE HALF THAT WAS MISSING. `schema_fields` had no DELETE
 * and no UPDATE anywhere in the codebase — columns were insert-only for everyone, for ever. So the data was
 * already safe, and the cost was borne entirely by the person who adopted a set to get eight columns and had the
 * other three on every form permanently.
 *
 * ⚠️ REFUSED WITH A NUMBER, NEVER A BARE NO. "12 products use this" tells someone what to do next — clear the
 * column on those twelve, or keep it. "Cannot remove" tells them only that the software disagrees with them.
 *
 * ⚠️ IT DELETES THE COLUMN, NOT THE DATA. Nothing touches `item_data`: a key left on a row that no longer has a
 * column is inert, and it means a removal can be undone by re-adding the column. Rewriting every product to strip
 * a key would make an undo impossible and would be a mass edit nobody asked for.
 */
router.delete('/fields/:field_key', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf ? auth.entityOf(req) : req.identity.identity_id;
    const key = String(req.params.field_key || '').trim();
    if (!key) return res.status(400).json({ error: 'No column', message: 'Name the column to remove.' });
    if (columnRules.LOCKED.has(key)) {
      return res.status(409).json({ error: 'Cannot remove', code: 'LOCKED',
        message: `"${key}" is one of the three columns every catalogue keeps — the cart, the storefront and the export all read it.` });
    }
    const f = await query(
      `SELECT sf.field_id, sf.field_name, sf.required, sf.schema_id
         FROM schema_fields sf
         JOIN entity_schemas es ON es.schema_id = sf.schema_id
        WHERE es.entity_id = $1 AND es.status='active' AND es.is_default=true AND sf.field_key = $2`,
      [entity_id, key]);
    if (!f.rows.length) return res.status(404).json({ error: 'Not found', message: 'Your catalogue has no such column.' });
    if (f.rows[0].required) {
      return res.status(409).json({ error: 'Cannot remove', code: 'REQUIRED',
        message: `"${f.rows[0].field_name}" is required by your catalogue definition. Make it optional first.` });
    }

    const u = await withEntity(entity_id, (db) => db.query(
      `SELECT count(*)::int AS n FROM catalogue_items ci
        WHERE ci.entity_id = $1 AND ci.is_active = true
          AND ci.item_data ? $2 AND btrim(COALESCE(ci.item_data->>$2, '')) <> ''`, [entity_id, key]));
    const n = (u.rows[0] && u.rows[0].n) || 0;
    if (n > 0) {
      return res.status(409).json({ error: 'Cannot remove', code: 'IN_USE', used_by: n,
        message: `${n} product${n === 1 ? '' : 's'} record a value in "${f.rows[0].field_name}". Clear it on those first, or keep the column.` });
    }

    await query(`DELETE FROM schema_fields WHERE field_id = $1`, [f.rows[0].field_id]);
    res.json({ message: `Removed "${f.rows[0].field_name}"`, field_key: key });
  } catch (err) {
    console.error('Schema field delete error:', err.message);
    res.status(500).json({ error: 'Failed to remove the column', message: safeErr(err) });
  }
});


/**
 * PATCH /api/schemas/fields/order — move a column up or down.
 *
 * Athi, 2026-09-02: *"can they move the column up or down, depends on their own catalogue"* — and yes, because
 * the order a trade reads its own catalogue in is theirs, not ours. Gold reads fineness before description; a
 * grocer never reads fineness at all.
 *
 * ⭐⭐ AND REORDERING STAYS FLEXIBLE FOR EVER, WHICH IS THE INTERESTING HALF. Everything else on this screen
 * tightens as data arrives — a column with values in it cannot be removed. Order is different in kind: it is
 * PRESENTATION, not a fact about any product. Moving `grade` above `code` changes no value, invalidates no
 * import, and cannot make an existing row wrong. So the "tighten once loaded" rule does not apply to it, and
 * applying it anyway would be a restriction with nothing behind it.
 *
 * ⚠️ IT REORDERS WHAT IT IS GIVEN AND LEAVES THE REST ALONE. A partial list is honoured: anything unnamed keeps
 * its position after the named ones, so a screen that sends only the visible page cannot silently reshuffle
 * columns nobody was looking at.
 */
router.patch('/fields/order', auth,
  [ body('order').isArray({ min: 1 }) ], validate,
  async (req, res) => {
    try {
      const entity_id = auth.entityOf ? auth.entityOf(req) : req.identity.identity_id;
      const sid = await query(
        `SELECT schema_id FROM entity_schemas
          WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`, [entity_id]);
      if (!sid.rows.length) return res.status(404).json({ error: 'Not found', message: 'Your catalogue has no definition.' });
      const schema_id = sid.rows[0].schema_id;

      const own = await query(`SELECT field_key FROM schema_fields WHERE schema_id = $1`, [schema_id]);
      const mine = new Set(own.rows.map((r) => r.field_key));
      /* ⚠️ Only this catalogue's own columns, de-duplicated — a repeated key would otherwise take two positions
         and leave a gap that the next reorder would read as an ordering. */
      const wanted = [...new Set(req.body.order.map(String).filter((k) => mine.has(k)))];
      if (!wanted.length) return res.status(400).json({ error: 'Nothing to order', message: 'None of those columns are in your catalogue.' });

      let n = 0;
      for (const k of wanted) {
        await query(`UPDATE schema_fields SET display_order = $1 WHERE schema_id = $2 AND field_key = $3`,
          [++n, schema_id, k]);
      }
      /* Everything not named keeps its relative order, after the ones that were. */
      const rest = own.rows.map((r) => r.field_key).filter((k) => !wanted.includes(k));
      for (const k of rest) {
        await query(`UPDATE schema_fields SET display_order = $1 WHERE schema_id = $2 AND field_key = $3`,
          [++n, schema_id, k]);
      }
      res.json({ message: 'Order saved', ordered: wanted.length, untouched: rest.length });
    } catch (err) {
      console.error('Schema field order error:', err.message);
      res.status(500).json({ error: 'Failed to save the order', message: safeErr(err) });
    }
  });

// PATCH /api/schemas/visibility — set catalogue visibility (private | restricted | public)
router.patch('/visibility', auth,
  [ body('visibility').isIn(['private','restricted','public']) ], validate,
  async (req, res) => {
    try {
      const entity_id = auth.entityOf(req);
      const r = await query(
        `UPDATE entity_schemas SET visibility = $1
         WHERE entity_id = $2 AND status = 'active' AND is_default = true
         RETURNING schema_id, visibility`,
        [req.body.visibility, entity_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No active catalogue to update' });
      res.json({ message: 'Visibility updated', visibility: r.rows[0].visibility });
    } catch (err) { res.status(500).json({ error: 'Visibility update failed', message: safeErr(err) }); }
  });

module.exports = router;
