// @stage tested
// @stage-note The ONE path that writes products. Extracted from routes/products.js when the counter became a
// @stage-note second caller — declare, validate, stamp, insert, meter, in that order and only in this file.
'use strict';
/**
 * catalogue-write.js — HOW A PRODUCT GETS INTO A CATALOGUE, IN ONE PLACE ([TILL-107]).
 *
 * ── ⚠️⚠️ WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────────────
 *
 * The bulk add in routes/products.js already did this correctly, and correctly is a lot of steps in a fixed
 * order: resolve the schema once · read the rules once · validate every row BEFORE writing any · declare the
 * columns · stamp the money · insert · meter. Each step is there because something went wrong without it, and
 * the comments in routes/products.js record which.
 *
 * Then the counter needed to write products too ([TILL-107]: a shop minting a starter catalogue, or uploading a
 * spreadsheet). A second copy of a seven-step sequence is a second copy of seven decisions, and they would
 * agree on the day they were written and quietly disagree afterwards — which is this codebase's own stated
 * failure mode, and the reason for the rule: *a second call site means a helper NOW.*
 * [[feedback-no-duplicate-functions]] [[feedback-adopt-dont-reinvent]]
 *
 * ⚠️ IT IS NOT A NEW POLICY. Nothing here decides anything routes/products.js did not already decide; the order
 * and the refusals are carried over unchanged. If this file and that route ever differ, this file is wrong.
 * CARD storefront-and-catalogue/catalogue-write
 */
const { query, withEntity } = require('../db');
const log = require('./logger');
const money = require('./money');
const catcols = require('./catalogue-columns');
const regional = require('./regional');
const itemstatus = require('./itemstatus');
const { UUID } = require('./namedentity'); /* the one uuid shape */

/** the entity's default schema, or null when it has never had one */
async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`,
    [entity_id]
  );
  return (r.rows[0] && r.rows[0].schema_id) || null;
}

/**
 * ⚠️ READ THE RULES ONCE. Athi, 2026-08-06: *"any of this implementation, if it is greater than O(1), is not
 * required — it will be very costly."* A 2000-row upload must not fire 2000 identical queries for a rule set
 * that cannot change mid-request.
 */
async function schemaFieldsOf(schema_id) {
  if (!schema_id) return [];
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`,
    [schema_id]
  );
  return f.rows;
}

/* CAT-317: the ceilings every door shares. numeric(18,2) overflows near 1e16 (a 500 from the write); 1e12 is far above any shelf price and below it. A name is a label, not a document. */
const MAX_NUMBER = 1e12;
const MAX_NAME = 300;

/** the sentence for a number field whose value v (text) breaks a rule, or null — a word, a negative, a size the write cannot hold, below the field's own minimum */
function numberRefusal(field, typed) {
  const num = Number(typed);
  if (Number.isNaN(num)) return field.field_name + ' must be a number';
  if (num < 0) return field.field_name + ' cannot be negative';
  if (!Number.isFinite(num) || num > MAX_NUMBER) return field.field_name + ' is too large (at most ' + MAX_NUMBER + ')';
  if (field.min_value != null && num < Number(field.min_value)) return field.field_name + ' must be at least ' + field.min_value;
  return null;
}

/** the sentence for the first rule one declared field breaks in item_data, or null */
function fieldRefusal(field, item_data) {
  /* ⚠️ a stamped price is { amount, currency }, and String() on that is "[object Object]" → NaN → "must be a
     number". Found in production: it refused a legitimate round-trip edit. Judge money on its AMOUNT. */
  const rawV = item_data ? item_data[field.field_key] : undefined;
  const v = (money.isMoney(rawV) ? String(rawV.amount) : rawV == null ? '' : String(rawV)).trim();
  if (field.required && !v) return field.field_name + ' is required';
  if (field.field_key === 'name' && v.length > MAX_NAME) return field.field_name + ' is too long (at most ' + MAX_NAME + ' characters)';
  if (field.field_type === 'number' && v !== '' && !catcols.IDENT_KEYS.has(field.field_key)) return numberRefusal(field, v);
  return null;
}

const MAX_UNIT = 40;

/**
 * 'a unit is a word' (CAT-281), defined once: text that is not purely a number (500g, per 100 g, 12-pack, 1x6 are units; 123 and 12.5 are not), at most 40 characters, no control characters.
 * Returns the sentence, or null.
 */
function unitRefusal(unit) {
  const word = typeof unit === 'string' && !/^[\d.,\s]*$/.test(unit) && unit.length <= MAX_UNIT && !/[\u0000-\u001f\u007f]/.test(unit);
  return word ? null : 'Unit must be a word, such as kg or piece (at most ' + MAX_UNIT + ' characters)';
}

/**
 * CAT-281: three keys every catalogue carries whether or not the shop's schema declares a column for them. A tax rate is a percentage (the one range, services.isRateOutOfRange: 0 to 100);
 * a price key is held to the shared ceiling (money.priceOf reads every stored shape); a unit is a word (a number is not a unit and nothing downstream can print it).
 * A key that is absent, null or blank is not judged, and one the stored row already holds unchanged passes (a legacy row stays editable).
 */
function sharedKeyRefusal(item_data, stored) {
  const sent = (key) => {
    const value = item_data ? item_data[key] : undefined;
    const blank = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    return blank || (stored && JSON.stringify(value) === JSON.stringify(stored[key])) ? undefined : value;
  };
  const rate = sent('gst_rate');
  if (rate !== undefined && require('./services').isRateOutOfRange('gst_rate', Number(rate))) return 'Tax rate must be between 0 and 100 percent';
  /* the shared ceiling at every price key, whether or not the shop's schema declares the column (CAT-231: 1e20 passed the number check and failed at the write) */
  for (const key of money.PRICE_KEYS) {
    const price = money.priceOf(sent(key));
    if (price !== null && price > MAX_NUMBER) return numberRefusal({ field_name: key.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) }, String(price));
  }
  const unit = sent('unit');
  return unit === undefined ? null : unitRefusal(unit);
}

/** Pure: the schema's rules against rows already in hand. No I/O. */
function validateAgainst(fieldRows, item_data, stored) {
  /* CAT-316/323: an unknown status word is refused when this write SETS or CHANGES it (one list, itemstatus.STATUSES); the word the row already holds passes, so its other fields stay editable */
  const unknownStatus = itemstatus.statusMoves(item_data, undefined, stored) ? itemstatus.vocabularyRefusal(item_data.status) : null;
  if (unknownStatus) return 'Status: ' + unknownStatus;
  for (const field of fieldRows || []) {
    if (field.field_key === 'quantity') continue;
    const refusal = fieldRefusal(field, item_data);
    if (refusal) return refusal;
  }
  return sharedKeyRefusal(item_data, stored);
}

/**
 * judgeItem(entity_id, item_data, stored) → null when the record may be stored as it stands, else { status, message } — the verdict of the SAME rules a PATCH answers with:
 * the schema's validateAgainst, then the money stamp (a price in the shop's currency, a finite number). The deferred doors call it (CAT-317): a parked change
 * is judged when it is parked AND again when it comes due, because the schema, the currency or the item may have moved in between and nobody re-runs the first check.
 */
async function judgeItem(entity_id, item_data, stored) {
  const verr = validateAgainst(await schemaFieldsOf(await defaultSchemaId(entity_id)), item_data, stored);
  if (verr) return { status: 400, message: verr };
  try {
    money.stampItem(item_data, await regional.currencyFor(entity_id));
  } catch (e) {
    if (e && e.status >= 400 && e.status < 500) return { status: e.status, message: e.message };
    throw e;
  }
  return null;
}

/**
 * ── ⭐⭐⭐ writeItems({ entity_id, items }) — THE WHOLE SEQUENCE, OR NOTHING ───────────────────────────────────
 *
 * opts.db (optional, move-in W1.6): the caller's connection — the insert runs on its transaction (the caller commits or rolls back), and NOTHING is
 * metered here: the caller calls meterItems(entity_id, rows) after its commit, so a rolled-back caller meters nothing.
 * @returns { ok:true, rows, schema_id } · or { ok:false, status, error, message, invalid }
 *
 * ⚠️⚠️ NOTHING IS WRITTEN IF ANY ROW IS REFUSED. Half an import is worse than none: the shop cannot tell which
 * half, and re-running it duplicates the half that landed. Validation runs over every row first.
 *
 * ⚠️ DECLARE BEFORE WRITE. catalogue_items.item_data is free-form jsonb and schema_fields declares the columns;
 * nothing binds them, so a write that skips the declaration puts a column in the data that no screen knows
 * about. catalogue-columns exists precisely to stop that, and it must be called on every path.
 */
async function writeItems(opts) {
  const entity_id = opts.entity_id;
  const items = Array.isArray(opts.items) ? opts.items : [];
  if (!items.length) return { ok: false, status: 400, error: 'validation', message: 'No products were given.' };
  if (!items.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
    return { ok: false, status: 400, error: 'validation', message: 'Every item must be an object.' };

  const schema_id = await defaultSchemaId(entity_id);
  const currency = await regional.currencyFor(entity_id);

  const ruleRows = await schemaFieldsOf(schema_id);
  const list = [];
  for (let i = 0; i < items.length; i++) {
    const verr = validateAgainst(ruleRows, items[i]);
    if (verr) list.push({ index: i, message: verr });
  }
  if (list.length) {
    return { ok: false, status: 400, error: 'Invalid product', message: list.length + ' item(s) were refused and nothing was written.', invalid: list };
  }

  const decl = await catcols.ensureDeclaredMany({
    query,
    entity_id,
    schema_id,
    items,
    ensureSchema: (e) => require('./schema-bootstrap').ensureDefaultSchema(e),
    watchKeys: opts.watchKeys
  });
  if (decl.watched) return { ok: false, status: 403, watched: decl.watched }; // CAT-235: a cost-blind caller's cost keys — nothing was declared or written
  /* ⭐ C4: the declaration gate refuses a NEW item that carries a server-owned key (media/image) — the batch is refused whole,
     with the same shape as the validation refusal above */
  if (decl.invalid.length) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid product',
      code: decl.invalid[0].code || undefined,
      message: decl.invalid.length + ' item(s) were refused and nothing was written.',
      invalid: decl.invalid
    };
  }
  const sid = decl.schema_id || schema_id;

  /* ⚠️ STAMP AFTER VALIDATION, on the raw shape, so the schema still saw the number a person typed. CAT-316: a status is recorded by itemstatus.stamp, as PUT /:id/status does */
  const stamped = decl.items.map((item, at) => JSON.stringify(money.stampItem(itemstatus.stampInto(item, items[at], null, opts.who), currency)));

  /* move-in W1.6 (2026-10-18): a caller that owns the transaction (opts.db — the move-in's withEntity handle) has the insert on IT, so a refusal later in
     that transaction rolls the products back with everything else; otherwise the insert opens its own, as before */
  const r = opts.db ? await insertStamped(opts.db, entity_id, sid, stamped) : await withEntity(entity_id, (db) => insertStamped(db, entity_id, sid, stamped));

  /* ⭐ metered after the write, best-effort, never blocking — but NOT inside a caller's transaction (opts.db): that caller meters after its commit
     (meterItems), so a rolled-back move-in meters nothing */
  if (!opts.db) meterItems(entity_id, r.rows);

  /* ⚠️ THE DECLARATION TRAVELS BACK. The bulk route reports which columns were newly declared and any
     warnings with them; dropping it in the extraction would have quietly emptied that half of the response.
     A refactor that loses a field is not invisible, which was the whole condition for doing it. */
  return { ok: true, rows: r.rows, schema_id: sid, declared: decl };
}

/**
 * writeCitedItems({ entity_id, items, by }) — the items AND the categories they cite, in ONE transaction (CAT-124 F1).
 * items carry `categoryName`; each is made a citation (`categories: [id]`, name dropped) and written with writeItems on the same connection.
 * ⚠️ A refused write rolls the new categories back with it: the answer "nothing was written" is then true. Before this, the categories were
 * created first on their own transaction and a refusal left "Vegetables" behind.
 * @returns writeItems' answer · or { ok:false, categoriesFailed: err } when the categories could not be set up (nothing written either way)
 */
async function writeCitedItems(opts) {
  const { entity_id, by } = opts;
  const wanted = [...new Set(opts.items.map((item) => item && item.categoryName).filter(Boolean))];
  const stop = { refused: null };
  let written;
  try {
    written = await withEntity(entity_id, async (db) => {
      let ids = new Map();
      if (wanted.length) {
        try {
          ids = await require('./categories').ensureCategories(entity_id, wanted, { withEntity: (e, fn) => fn(db), by: by || null });
        } catch (e) {
          stop.failed = e;
          throw stop;
        }
      }
      const items = opts.items.map((item) => {
        const out = Object.assign({}, item);
        const id = item.categoryName ? ids.get(item.categoryName) : null;
        delete out.categoryName;
        if (id) out.categories = [id];
        return out;
      });
      const answer = await module.exports.writeItems({ entity_id, items, db }); /* via the export, so a test can stand in for the writer */
      if (!answer.ok) {
        stop.refused = answer;
        throw stop; // rolls the categories back
      }
      return answer;
    });
  } catch (e) {
    if (e !== stop) throw e;
    return stop.failed ? { ok: false, categoriesFailed: stop.failed } : stop.refused;
  }
  meterItems(entity_id, written.rows);
  return written;
}

/** meterItems(entity_id, rows) — one catalogue.item meter per written row ({ item_id }), best-effort, never blocking. writeItems calls it after its own
 *  insert; a caller that passed opts.db calls it once its transaction has COMMITTED (routes/books.js POST /move-in/import) */
function meterItems(entity_id, rows) {
  try {
    const meter = require('./meter').meter;
    for (const row of rows || [])
      meter(entity_id, 'catalogue.item', { detail: row.item_id }).catch(log.orElse('catalogue-write writeItems: failed — carried on without it'));
  } catch (e) {
    log.fellBack('catalogue-write writeItems: the helper failed — carried on without it', e);
  }
}

/** the insert itself, on the caller's connection: rows already validated, declared and stamped (JSON text each) */
function insertStamped(db, entity_id, schema_id, stamped) {
  return db.query(
    `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
     SELECT $1, $2, x FROM unnest($3::jsonb[]) AS x
     RETURNING *`,
    [entity_id, schema_id, stamped]
  );
}

/* the columns a caller may ask back — `c.` prefixed, because UPDATE … FROM unnest would otherwise return u's columns too */
function returningOf(cols) {
  if (!cols) return 'c.item_id';
  if (cols === '*') return 'c.*';
  const list = (Array.isArray(cols) ? cols : String(cols).split(',')).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length || !list.every((x) => /^[a-z_]+$/.test(x))) throw new Error('patchItems: bad returning ' + cols);
  return list.map((x) => 'c.' + x).join(', ');
}

/** foldEdits(list) → one entry per product id: merges compose, a replace wins (the same id twice is one change). An id that is no uuid names no product, so it is left out (CAT-230): it must never reach the ::uuid[] cast, which failed the whole batch with a 500 */
function foldEdits(list) {
  const byId = new Map();
  for (const e of list) {
    if (!e || e.item_id == null) continue;
    const id = String(e.item_id);
    if (!UUID.test(id)) continue;
    const prev = byId.get(id) || { mode: null, data: null, active: null };
    let next = Object.assign({}, prev);
    if (e.replace !== undefined) next = { mode: 'replace', data: e.replace, active: prev.active };
    else if (e.merge !== undefined) next = { mode: prev.mode || 'merge', data: Object.assign({}, prev.data, e.merge), active: prev.active };
    if (typeof e.active === 'boolean') next.active = e.active;
    byId.set(id, next);
  }
  return byId;
}

/**
 * ── ⭐⭐⭐ patchItems(db, entity_id, edits, opts) — THE ONE UPDATE OF A PRODUCT (CAT-W1, 14 Oct) ─────────────────
 *
 * 21 statements in eight files each wrote `UPDATE catalogue_items` their own way — some merged, some replaced, one
 * dropped the COALESCE. They all come through here now; tests/one-writer.test.cjs fails on a second writer.
 *
 * db       a connection: withEntity's client (or anything with .query). The caller owns the transaction.
 * edits    [{ item_id, merge }]   top-level jsonb merge (`||`) — merge-patch for flat product keys
 *          [{ item_id, replace }] the whole item_data (the caller already merged, validated and stamped it)
 *          [{ item_id, active }]  is_active (soft remove / restore); may ride with merge or replace
 *          or ONE change for many ids: { ids, merge | replace | active }
 * opts     { returning: '*' | 'item_id, item_data' | [cols] (default item_id), activeOnly: only rows still active }
 * → the pg result ({ rows, rowCount }) — ONE statement however many rows.
 *
 * ⚠️ the same id twice in one call is folded first (merges compose, a replace wins), because UPDATE … FROM updates a row
 * once with whichever input row it meets — "the last line of the sheet wins" is decided here, not by chance.
 * ⚠️ updated_at moves only when item_data does: a soft remove never touched it.
 */
async function patchItems(db, entity_id, edits, opts) {
  const o = opts || {};
  const text = edits && !Array.isArray(edits) ? edits : null;
  const list = text ? (text.ids || []).map((id) => ({ item_id: id, merge: text.merge, replace: text.replace, active: text.active })) : edits || [];
  const byId = foldEdits(list);
  if (!byId.size) return { rows: [], rowCount: 0 };
  const ids = [],
    datas = [],
    modes = [],
    actives = [];
  byId.forEach((item, id) => {
    ids.push(id);
    datas.push(item.mode ? JSON.stringify(item.data || {}) : null);
    modes.push(item.mode);
    actives.push(item.active);
  });
  return db.query(
    `UPDATE catalogue_items AS c
        SET item_data = CASE u.mode WHEN 'merge'   THEN COALESCE(c.item_data, '{}'::jsonb) || u.data::jsonb
                                    WHEN 'replace' THEN u.data::jsonb
                                    ELSE c.item_data END,
            is_active = COALESCE(u.active, c.is_active),
            updated_at = CASE WHEN u.mode IS NULL THEN c.updated_at ELSE NOW() END
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::boolean[]) AS u(id, data, mode, active)
      WHERE c.item_id = u.id AND c.entity_id = $5${o.activeOnly ? ' AND c.is_active = true' : ''}
    RETURNING ${returningOf(o.returning)}`,
    [ids, datas, modes, actives, entity_id]
  );
}

/**
 * patchWhere(db, match, merge) — the same merge for every product whose item_data[field] equals a value (a slab takeover,
 * a help desk refining its answer by qa_id). match { field, value, entity_id?, activeOnly?, activate? } → the pg result.
 * ⚠️ without entity_id the connection's RLS context is the only scope — call it inside withEntity.
 */
async function patchWhere(db, match, merge) {
  const m = match || {};
  if (!/^[a-z_]+$/.test(String(m.field || ''))) throw new Error('patchWhere: bad field ' + m.field);
  const args = [String(m.value), JSON.stringify(merge || {}), m.field];
  let where = `item_data->>$3 = $1`;
  if (m.entity_id) {
    args.push(m.entity_id);
    where = `entity_id = $4 AND ` + where;
  }
  if (m.activeOnly) where = `is_active = true AND ` + where;
  return db.query(
    `UPDATE catalogue_items SET item_data = COALESCE(item_data, '{}'::jsonb) || $2::jsonb,${m.activate ? ' is_active = true,' : ''} updated_at = NOW()
      WHERE ${where}`,
    args
  );
}

/**
 * ⭐ the codes a shop is already using, so a sequence can be allocated against fact rather than a counter.
 * ⚠️ BOTH SPELLINGS. The till reads `d.code || d.sku` and a spreadsheet may have supplied either, so a sequence
 * that looked at only one would hand out a code the other half of the catalogue already holds.
 */
async function codesInUse(entity_id) {
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT COALESCE(item_data->>'code', item_data->>'sku') AS code
       FROM catalogue_items
      WHERE entity_id = $1 AND COALESCE(item_data->>'code', item_data->>'sku') IS NOT NULL`,
      [entity_id]
    )
  );
  return r.rows.map((x) => x.code).filter(Boolean);
}

/** how many sellable products the shop has — what "is this catalogue empty?" means */
async function countItems(entity_id) {
  const r = await withEntity(entity_id, (db) =>
    db.query(`SELECT COUNT(*)::int AS n FROM catalogue_items WHERE entity_id = $1 AND is_active IS NOT false`, [entity_id])
  );
  return (r.rows[0] && r.rows[0].n) || 0;
}

module.exports = { judgeItem, writeItems, writeCitedItems, meterItems, insertStamped, patchItems, patchWhere, codesInUse, countItems, defaultSchemaId, schemaFieldsOf, validateAgainst, unitRefusal, MAX_NUMBER };
