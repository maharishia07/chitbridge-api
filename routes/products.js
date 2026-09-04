// routes/products.js — B3.7a Catalogue items (products) CRUD + search
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity, readBatch } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');
const money = require('../lib/money');          // a price is never a bare number — stamped on write
const availability = require('../lib/availability');   // a quantity is not an answer without a date
/* ⚠️ NOT the same as `availability` above. That is a QUANTITY feed — how many are on the shelf. This is the
   item's LIFECYCLE — whether it is something you sell at all. A shelf can be empty without the product being
   retired, and a retired product can still have stock nobody may order. */
const itemstatus = require('../lib/itemstatus');
const regional = require('../lib/regional');    // the currency comes from the ENTITY, never from the request
const csv = require('../lib/csv');              // catalogue export — a merchant can leave the way they arrived
/* ⭐ THE ONE WRITER + THE ONE RESOLVER. The declaration and the store were never bound; this binds them. */
const catcols = require('../lib/catalogue-columns');
const schedule = require('../lib/schedule');
/* ⭐ the catalogue declares, a row overrides — a reader sees the resolved value. */
const defaults = require('../lib/defaults');
/* ⭐ A SPREADSHEET CARRIES ANSWERS, NOT RECORDS — flatten on the way out, stamp on the way in. */
const sheet = require('../lib/sheet');
const orderInput = require('../lib/order-input'); // the shop's declared contract — the template is a projection of it
const preflight = require('../lib/csv-preflight'); // read an upload BEFORE it becomes data — proposes, never decides
const identity  = require('../lib/identity');       // which line is this, and which product does it belong to
const starter   = require('../lib/starter-fields'); // the standard column set for a trade — an empty catalogue is not a blank page

/**
 * A DELIBERATE refusal must not be reported as an internal failure.
 *
 * Found live: the currency-mismatch guard fired correctly — nothing was stored — but the caller got
 * `500 "Something went wrong — please try again."` because the catch blocks discarded `e.status`. Retrying would
 * never have helped, and the one message that would have explained the problem ("this catalogue is priced in INR")
 * was thrown away. A guard that refuses for a good reason and reports a bad one teaches the user nothing.
 *
 * Deliberate 4xx keeps its status and its message; anything else stays a sanitised 500.
 */
function fail(res, e, label) {
  if (e && e.status && e.status >= 400 && e.status < 500) {
    return res.status(e.status).json({ error: label, message: e.message });
  }
  return res.status(500).json({ error: label, message: safeErr(e) });
}
const ctx = (req) => auth.entityOf(req);

async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`, [entity_id]);
  return r.rows[0]?.schema_id || null;
}

// Validate a product against its schema fields. Returns an error message, or null if valid.
// Rules: required fields not empty · number fields numeric, not negative, respect min_value.
// `quantity` is excluded — the customer sets it at order time.
/**
 * Read the rules ONCE. Athi, 2026-08-06: *"any of this implementation, if it is greater than O(1), is not required
 * — it will be very costly."*
 *
 * He is right and this was mine: the import loop called validateItem() per row, and validateItem read schema_fields
 * every time. A 2000-row upload fired 2000 identical queries for a rule set that cannot change mid-import.
 *
 * The fields are now fetched once and validated in memory, so validation is O(1) in round trips however many rows
 * arrive. `validateItem` keeps its old shape for the single-add and single-edit paths, where one query IS the
 * whole cost.
 */
async function schemaFieldsOf(schema_id) {
  if (!schema_id) return [];
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`, [schema_id]);
  return f.rows;
}

async function validateItem(schema_id, item_data) {
  if (!schema_id) return null;
  return validateAgainst(await schemaFieldsOf(schema_id), item_data);
}

/** Pure: the same rules, against rows already in hand. No I/O. */
function validateAgainst(fieldRows, item_data) {
  const f = { rows: fieldRows || [] };
  for (const field of f.rows) {
    if (field.field_key === 'quantity') continue;
    // A stamped price is `{amount, currency}`, and String() on that is "[object Object]" → NaN → "must be a number".
    // Found in production, not in tests: it rejected a legitimate ROUND-TRIP EDIT (read an item, change the name,
    // write it back) and it also swallowed the currency-mismatch case before money.stampPrice could refuse it
    // properly — so the spoof was blocked by accident of ordering rather than by the guard built for it.
    // Validate a money value on its AMOUNT; the currency is checked at stamping, where it belongs.
    const rawV = item_data?.[field.field_key];
    const v = (money.isMoney(rawV) ? String(rawV.amount) : (rawV == null ? '' : String(rawV))).trim();
    if (field.required && !v) return `${field.field_name} is required`;
    if (field.field_type === 'number' && v !== '' && !catcols.IDENT_KEYS.has(field.field_key)) {   /* a code is text even when declared number by an early numeric value */
      const n = Number(v);
      if (Number.isNaN(n))            return `${field.field_name} must be a number`;
      if (n < 0)                      return `${field.field_name} cannot be negative`;
      if (field.min_value != null && n < Number(field.min_value))
                                      return `${field.field_name} must be at least ${field.min_value}`;
    }
  }
  return null;
}

/** This entity's declared face (b112). Tolerant: no face is a valid state, not an error. */
async function faceOf(entity_id) {
  try {
    const f = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    return (f.rows[0] && f.rows[0].face) || {};
  } catch (_) { return {}; }
}

/** The accepted format + the shop's contract, built once so preflight, import and template cannot disagree. */
async function catalogueShape(entity_id) {
  const labels = {};     // field_key → the name the merchant sees, so their own column heading matches their own field
  const required = [];   // what the schema actually insists on — NOT 'everything that is not an optional extra'
  let oi = orderInput.resolve(null);
  let face0 = {};        // the whole declared face — order_input AND identity both come from it
  try {
    const f = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    face0 = (f.rows[0] && f.rows[0].face) || {};
    oi = orderInput.resolve(face0.order_input || (face0.method ? { preset: face0.method } : null));
  } catch (_) { /* no face declared → the cart default, which is how the shop behaves */ }

  /**
   * ⭐⭐ ONE RESOLVER, SO THE TEMPLATE CANNOT DISAGREE WITH THE EXPORT OR THE COLUMNS PANEL.
   *
   * ⚠️ AND THE `LIMIT 200` IS GONE. This used to observe only the newest 200 items, so a column carried solely by
   * product #201 was absent from the template and present in the export — a difference with no explanation
   * available to the person who met it, and no way to even notice it until a round trip lost data. The scan is
   * one GROUP BY, the same query the Columns panel already runs for its usage counts, so correctness here is
   * free rather than bought.
   */
  const sid = await defaultSchemaId(entity_id);
  const cols = await catcols.resolveColumns({ query, withEntity, entity_id, schema_id: sid });
  let schema = null;
  if (sid) {
    schema = { properties: Object.fromEntries(cols.declared.map((x) => [x.field_key, {}])) };
    for (const x of cols.declared) {
      if (x.field_name) labels[x.field_key] = x.field_name;
      // The SCHEMA decides what a file must carry. Inferring it from 'not optional' told a catalogue that declares
      // code and desc that every upload was incomplete without them.
      if (x.required && x.field_key !== 'quantity') required.push(x.field_key);
    }
  }
  /**
   * ⭐⭐ A DEFAULTABLE COLUMN APPEARS ONLY WHEN IT HAS EARNED ITS PLACE — Athi: "unit yes, pricing model rarely,
   * offers never." `unit` is always offered because people genuinely set it per product. `pricing_model` is
   * offered only once some row actually differs from the catalogue: a shop that prices everything one way should
   * never be handed a column it has to wonder about, and that is the whole anti-wide-sheet rule.
   *
   * ⚠️ It needs the ROWS, not just the declaration, because "does anything differ?" is a question about data.
   * See lib/defaults.columnsFor.
   */
  let defCols = [];
  try {
    const sample = await withEntity(entity_id, (db) => db.query(
      `SELECT item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true`, [entity_id]));
    defCols = defaults.columnsFor(sample.rows.map((r) => r.item_data || {}), face0);
  } catch (_) { defCols = defaults.columnsFor([], face0); }

  const observed = cols.columns.concat(defCols.filter((k) => cols.columns.indexOf(k) < 0));
  const ident = identity.resolve(face0);
  return { schema_id: sid, labels, identity: ident, identityProblems: identity.check(ident, Object.keys((schema && schema.properties) || {})), required: required.length ? required : ['name'], template: csv.templateFor({ schema, orderInput: oi, observed }), orderInput: oi };
}

// CREATE — add a product
router.post('/', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const schema_id = await defaultSchemaId(entity_id);
    /**
     * ⭐⭐ DECLARE WHAT WE STORE. This route used to accept `{name, price, grade}` on a catalogue that had never
     * declared `grade`, and simply write it — so a column existed in the DATA that no declaration knew about, and
     * the Columns panel, the template and the export each answered "what are my columns" differently.
     *
     * ⚠️ THE CSV IMPORT ALREADY DID THIS CORRECTLY and this route did not, which is the part that made it a bug
     * rather than a design: the SAME act — adding a product with a new field — behaved differently depending on
     * which door it came through. One writer, so there is one behaviour. See lib/catalogue-columns.js.
     */
    const decl = await catcols.ensureDeclared({
      query, entity_id, schema_id, item_data: req.body.item_data,
      ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
      validate: (data, rows) => validateAgainst(rows, data),
    });
    if (decl.error) return res.status(400).json({ error: 'Invalid product', message: decl.error });
    // STAMP: the price acquires the OWNING ENTITY's currency here and nowhere else. Validation runs first, on the
    // raw shape, so the schema still sees the number a person typed.
    const item_data = money.stampItem(decl.item_data, await regional.currencyFor(entity_id));
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
       VALUES ($1,$2,$3) RETURNING *`,
      [entity_id, decl.schema_id || schema_id, JSON.stringify(item_data)]));
    /* ⭐ Metered after the write, best-effort, never blocking — see lib/meter.js. */
    try { require('../lib/meter').meter(entity_id, 'catalogue.item', {
      detail: r.rows[0] && r.rows[0].item_id, rid: req.id }).catch(() => {}); } catch (_) {}
    /* The new columns and any near-miss warning travel with the answer, so the screen can say what it did. */
    res.json({ message: 'Product added', item: r.rows[0], declared: decl.declared, warnings: decl.warnings });
  } catch (e) { fail(res, e, 'Add failed'); }
});

/**
 * ⭐⭐ MANY PRODUCTS, ONE ROUND TRIP — Athi, 2026-09-01: *"assigning a category to a set of products, why it
 * takes loads of time, are you going round trip for each product? can you gather all information at once for
 * the products selected and update instead of making a round trip."*
 *
 * He was right. The catalogue wizard posted to `POST /api/products` once per item, STRICTLY SEQUENTIALLY —
 * each waiting for the one before. At the measured ~500 ms floor for an authed round trip, forty items is
 * twenty seconds of watching a toast.
 *
 * ⭐ What actually cost the time was not the inserts. Per item it paid: a schema lookup, a currency lookup, a
 * validation, a BEGIN, a set_config, an INSERT and a COMMIT. The schema and the currency are the SAME for every
 * item in the request, and the transaction can hold all of them — so this resolves each once and inserts the
 * lot in a single statement.
 *
 * ⚠️ VALIDATE EVERY ITEM BEFORE WRITING ANY. The sequential version tolerated per-item failure by skipping it,
 * which meant a typo in item 30 left 29 products created and no clear record of what went missing. All-or-
 * nothing with the failing INDEXES named is the honest trade: nothing is half-done, and the caller is told
 * exactly which rows to fix.
 *
 * ⚠️ CAPPED. A request is not a migration; 200 is far above any real catalogue paste and keeps one caller from
 * holding a transaction open over thousands of rows.
 */
const BULK_MAX = 200;

router.post('/bulk', auth, [ body('items').isArray({ min: 1 }) ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const items = req.body.items;
    if (items.length > BULK_MAX) {
      return res.status(400).json({ error: 'Too many', message: `At most ${BULK_MAX} items in one request.` });
    }
    if (!items.every((it) => it && typeof it === 'object' && !Array.isArray(it))) {
      return res.status(400).json({ error: 'Invalid product', message: 'Every item must be an object.' });
    }

    /* Resolved ONCE for the whole request — this is most of what the per-item version was paying for. */
    const schema_id = await defaultSchemaId(entity_id);
    const currency = await regional.currencyFor(entity_id);

    /**
     * ⚠️ THE RULES WERE STILL BEING READ ONCE PER ITEM. `validateItem` queries `schema_fields` on every call, so a
     * 200-item paste fired 200 identical queries for a rule set that cannot change mid-request — the exact cost
     * the header above says was fixed for the import, in a route written afterwards to be fast. Read once, judge
     * in memory, the way the import already does.
     */
    let ruleRows = await schemaFieldsOf(schema_id);
    const bad = [];
    for (let i = 0; i < items.length; i++) {
      const verr = validateAgainst(ruleRows, items[i]);
      if (verr) bad.push({ index: i, message: verr });
    }
    if (bad.length) {
      return res.status(400).json({ error: 'Invalid product',
        message: bad.length + ' item(s) were refused and nothing was written.', invalid: bad });
    }

    /**
     * ⭐ DECLARE FIRST, FOR THE WHOLE BATCH — same rule as the single add, and it must be the same rule or the two
     * doors disagree again. Validation has already passed above, so nothing is declared for a batch that was
     * refused; the declaration is committed once, in order, before any row is written.
     */
    const decl = await catcols.ensureDeclaredMany({
      query, entity_id, schema_id, items,
      ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
    });
    const sid = decl.schema_id || schema_id;

    /* STAMP after validation, on the raw shape, so the schema still sees the number a person typed. */
    const stamped = decl.items.map((it) => JSON.stringify(money.stampItem(it, currency)));

    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
       SELECT $1, $2, x FROM unnest($3::jsonb[]) AS x
       RETURNING *`,
      [entity_id, sid, stamped]));

    /* ⭐ Metered after the write, best-effort, never blocking — one event per item, same as the single add. */
    try {
      const meter = require('../lib/meter').meter;
      for (const row of r.rows) {
        meter(entity_id, 'catalogue.item', { detail: row.item_id, rid: req.id }).catch(() => {});
      }
    } catch (_) {}

    res.json({ message: r.rows.length + ' products added', added: r.rows.length, items: r.rows,
      declared: decl.declared, warnings: decl.warnings });
  } catch (e) { fail(res, e, 'Bulk add failed'); }
});

/**
 * ⭐⭐ AVAILABILITY FOR A SET OF PRODUCTS, IN ONE ROUND TRIP.
 *
 * Athi, 2026-09-01: *"in catalogue, I couldn't set the status of the product available / unavailable by
 * selecting the product(s). this is very important feature."*
 *
 * The single-item route has existed since the status model was built; there was no way to reach it for more
 * than one product, and the control that did exist was buried inside the all-fields modal. Same shape as
 * /bulk: resolve nothing per item that is the same for all of them, and write the lot in one statement.
 *
 * ⚠️ AVAILABLE AND UNAVAILABLE ONLY. `retired` and `redundant` are lifecycle decisions that carry a per-item
 * argument — what replaced it, until when — and a bulk form cannot ask that forty times. Offering them here
 * would collect one answer and stamp it on rows it was never about.
 *
 * ⚠️ ONE STAMP FOR THE WHOLE SET. itemstatus.stamp() records who set it and when; every row in a bulk change
 * genuinely was one decision by one person at one moment, so sharing the stamp is the honest record, not a
 * shortcut.
 */
const BULK_STATUS = ['available', 'unavailable'];

router.post('/status/bulk', auth,
  [ body('ids').isArray({ min: 1 }), body('status').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const ids = req.body.ids;
    if (ids.length > BULK_MAX) {
      return res.status(400).json({ error: 'Too many', message: `At most ${BULK_MAX} items in one request.` });
    }
    if (!ids.every((x) => typeof x === 'string' && x)) {
      return res.status(400).json({ error: 'Bad ids', message: 'Every id must be a string.' });
    }
    if (BULK_STATUS.indexOf(req.body.status) < 0) {
      return res.status(400).json({ error: 'Bad status',
        message: 'In bulk, status must be one of: ' + BULK_STATUS.join(', ')
          + '. retired and redundant need a per-item reason, so they are set one at a time.' });
    }
    /* ⚠️ THE SAME LIBRARY CALL THE SINGLE ROUTE MAKES — not a copy. A bulk path that re-implements the stamp is
       how the bulk answer and the single answer start disagreeing about what "unavailable" recorded. */
    const rec = itemstatus.stamp({ status: req.body.status }, { actor_name: req.identity.display_name });

    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items
          SET item_data = COALESCE(item_data, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
        WHERE entity_id = $2 AND item_id = ANY($3::uuid[])
      RETURNING item_id, item_data`,
      [JSON.stringify(rec), entity_id, ids]));

    /* ⚠️ SAY WHICH ONES DID NOT MOVE. An id that is not in this catalogue simply does not match, and a bulk
       action that reports "done" while three rows never changed is the reason nobody trusts bulk actions. */
    const done = r.rows.map((x) => x.item_id);
    const missed = ids.filter((i) => done.indexOf(i) < 0);
    res.json({ message: done.length + ' updated', updated: done.length, missed: missed,
      status: req.body.status,
      reads_as: r.rows.length ? itemstatus.explain(r.rows[0].item_data || {}) : null });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: 'Bad status', message: e.message });
    fail(res, e, 'Bulk status failed');
  }
});

/**
 * ⭐⭐ MANY EDITS, ONE ROUND TRIP — and this is the one Athi actually meant.
 *
 * *"assigning a category to a set of products, why it takes loads of time, are you going round trip for each
 * product?"* — yes. `prodCategoriseApply` looped `await api('prodEdit')` once per product, sequentially, each
 * paying for its own schema lookup, currency lookup, validation, BEGIN, set_config, UPDATE and COMMIT. Tick
 * forty rows to attach a category and that is forty round trips before the screen comes back.
 *
 * ⚠️ THE SCHEMA AND THE CURRENCY ARE THE SAME FOR EVERY ITEM IN THE REQUEST — that is most of what the loop was
 * paying for. Resolved once here.
 *
 * ⚠️ VALIDATE EVERY ITEM BEFORE WRITING ANY, and name the failing ids. The loop counted failures and carried on,
 * so a rejected row left the category attached to 39 of 40 and the toast said "39 updated" without saying which
 * one did not.
 */
router.post('/bulk-update', auth, [ body('items').isArray({ min: 1 }) ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const items = req.body.items;
    if (items.length > BULK_MAX) {
      return res.status(400).json({ error: 'Too many', message: `At most ${BULK_MAX} items in one request.` });
    }
    const shaped = items.every((it) => it && typeof it === 'object' && typeof it.id === 'string'
      && it.item_data && typeof it.item_data === 'object' && !Array.isArray(it.item_data));
    if (!shaped) {
      return res.status(400).json({ error: 'Bad shape', message: 'Every item must be { id, item_data }.' });
    }

    const schema_id = await defaultSchemaId(entity_id);
    const currency = await regional.currencyFor(entity_id);

    const bad = [];
    for (let i = 0; i < items.length; i++) {
      const verr = await validateItem(schema_id, items[i].item_data);
      if (verr) bad.push({ index: i, id: items[i].id, message: verr });
    }
    if (bad.length) {
      return res.status(400).json({ error: 'Invalid product',
        message: bad.length + ' item(s) were refused and nothing was written.', invalid: bad });
    }

    const ids = items.map((it) => it.id);
    const datas = items.map((it) => JSON.stringify(money.stampItem(it.item_data, currency)));

    /* One statement for the lot: unnest pairs each id with its own new item_data. */
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items AS c
          SET item_data = u.data::jsonb, updated_at = NOW()
         FROM unnest($1::uuid[], $2::text[]) AS u(id, data)
        WHERE c.item_id = u.id AND c.entity_id = $3
      RETURNING c.item_id`,
      [ids, datas, entity_id]));

    const done = r.rows.map((x) => x.item_id);
    const missed = ids.filter((i) => done.indexOf(i) < 0);
    res.json({ message: done.length + ' updated', updated: done.length, missed: missed });
  } catch (e) { fail(res, e, 'Bulk update failed'); }
});

// READ + SEARCH — list my products, optional ?q=
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const q = (req.query.q || '').trim();
    /* ⭐ ONE TRANSACTION for the whole read: parked changes due by now land first, then the list, then what is still
       parked — all on the same client. Three withEntity calls here were twelve round trips (Athi, 2026-09-05:
       "product loading in catalogue taking very long"). */
    let pendingRows = [];
    const listSql = q
      ? { text: `SELECT * FROM catalogue_items WHERE entity_id=$1 AND is_active=true AND item_data::text ILIKE $2 ORDER BY created_at DESC`, params: [entity_id, `%${q}%`] }
      : { text: `SELECT * FROM catalogue_items WHERE entity_id=$1 AND is_active=true ORDER BY created_at DESC`, params: [entity_id] };
    /* ⭐⭐ ONE NETWORK ROUND TRIP (db.readBatch): the due-probe, the list and the parked rows go as one message.
       Only when a parked change is DUE does this take the write path (applyDue inside a transaction) — rare, and
       then the list is read again after it lands. Athi, 2026-09-05: "reduce the round trip to O(1) if possible". */
    const sched = await schedule.enabled();
    const actor = req.identity && req.identity.identity_id;
    let r = null;
    try {
      const stmts = [listSql];
      if (sched) {
        stmts.push({ text: `SELECT count(*)::int AS n FROM ${schedule.TABLE} WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL AND effective_at <= NOW()`, params: [entity_id] });
        stmts.push({ text: `SELECT schedule_id, item_id, effective_at, patch, created_at FROM ${schedule.TABLE} WHERE entity_id = $1 AND applied_at IS NULL AND cancelled_at IS NULL ORDER BY effective_at`, params: [entity_id] });
      }
      const res = await readBatch(entity_id, actor, stmts);
      const due = sched ? Number(res[1].rows[0].n) : 0;
      if (!due) { r = res[0]; pendingRows = sched ? res[2].rows : []; }
    } catch (_) { r = null; }
    if (!r) {
      r = await withEntity(entity_id, async (db) => {
        await schedule.applyDue(entity_id, db);
        const out = await db.query(listSql.text, listSql.params);
        if (out.rows.length) { try { pendingRows = await schedule.pending(entity_id, null, db); } catch (_) { pendingRows = []; } }
        return out;
      });
    }

    /**
     * ⚠️ FILTERED HERE, NOT IN SQL, and deliberately: an ABSENT status means "available", so a WHERE clause on
     * item_data->>'status' would drop every row written before this field existed. Doing it in JS lets one rule —
     * statusOf() — decide for both the old rows and the new ones, instead of the database and the code
     * disagreeing about what a missing value means.
     *
     * ⚠️ AND THE DEFAULT IS *EVERYTHING*. Athi asked to *see* the other statuses, not to have them hidden — a
     * catalogue screen that quietly omits retired items is how someone re-creates a product they already retired.
     * ?status=available narrows it; ?status=not-available groups the three that cannot be ordered.
     */
    const want = String(req.query.status || '').toLowerCase().trim();
    let items = r.rows;
    /* PARKED CHANGES RIDE ON THE ROW (`scheduled: [...]`, usually empty) — gathered here, ONE query for the list, so the
       product page shows them without a read of its own (screen-reads budget: prodDetailHTML stays at 2). */
    try {
      if (pendingRows.length) {
        const byItem = new Map();
        for (const row of pendingRows) { const k = String(row.item_id); (byItem.get(k) || byItem.set(k, []).get(k)).push(row); }
        if (byItem.size) items = items.map((it) => byItem.has(String(it.item_id)) ? Object.assign({}, it, { scheduled: byItem.get(String(it.item_id)) }) : it);
      }
    } catch (_) { /* the list never fails for a parked change */ }
    if (want) {
      const keep = want === 'not-available' ? (s) => s !== 'available'
        : itemstatus.STATUSES.includes(want) ? (s) => s === want
        : null;
      if (!keep) return res.status(400).json({ error: 'Bad status',
        message: 'status must be one of: ' + itemstatus.STATUSES.join(', ') + ', not-available' });
      items = r.rows.filter((x) => keep(itemstatus.statusOf(x.item_data)));
    }
    /* The tally is over EVERY row, not the filtered set — it is what the tabs count, so it must not change
       depending on which tab is open. */
    const counts = {};
    itemstatus.STATUSES.forEach((s) => { counts[s] = 0; });
    r.rows.forEach((x) => { counts[itemstatus.statusOf(x.item_data)]++; });

    res.json({ items, count: items.length, total: r.rows.length, status_counts: counts });
  } catch (e) { res.status(500).json({ error: 'List failed', message: safeErr(e) }); }
});

// EXPORT — the whole catalogue as CSV. "A merchant can leave" is the same argument that justified the Medusa
// mapper; import already existed and export did not, so the round trip was one-way. That is lock-in whether or not
// anyone intended it.
//
// A GET returning a file, so it works from a browser link, curl, or a spreadsheet's "import from URL" — no client
// code required to be useful.
router.get('/export.csv', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT item_data FROM catalogue_items
       WHERE entity_id=$1 AND is_active=true ORDER BY created_at DESC`, [entity_id]));
    /**
     * ⭐⭐ RESOLVE, THEN PROJECT. A row that inherits its unit from the catalogue stores nothing in `unit` — so
     * before this, a merchant who set one catalogue-wide unit downloaded a sheet with an EMPTY unit column and
     * reasonably concluded the data was lost. It was not: the row was silent on purpose, and nothing was
     * answering for it on the way out.
     *
     * ⚠️ AND THE ORDER MATTERS: defaults first, then sheet. Projecting first would flatten a row that still had
     * holes in it, and the holes would be the columns the catalogue was about to fill.
     */
    const face = await faceOf(entity_id);
    const items = r.rows.map((x) => defaults.effective(x.item_data || {}, face));

    /**
     * The schema orders the columns where it can; anything an item carries beyond it is still exported, because a
     * column dropped here is data lost on the way back in.
     *
     * ⭐ SAME RESOLVER AS THE TEMPLATE AND THE COLUMNS PANEL. It used to read `schema_fields` directly and then let
     * csv.toCSV widen from the rows — defensible alone, and one of the three different answers to "what are my
     * columns". Widening still happens; it now starts from the same list everything else starts from.
     */
    let schema = null;
    try {
      const sid = await defaultSchemaId(entity_id);
      if (sid) {
        const cols = await catcols.resolveColumns({ query, withEntity, entity_id, schema_id: sid });
        schema = { properties: Object.fromEntries(cols.columns.map((k) => [k, {}])) };
      }
    } catch (_) { /* no schema is fine — columns then come from the items themselves */ }

    /**
     * ⭐⭐ PROJECTED FIRST. Athi, 2026-09-02: *"in your download file, you have given availability as a json data,
     * flag, when and who etc, in a csv file, json is too much for the user and he will not understand."*
     *
     * csv.cell() JSON-stringifies any object and the export widens its columns from the rows, so an availability
     * record landed in a cell as {"qty":12,"source":"manual","as_of":"…"} next to the product names, and
     * `categories` came out as raw UUIDs. Nobody can maintain that in Excel and nobody should have to. See
     * lib/sheet.js: available (yes/no) · qty · qty_as_of · qty_source — four plain cells, never one nested one.
     */
    const body = csv.toCSV(items.map(sheet.toSheet), { schema });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="catalogue-${stamp}.csv"`);
    // Excel assumes the system codepage without this and mangles every non-ASCII product name.
    res.send('﻿' + body);
  } catch (e) { fail(res, e, 'Export failed'); }
});

/**
 * TEMPLATE — the blank upload sheet for THIS catalogue.
 *
 * Athi, 2026-08-06: *"each entity will have its own catalogue style and accepted format, so the template can be
 * downloaded and the same format uploaded — that makes the system stable."*
 *
 * The header row is a PROJECTION OF THE DECLARATION, so there is no template file anywhere that can drift out of
 * step with the schema. A cart catalogue is asked for `price`; a range catalogue for `price_min`/`price_max`; a
 * payload catalogue for no price at all.
 *
 * Returns JSON rather than the file directly, because the guidance cannot live inside the CSV — a comment row would
 * be parsed as a product. The client writes `csv` to a file and shows `notes` beside it.
 */
router.get('/template', auth, async (req, res) => {
  try {
    const { template, orderInput: oi } = await catalogueShape(ctx(req));
    res.json({ ...template, preset: oi.preset, filename: `catalogue-template-${oi.preset}.csv` });
  } catch (e) { fail(res, e, 'Template failed'); }
});

/**
 * PREFLIGHT — read an uploaded file BEFORE any of it becomes data.
 *
 * Athi, 2026-08-06: *"what if the columns are different, or named differently? do we have a parser before uploading
 * and providing any suggestion?"*
 *
 * ⚠️ THIS ROUTE WRITES NOTHING. It reads the catalogue only to work out the accepted format, and returns a report:
 * which incoming column maps to which field, what was matched only by similarity and needs confirming, what is
 * blocked, what is unrecognised, and which rows would fail and why. The commit half is deliberately NOT built —
 * bulk-writing someone's catalogue from a guessed mapping is exactly the destructive step that needs a spec and a
 * human gate, and the report is useful on its own.
 *
 * `ready:false` means a person still has to look. It is never a soft warning the client may skip past.
 */
router.post('/import/preflight', auth, [ body('csv').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const text = String(req.body.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to read', message: 'The file is empty.' });

    // The accepted format, built by the SAME function the download template uses — one definition, so a merchant
    // who fills our own sheet can never be told a column is unrecognised.
    const { template, labels, required, identity: ident, identityProblems, orderInput: oi } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    // preflight() wants rows positionally, so a duplicate header cannot silently collapse into one key.
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels, required, identity: ident });

    res.json({ report, accepted: template.columns, optional: template.optional, preset: oi.preset,
      identity: ident, identity_problems: identityProblems, dry_run: true });
  } catch (e) { fail(res, e, 'Could not read the file'); }
});

/** How many rows one upload may carry. Stated, and reported when it bites — never a silent truncation. */
const IMPORT_MAX_ROWS = 2000;

/**
 * IMPORT — the commit half, with a decision required for every column.
 *
 * Body: { csv, decisions:[{incoming, action:'map'|'create'|'ignore', field}], confirm:true }
 *
 * ⚠️ WHAT THIS WILL NOT DO, BY CONSTRUCTION:
 *   · It never deletes. A product missing from the file is left exactly as it is — this is an import, not a sync.
 *     "Replace my catalogue with this file" is a different, destructive act and is not built.
 *   · It never changes an existing field's name, type or requiredness. New fields are created OPTIONAL, because a
 *     newly-required column would retroactively invalidate every product already stored.
 *   · It never acts on the preflight's own suggestions. A column with no decision is ignored.
 *   · It refuses outright while the file still has row errors, rather than importing "the good ones" and leaving a
 *     person to work out which lines are missing.
 *
 * It re-runs the preflight server-side. The client's report is a display artifact and is never trusted.
 */
router.post('/import', auth, [ body('csv').isString(), body('decisions').isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (req.body.confirm !== true) {
      return res.status(400).json({ error: 'Not confirmed', message: 'Nothing was imported — this needs an explicit confirmation.' });
    }
    const text = String(req.body.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to import', message: 'The file is empty.' });

    const { schema_id, template, labels, required, identity: ident } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({ error: 'Too many rows',
        message: `This file has ${parsed.rows.length} rows and one upload can carry ${IMPORT_MAX_ROWS}. Nothing was imported — split the file and it will all go in.` });
    }
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels, required, identity: ident });
    const rowErrors = report.issues.filter((i) => i.severity === 'error');
    if (rowErrors.length) {
      return res.status(409).json({ error: 'The file has problems', report,
        message: `${rowErrors.length} row problem(s) must be fixed first. Nothing was imported.` });
    }

    const applied = preflight.applyDecisions({ headers: parsed.headers, rows, template, labels, identity: ident, decisions: req.body.decisions });
    if (applied.errors.length) {
      return res.status(400).json({ error: 'Those choices do not hold up', messages: applied.errors,
        message: applied.errors[0] + ' Nothing was imported.' });
    }
    if (!applied.items.length) {
      return res.status(400).json({ error: 'Nothing to import',
        message: 'No row had a product name once your choices were applied, so there was nothing to create.' });
    }

    const currency = await regional.currencyFor(entity_id);
    // O(1): the rules are read once for the whole file, not once per row.
    let ruleRows = await schemaFieldsOf(schema_id);

    // EXTEND THE DECLARATION FIRST. The new columns have to exist before the products that use them, and doing it
    // in this order means a failure here leaves nothing half-imported.
    let sid = schema_id;
    const created = [];
    if (applied.newFields.length) {
      if (!sid) {
        const boot = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
        sid = boot.schema_id || null;
      }
      if (!sid) return res.status(500).json({ error: 'No catalogue definition', message: 'Your catalogue has no definition to add columns to.' });
      /* ⭐ ONE APPENDER. This loop WAS the correct implementation — it is now the shared one, so the single add
         and the bulk paste append a column exactly the way an import does. See lib/catalogue-columns.commitFields. */
      created.push(...await catcols.commitFields({ query, schema_id: sid, newFields: applied.newFields }));
    }

    // REGISTER WHAT WE ACCEPT, so a column's position becomes a stored fact.
    //
    // Athi, 2026-08-06: *"we have to maintain the order of the column, so always the column comes the same way — we
    // cannot keep changing the column position."*
    //
    // Right, and sorting is not enough on its own. A field IN the schema has a display_order, so its position is
    // permanent. A column that only exists because some item happens to carry it has no position at all, so it can
    // only ever be ordered by a rule — and any rule that is not "where you put it" will one day move something.
    //
    // So anything a person deliberately MAPPED becomes a declared field, appended at the end in exactly the order
    // it already appears. Nothing moves at the moment of registration; from then on nothing can move at all.
    // Additive and optional, like every other extension: this records what the catalogue already accepts, it does
    // not change what it demands.
    if (sid) {
      const hv = await query(`SELECT field_key FROM schema_fields WHERE schema_id=$1`, [sid]);
      const known = new Set(hv.rows.map((r) => r.field_key));
      // The order the template renders them in — so registering changes nothing a merchant can see, today.
      const inOrder = template.columns.filter((c) => applied.mappedFields.includes(c) && !known.has(c)
        && !preflight.BLOCKED[c] && c !== 'quantity');
      if (inOrder.length) {
        created.push(...await catcols.commitFields({ query, schema_id: sid,
          newFields: inOrder.map((key) => ({ field_key: key, field_name: labels[key] || key,
            field_type: preflight.NUMERIC_FIELDS.includes(key) ? 'number' : 'text' })) }));
      }
    }

    // New columns were just added, so the rule set changed exactly once. Re-read it once — still O(1).
    if (created.length) ruleRows = await schemaFieldsOf(sid);

    // Then the products. Match on the DECLARED identity where the file carries one: a second upload of the same
    // sheet should correct the catalogue, not double it.
    //
    // `sku` was hardcoded here, which was an assumption rather than a rule — pharma identifies a lot by `batch_no`
    // and a commodity desk may need `hs_code + origin_country`. identity.resolve() falls back to ['sku'], so a
    // catalogue that has declared nothing behaves exactly as it did.
    const existing = await withEntity(entity_id, (db) => db.query(
      `SELECT item_id, item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true`, [entity_id]));
    const byIdentity = new Map();
    for (const r of existing.rows) {
      const k = identity.identityOf(r.item_data || {}, ident);
      if (k) byIdentity.set(k, r);
    }
    const idLabel = ident.key.join(' + ');

    const outcome = [];
    for (let i = 0; i < applied.items.length; i++) {
      /**
       * ⭐⭐ THE ANSWERS BECOME RECORDS HERE. `available: yes` becomes a status AND a fresh stamp; `qty` becomes
       * the availability record with today's date and this upload as its source.
       *
       * ⚠️ AND IT RE-STAMPS EVEN WHEN NOTHING CHANGED — Athi: *"availability and qty should be stamped new even
       * if the status or value didn't change."* The upload IS the assertion: an identical `yes, 12` says this is
       * still true TODAY, and the as-of is the part that moved. Deliberately unlike money.stampPrice, which
       * PRESERVES an existing source/as_of — a quoted price keeps its date, a stock count does not.
       */
      const item = sheet.fromSheet(applied.items[i], { source: 'upload' }).item_data, line = applied.lines[i];
      const ikey = identity.identityOf(item, ident);       // null when the row carries only PART of the key
      const sku = ikey || '';
      const prior = ikey ? byIdentity.get(ikey) : null;
      try {
        // A row with a code but no name is an UPDATE to something that already exists. If nothing matches, there is
        // no product to patch and not enough to create one — say which, rather than "nothing to import".
        if (!prior && !String(item.name || '').trim()) {
          outcome.push({ line, sku, action: 'failed',
            message: ikey ? `no product here has ${idLabel} "${ikey}", and there is no name to create one with`
                         : `this row has neither a name nor a complete ${idLabel} ` });
          continue;
        }
        const merged = prior ? Object.assign({}, prior.item_data, item) : item;   // an update is a patch, not a wipe

        // A UNIT change on an existing product silently rewrites what its price means: 150/litre and 150/tonne are
        // not the same offer. Merchants do repack, so this is not refused — but it is never left unsaid.
        let warning = null;
        if (prior && item.unit && prior.item_data.unit && item.unit !== prior.item_data.unit) {
          warning = `unit changed ${prior.item_data.unit} → ${item.unit}; the price now means something different`;
        }
        // The SAME validation the single-add form runs. Without this a bulk upload could create products that
        // typing them in one at a time would have refused — the rules would depend on how you arrived, which is
        // not a rule at all.
        const verr = validateAgainst(ruleRows, merged);
        if (verr) { outcome.push({ line, sku, action: 'failed', name: item.name, message: verr }); continue; }
        const stamped = money.stampItem(merged, currency);
        if (prior) {
          await withEntity(entity_id, (db) => db.query(
            `UPDATE catalogue_items SET item_data=$1, updated_at=NOW() WHERE item_id=$2 AND entity_id=$3`,
            [JSON.stringify(stamped), prior.item_id, entity_id]));
          outcome.push({ line, sku, action: 'updated', name: item.name || prior.item_data.name, warning });
        } else {
          await withEntity(entity_id, (db) => db.query(
            `INSERT INTO catalogue_items (entity_id, schema_id, item_data) VALUES ($1,$2,$3)`,
            [entity_id, sid, JSON.stringify(stamped)]));
          outcome.push({ line, sku, action: 'created', name: item.name, warning });
        }
      } catch (e) {
        outcome.push({ line, sku, action: 'failed', name: item.name, message: e.message });
      }
    }

    const failed = outcome.filter((o) => o.action === 'failed');
    res.json({
      message: `${outcome.filter((o) => o.action === 'created').length} added, ${outcome.filter((o) => o.action === 'updated').length} updated`
        + (failed.length ? `, ${failed.length} failed` : '')
        + (created.length ? ` · added ${created.length} new column(s) to your catalogue` : ''),
      created_columns: created, outcome,
      summary: { created: outcome.filter((o) => o.action === 'created').length,
        updated: outcome.filter((o) => o.action === 'updated').length, failed: failed.length },
    });
  } catch (e) { fail(res, e, 'Import failed'); }
});

/**
 * STARTER COLUMNS — the standard set for a trade, so an empty catalogue is not a blank page.
 *
 * GET  → the list to pick from.  POST {vertical} → adopt it, adding whatever the schema does not already have.
 * Adoption is ADDITIVE: it never removes or retypes a column the entity already uses.
 */
router.get('/starter-columns', auth, async (req, res) => {
  try {
    const v = req.query.vertical;
    res.json(v ? { starter: starter.starterFor(v), verticals: starter.list() } : { verticals: starter.list() });
  } catch (e) { fail(res, e, 'Could not list the standard sets'); }
});

router.post('/starter-columns', auth, [ body('vertical').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const set = starter.starterFor(req.body.vertical);
    if (!set.vertical) return res.status(400).json({ error: 'Unknown trade', message: 'That is not one of the standard sets.' });

    let sid = await defaultSchemaId(entity_id);
    if (!sid) {
      const boot = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
      sid = boot.schema_id || null;
    }
    if (!sid) return res.status(500).json({ error: 'No catalogue definition', message: 'Your catalogue has no definition to add columns to.' });

    /* ⭐ The running display_order used to be tracked here; commitFields owns it now, so this only needs to know
       WHICH keys already exist — the additive-only rule. */
    const have = await query(`SELECT field_key FROM schema_fields WHERE schema_id=$1`, [sid]);
    const keys = new Set(have.rows.map((r) => r.field_key));

    /**
     * ⭐⭐ A SUBSET, AND YOUR OWN COLUMNS — Athi, 2026-09-02, of the categories picker and then of this:
     * *"if we show what those are and provide option to choose from the standard list… plus few more of their
     * own, so if we can provide facility to add it."*
     *
     * ⚠️ THE SET WAS ALL-OR-NOTHING, and a column is heavier than a category: it lands on the template every
     * product is described by, on the import preflight and on the export. Adopting eleven to get eight left the
     * other three on every form for ever, because a column with data in it must never be removed.
     *
     * ⚠️ ABSENT `fields` MEANS THE WHOLE SET, not none — so every existing caller keeps its behaviour exactly.
     * An empty array is a different statement and is honoured: "none of the standard ones, only mine".
     */
    const wanted = Array.isArray(req.body.fields) ? new Set(req.body.fields.map(String)) : null;
    const picked = wanted ? set.fields.filter((f) => wanted.has(f.field_key)) : set.fields;

    /* ⭐ COLLECTED, THEN APPENDED ONCE — see the shared appender below. Additive only: a column already in use
       is never retyped. */
    const toAdd = [];
    for (const f of picked) {
      if (keys.has(f.field_key)) continue;
      keys.add(f.field_key);
      toAdd.push({ field_key: f.field_key, field_name: f.field_name, field_type: f.field_type });
    }

    /**
     * ⭐ AND THE COLUMNS THEY TYPED THEMSELVES. Each carries the TYPE the person chose — unlike a CSV import,
     * where lib/csv-preflight infers it from the values and asks them to confirm. Nothing to infer from here:
     * the column is empty by definition, so the only honest source of the type is the person adding it.
     *
     * ⚠️ Refused rather than coerced if the type is not one the schema knows: a column silently created as `text`
     * when someone asked for `number` sorts and totals wrongly for ever, and nothing on screen would say why.
     */
    const OK_TYPES = ['text', 'number', 'boolean', 'date', 'choice'];
    const own = Array.isArray(req.body.custom) ? req.body.custom : [];
    const rejected = [];
    for (const c of own.slice(0, 40)) {
      const label = String((c && c.field_name) || '').trim();
      if (!label) continue;
      const type = String((c && c.field_type) || 'text').toLowerCase();
      if (OK_TYPES.indexOf(type) < 0) { rejected.push(label + ' (unknown type "' + type + '")'); continue; }
      /* ⭐ THE SAME KEY RULE THE IMPORT USES — `csv-preflight.toFieldKey`. A column somebody types here and the
         same column arriving in a spreadsheet must land on ONE field, and they only do if one function decides
         the key. My first version slugged it inline, which is how two spellings of `Bar serial` become two
         columns nobody can reconcile. */
      const key = preflight.toFieldKey(label);
      if (!key || keys.has(key)) continue;                 // already there — same rule as a standard column
      keys.add(key);
      toAdd.push({ field_key: key, field_name: label, field_type: type });
    }

    /**
     * ⭐⭐ THE ONE APPENDER, for the last two places that had their own. This route hand-rolled the
     * MAX(display_order) + INSERT twice, the import had it twice more, and the single add had none at all — five
     * variations of "add a column", which is precisely how the declaration and the store drifted apart in the
     * first place. lib/catalogue-columns.commitFields is now the only code that writes a schema_fields row.
     */
    const added = await catcols.commitFields({ query, schema_id: sid, newFields: toAdd });

    res.json({ message: added.length ? `Added ${added.length} column(s)` : 'Your catalogue already has all of those columns',
      vertical: set.vertical, added, rejected,
      unchanged: picked.filter((f) => !added.includes(f.field_key)).map((f) => f.field_key) });
  } catch (e) { fail(res, e, 'Could not adopt the standard set'); }
});

// UPDATE — edit a product
router.patch('/:id', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    /* ⚠️ THE ONE DOOR FIX-1 LEFT OPEN. POST, /bulk and the import all declared what they store; an EDIT still
       validated and wrote the raw body, so a key added on edit — through the API, or through a form that renders
       declared columns and will one day render one more — could land undeclared again. Same writer, same rule. */
    const decl = await catcols.ensureDeclared({
      query, entity_id, schema_id: await defaultSchemaId(entity_id), item_data: req.body.item_data,
      ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
      validate: (data, rows) => validateAgainst(rows, data),
    });
    if (decl.error) return res.status(400).json({ error: 'Invalid product', message: decl.error });
    // STAMP on edit too — a round-trip that read `{amount,currency}` and writes it back is accepted only while the
    // currency still agrees with the entity's; a different one is refused (see money.stampPrice).
    const item_data = money.stampItem(decl.item_data, await regional.currencyFor(entity_id));
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items SET item_data=$1, updated_at=NOW()
       WHERE item_id=$2 AND entity_id=$3 RETURNING *`,
      [JSON.stringify(item_data), req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product updated', item: r.rows[0] });
  } catch (e) { fail(res, e, 'Update failed'); }
});

/**
 * PUT /api/products/:id/availability   { qty, source?, as_of? }
 *
 * What this store HAS of this item, and when that was last true.
 *
 * ── WHY THIS IS NOT `PATCH /:id` WITH A FIELD ───────────────────────────────────────────────────────────────
 * Availability is not a catalogue field. A catalogue field describes the PRODUCT and is validated against the
 * schema; this describes the SHELF, changes on its own timetable, and is written by a connector far more often
 * than by a person. Putting it through validateItem would mean a stock update could be refused because an
 * unrelated required column was blank — a feed failing for a reason that has nothing to do with the feed.
 *
 * It is written into `item_data.avail`, so it lives with the item, inherits the item's per-entity RLS, and needs
 * no new table. Only the owner can write it: the UPDATE is scoped to entity_id, so there is no window between
 * checking and writing.
 */
/* ── PUBLISH ON A DATE — park a patch, list what is parked, cancel one. lib/schedule.js has the why. ── */
router.get('/:id/schedule', auth, async (req, res) => {
  try { res.json({ enabled: await schedule.enabled(), pending: await schedule.pending(ctx(req), req.params.id) }); }
  catch (e) { fail(res, e, 'Could not read the schedule'); }
});
router.post('/:id/schedule', auth, [ body('effective_at').isString(), body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    /* the patch goes through the SAME declaration gate as an edit — a scheduled key must be a declared column too */
    const decl = await catcols.ensureDeclared({
      query, entity_id, schema_id: await defaultSchemaId(entity_id), item_data: req.body.item_data,
      ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
      validate: () => null,
    });
    if (decl.error) return res.status(400).json({ error: 'Invalid change', message: decl.error });
    const cur = await withEntity(entity_id, (db) => db.query(`SELECT item_data FROM catalogue_items WHERE item_id = $1 AND entity_id = $2 AND is_active = true`, [req.params.id, entity_id]));
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const patch = schedule.diff(cur.rows[0].item_data, money.stampItem(Object.assign({}, cur.rows[0].item_data, decl.item_data), await regional.currencyFor(entity_id)));
    const r = await schedule.schedule(entity_id, req.params.id, req.body.effective_at, patch, (req.identity && req.identity.identity_id) || null);
    if (r.error) return res.status(r.error === 'not_enabled' ? 409 : 400).json({ error: r.error, message: r.message });
    res.json({ message: 'Change scheduled', scheduled: r.row });
  } catch (e) { fail(res, e, 'Could not schedule the change'); }
});
router.delete('/:id/schedule/:sid', auth, async (req, res) => {
  try { res.json({ cancelled: await schedule.cancel(ctx(req), req.params.sid) }); }
  catch (e) { fail(res, e, 'Could not cancel the change'); }
});

router.put('/:id/availability', auth,
  [ body('qty').exists(), body('source').optional().isString(), body('as_of').optional().isString() ],
  validate,
  async (req, res) => {
    try {
      const entity_id = ctx(req);
      const rec = availability.stamp(req.body);
      if (!rec) {
        return res.status(400).json({ error: 'Bad quantity',
          message: 'A quantity must be zero or more. A negative figure means the feed is wrong, and storing it '
                 + 'would make a full shelf look empty.' });
      }
      const r = await withEntity(entity_id, (db) => db.query(
        `UPDATE catalogue_items
            SET item_data = COALESCE(item_data, '{}'::jsonb) || jsonb_build_object('avail', $1::jsonb),
                updated_at = NOW()
          WHERE item_id = $2 AND entity_id = $3
        RETURNING item_id, item_data`,
        [JSON.stringify(rec), req.params.id, entity_id]));
      if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such item in your catalogue.' });
      res.json({ message: 'Availability updated', availability: rec });
    } catch (e) { fail(res, e, 'Availability update failed'); }
  });

/**
 * PUT /:id/status — the item's LIFECYCLE. Athi, 2026-08-13: *"so we don't need to amend the catalogue, but we
 * can set the flag… need to differentiate between temporarily not available to never."*
 *
 * body: { status: available|unavailable|redundant|retired, until?: YYYY-MM-DD, replaced_by?, note? }
 *
 * ⚠️ THIS IS NOT `/availability`, WHICH IS A QUANTITY FEED. That answers "how many are on the shelf"; this
 * answers "is this a thing you sell at all". A shelf can be empty without the product being retired, and a
 * retired product can still have stock nobody may order.
 *
 * ⚠️ MERGED, NOT REPLACED. `||` on jsonb keeps every other field — a status change must never be able to lose a
 * price or a synonym list, which is exactly what PATCH /:id would do if used for this.
 */
router.put('/:id/status', auth, [ body('status').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const rec = itemstatus.stamp(req.body, { actor_name: req.identity.display_name });
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items
          SET item_data = COALESCE(item_data, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
        WHERE item_id = $2 AND entity_id = $3
      RETURNING item_id, item_data`,
      [JSON.stringify(rec), req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such item in your catalogue.' });
    const d = r.rows[0].item_data || {};
    res.json({ message: 'Status updated', status: itemstatus.statusOf(d), reads_as: itemstatus.explain(d),
      /* ⚠️ BOTH, because `matchable: true` ALONE READS AS "still on sale" — and it is returned to the owner at
         the exact moment they marked something out of stock, which is the worst place to be ambiguous.
         `matchable` answers "will the message matcher still resolve this" (yes, deliberately); `offerable`
         answers "may a customer take one now" (no). See lib/itemstatus.js. */
      matchable: itemstatus.isMatchable(d), offerable: itemstatus.isOfferable(d), item_id: r.rows[0].item_id,
      /* The schema.org/ItemAvailability equivalent, returned so an integrator never has to learn our four words. */
      schema_org: d.status_schema_org || itemstatus.SCHEMA_ORG[itemstatus.statusOf(d)] });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: 'Bad status', message: e.message });
    fail(res, e, 'Status update failed');
  }
});

// DELETE — soft remove
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items SET is_active=false
       WHERE item_id=$1 AND entity_id=$2 RETURNING item_id`,
      [req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product removed' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', message: safeErr(e) }); }
});

/**
 * GET /:id/versions — what this item WAS, in order. (b146)
 *
 * Athi, 2026-08-13: *"at any point in time, what is the reference at this point in time — that fixes the base."*
 * The trigger records it; this is how anyone reads it back. Without a read path the version table is a claim
 * rather than a fact, and a migration nobody can verify is a migration nobody should trust.
 *
 * ?at=<ISO timestamp> answers the single question the whole table exists for — "what was this when that chit was
 * raised" — rather than making the caller fetch the list and pick a row by comparing timestamps, which is how you
 * get an off-by-one on the boundary between two versions.
 */
/* ── ⭐ PRODUCT MEDIA — pictures and videos, on the private object store (lib/storage-object; key = entity/yyyy/mm/id).
   Athi, 2026-09-05: "another page for handling images and videos of the product". The bucket is PRIVATE, so nothing
   here ever hands out a bucket URL: the API streams the bytes. `item_data.media` = [{id, name, mime, kind, size, at}];
   `item_data.image` = the public read URL of the FIRST image, which is what the storefront's mediaOf() already reads.
   Fails honestly when the store is not configured (503) — the rest of the product is unaffected. ── */
const objStore = require('../lib/storage-object');
const MEDIA_MAX = 8 * 1024 * 1024;
/** A video is a LINK, not bytes: YouTube or Vimeo, parsed to {provider, vid} so the page can embed it. */
function videoLink(url) {
  const u = String(url || '').trim();
  let m = u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{6,})/);
  if (m) return { provider: 'youtube', vid: m[1], embed: 'https://www.youtube-nocookie.com/embed/' + m[1] };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  if (m) return { provider: 'vimeo', vid: m[1], embed: 'https://player.vimeo.com/video/' + m[1] };
  return null;
}
function mediaUrl(req, item_id, mid) {
  const base = process.env.PUBLIC_API_URL || (req.protocol + '://' + req.get('host'));
  return base + '/api/products/media/' + item_id + '/' + mid;
}
/* PUBLIC READ — the storefront shows it to anyone who can see the product; only active items serve, and only ids the
   item lists (the key is never taken from the URL). */
router.get('/media/:item_id/:mid', async (req, res) => {
  try {
    if (!(await objStore.available())) return res.status(503).json({ error: 'media store not configured' });
    const r = await query(`SELECT entity_id, item_data FROM catalogue_items WHERE item_id = $1 AND is_active = true`, [req.params.item_id]);
    const row = r.rows[0]; if (!row) return res.status(404).end();
    const m = (Array.isArray(row.item_data && row.item_data.media) ? row.item_data.media : []).find((x) => x && String(x.id) === String(req.params.mid));
    if (!m || !m.key) return res.status(404).end();
    const buf = await objStore.get(m.key);
    res.set('Content-Type', m.mime || 'application/octet-stream'); res.set('Cache-Control', 'public, max-age=86400'); res.send(buf);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.post('/:id/media', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const { name, mime, data_base64, url } = req.body || {};
    /* a video LINK: no bytes, no store */
    if (url) {
      const v = videoLink(url);
      if (!v) return res.status(400).json({ error: 'not_a_video_link', message: 'Paste a YouTube or Vimeo link.' });
      const mid = require('crypto').randomUUID();
      const out = await withEntity(entity_id, async (db) => {
        const cur = await db.query(`SELECT item_data FROM catalogue_items WHERE item_id = $1 AND entity_id = $2 AND is_active = true`, [req.params.id, entity_id]);
        if (!cur.rows.length) return null;
        const d = Object.assign({}, cur.rows[0].item_data || {});
        d.media = (Array.isArray(d.media) ? d.media : []).concat([{ id: mid, kind: 'video', provider: v.provider, vid: v.vid, embed: v.embed, url: String(url).slice(0, 500), name: String(name || v.provider + ' video').slice(0, 200), at: new Date().toISOString() }]);
        const u = await db.query(`UPDATE catalogue_items SET item_data = $1, updated_at = NOW() WHERE item_id = $2 AND entity_id = $3 RETURNING item_data`, [JSON.stringify(d), req.params.id, entity_id]);
        return u.rows[0];
      });
      if (!out) return res.status(404).json({ error: 'Not found' });
      return res.json({ message: 'Video linked', id: mid, media: out.item_data.media });
    }
    if (!name || !data_base64) return res.status(400).json({ error: 'validation', message: 'name and data_base64, or a video url' });
    if (!(await objStore.available())) return res.status(503).json({ error: 'not_configured', message: 'The media store is not configured (S3 env, or run b204 for the database store).' });
    const buffer = Buffer.from(String(data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'empty' });
    if (buffer.length > MEDIA_MAX) return res.status(413).json({ error: 'too_large', message: 'Up to 8 MB per file.' });
    const kind = /^video\//.test(mime || '') ? 'video' : (/^image\//.test(mime || '') ? 'image' : 'file');
    const mid = require('crypto').randomUUID();
    const key = objStore.objectKey(entity_id, mid);
    await objStore.put(key, buffer, mime || 'application/octet-stream');
    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT item_data FROM catalogue_items WHERE item_id = $1 AND entity_id = $2 AND is_active = true`, [req.params.id, entity_id]);
      if (!cur.rows.length) return null;
      const d = Object.assign({}, cur.rows[0].item_data || {});
      const media = (Array.isArray(d.media) ? d.media : []).concat([{ id: mid, key, name: String(name).slice(0, 200), mime: mime || null, kind, size: buffer.length, at: new Date().toISOString() }]);
      d.media = media;
      const firstImg = media.find((x) => x.kind === 'image');
      if (firstImg) d.image = mediaUrl(req, req.params.id, firstImg.id);
      const u = await db.query(`UPDATE catalogue_items SET item_data = $1, updated_at = NOW() WHERE item_id = $2 AND entity_id = $3 RETURNING item_data`, [JSON.stringify(d), req.params.id, entity_id]);
      return u.rows[0];
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Media added', id: mid, url: mediaUrl(req, req.params.id, mid), media: out.item_data.media });
  } catch (e) { fail(res, e, 'Could not add the media'); }
});
router.delete('/:id/media/:mid', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const out = await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT item_data FROM catalogue_items WHERE item_id = $1 AND entity_id = $2`, [req.params.id, entity_id]);
      if (!cur.rows.length) return null;
      const d = Object.assign({}, cur.rows[0].item_data || {});
      const media = (Array.isArray(d.media) ? d.media : []);
      const gone = media.find((x) => x && String(x.id) === String(req.params.mid));
      d.media = media.filter((x) => x !== gone);
      const firstImg = d.media.find((x) => x.kind === 'image');
      if (firstImg) d.image = mediaUrl(req, req.params.id, firstImg.id); else delete d.image;
      await db.query(`UPDATE catalogue_items SET item_data = $1, updated_at = NOW() WHERE item_id = $2 AND entity_id = $3`, [JSON.stringify(d), req.params.id, entity_id]);
      return { gone, media: d.media };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    if (out.gone && out.gone.key && (await objStore.available())) { try { await objStore.del(out.gone.key); } catch (_) {} }
    res.json({ message: 'Media removed', media: out.media });
  } catch (e) { fail(res, e, 'Could not remove the media'); }
});

router.get('/:id/versions', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    /* ⚠️ SCOPED TO MY OWN ITEM BEFORE ANYTHING IS READ. RLS already confines the rows, but an id in the URL should
       not be enough to learn that an item exists at all. */
    /**
     * ⚠️⚠️ ONE TRANSACTION, NOT TWO — the ownership check and the read it guards now share a client.
     *
     * `withEntity()` costs FOUR round trips every time it is called: BEGIN · set_config · the query · COMMIT
     * (db/index.js). This handler opened one to ask "is this item mine", closed it, then opened another to read
     * the versions — eight round trips to answer one question, half of them spent on transaction ceremony.
     *
     * ⭐ Measured by tools/round-trips.cjs, which ranks all 264 endpoints by this cost. 29 of them open more
     * than one transaction; this was the cleanest to collapse — a GET, no writes, so the only thing that can
     * change is how long it takes.
     *
     * ⚠️ THE CHECK STAYS FIRST AND STAYS SEPARATE. Sharing a transaction is not the same as merging the
     * queries: an id in the URL must not be enough to learn that an item exists, so the 404 still happens
     * before any version data is read. Same order, same guarantee, one BEGIN.
     */
    const at = String(req.query.at || '').trim();
    let when = null;
    if (at) {
      when = new Date(at);
      if (isNaN(when)) return res.status(400).json({ error: 'Bad date', message: '`at` must be a timestamp.' });
    }

    const out = await withEntity(entity_id, async (db) => {
      /* ⚠️ SCOPED TO MY OWN ITEM BEFORE ANYTHING IS READ. RLS already confines the rows, but an id in the URL
         should not be enough to learn that an item exists at all. */
      const own = await db.query(
        `SELECT item_id FROM catalogue_items WHERE item_id = $1 AND entity_id = $2`, [req.params.id, entity_id]);
      if (!own.rows.length) return { notFound: true };

      if (when) {
        const r = await db.query(
        /**
         * ⚠️ TRUNCATED TO MILLISECONDS ON BOTH SIDES, AND THE PROOF IS WHAT FOUND IT.
         *
         * Postgres keeps timestamptz to MICROseconds; JSON and JavaScript stop at milliseconds. So a caller who
         * takes the `valid_from` we just handed them — 17:36:56.030456Z, serialised as 17:36:56.030Z — and asks
         * "what was live at that moment" was asking about an instant 456µs BEFORE the version began. The row did
         * not match, the answer came back null, and the as-of query silently failed for the single most natural
         * way to call it: with a timestamp we ourselves emitted.
         *
         * Comparing at the precision we PUBLISH means our own timestamps round-trip exactly, which is the only
         * behaviour a caller can reason about.
         */
        `SELECT version_no, snapshot, name, variant, unit, price, sku, status, valid_from, valid_to
           FROM catalogue_item_version
          WHERE entity_id = $1 AND item_id = $2
            AND date_trunc('milliseconds', valid_from) <= $3
            AND (valid_to IS NULL OR date_trunc('milliseconds', valid_to) > $3)
          ORDER BY version_no DESC LIMIT 1`, [entity_id, req.params.id, when.toISOString()]);
        return { asOf: r.rows[0] || null };
      }

      const r = await db.query(
        `SELECT version_no, name, variant, unit, price, sku, status, valid_from, valid_to, changed_by
           FROM catalogue_item_version
          WHERE entity_id = $1 AND item_id = $2
          ORDER BY version_no DESC LIMIT 200`, [entity_id, req.params.id]);
      return { rows: r.rows };
    });

    /* ⚠️ THE RESPONSE IS SENT OUTSIDE THE TRANSACTION, deliberately. Calling res.json() inside the callback
       would hold the connection open across serialisation, and an error thrown after the response had started
       would leave a half-written body with an open BEGIN behind it. Return a value; answer with it here. */
    if (out.notFound) return res.status(404).json({ error: 'Not found', message: 'No such item in your catalogue.' });
    if (when) return res.json({ item_id: req.params.id, at: when.toISOString(), version: out.asOf });
    res.json({ item_id: req.params.id, count: out.rows.length,
      current: out.rows.find((x) => x.valid_to === null) || null, versions: out.rows });
  } catch (e) {
    /* ⚠️ THE MIGRATION-ABSENT CASE IS SAID PLAINLY. Twice this week a swallowed 42P01/42703 surfaced as a generic
       503 and sent Athi back to the SQL editor for a migration that had applied perfectly. */
    if (e && (e.code === '42P01' || e.code === '42703')) {
      console.error('versions: b146 not applied —', e.code);
      return res.status(503).json({ error: 'Not migrated', message: 'Item versions need b146 on this environment.' });
    }
    fail(res, e, 'Versions failed');
  }
});

module.exports = router;
