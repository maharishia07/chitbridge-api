// @stage tested
// @stage-note ONE declare-first writer + ONE column resolver. The declaration and the store were never bound;
// @stage-note every surface picked its own truth. This binds them. Pure core, injected I/O — like catalogue-view.
'use strict';
/**
 * catalogue-columns.js — the declaration and the store, bound.
 *
 * ── ⚠️⚠️ THE ROOT CAUSE THIS FILE EXISTS TO REMOVE ──────────────────────────────────────────────────────────────
 * `schema_fields` declares the catalogue's columns. `catalogue_items.item_data` is free-form jsonb. **Nothing bound
 * them**, so every feature had to decide for itself which one was the truth, and four of them decided differently:
 *
 *   · the CSV import  → "declare, then write"           (correct, and the only one)
 *   · the export      → "trust the data"
 *   · the template    → "both, but only the newest 200 rows"
 *   · the Columns panel → "the declaration"
 *
 * No one of those is wrong on its own. No two of them agree. The user meets that directly: download the template,
 * download the export, open the Columns panel — **three different column lists for one catalogue.**
 *
 * ── ⭐⭐ THE FIX IS A PROPERTY, NOT A PATCH ─────────────────────────────────────────────────────────────────────
 * Make every write DECLARE what it stores, and the invariant `declared ⊇ observed` holds by construction. Once it
 * does, "declared ∪ observed" and "declared" are the SAME LIST, and the four surfaces cannot disagree — not
 * because they were each corrected, but because there is no longer anything to disagree about.
 *
 * So: one writer (`ensureDeclared`) that every write path calls, one resolver (`resolveColumns`) that every
 * reader calls.
 *
 * ── ⚠️ AUTO-DECLARE IS SAFE. AUTO-MERGE IS NOT. THE DIFFERENCE IS THE WHOLE DESIGN. ────────────────────────────
 * Lifting the import's declare-first logic without also lifting its RECONCILIATION would import the sloppiness
 * preflight exists to prevent: `grade`, `Grade` and `grde` as three permanent columns, and nothing anywhere
 * saying so. The CSV path is safe only because **preflight puts a human in front of header reconciliation**;
 * `POST /api/products` has no preflight and never will — it is one product, not a file.
 *
 * So this folds a key onto an existing column ONLY where the answer is deterministic:
 *
 *   exact key · the column's own label · a known synonym   → FOLD (no new column)
 *   merely SIMILAR (bigram distance)                       → DECLARE IT, and WARN
 *
 * ⚠️ Similarity must never merge unattended. csv-preflight's own header says it: fuzzy matching "must fix TYPING
 * and never merge two real things — 'orange grade 1' and 'orange grade 2' are one character apart". A human
 * confirming a suggestion is what makes fuzz safe, and there is no human on this path. A warning that names the
 * neighbour costs nothing and can be acted on; a silent merge is unrecoverable.
 *
 * ── ⚠️ NOT EVERY KEY IN item_data IS A COLUMN ──────────────────────────────────────────────────────────────────
 * A naive "declare every incoming key" would manufacture columns for the system's own bookkeeping — the
 * travelling `category_names` copy, the `commercials` overlay on an adopted line, the record ids. See RESERVED.
 * Getting this wrong would fill every merchant's Columns panel with junk that cannot be removed (it would be in
 * use, by definition) — a worse screen than the one we started with.
 *
 * ── ZERO DEPENDENCIES beyond csv-preflight (whose matcher and key-folding we deliberately REUSE) ────────────────
 */

const preflight = require('./csv-preflight');
const columnRules = require('./column-rules');

/**
 * ⚠️⚠️ KEYS THAT ARE NEVER COLUMNS, and why each one is here. This list is load-bearing: anything missing from it
 * becomes a permanent, unremovable column on somebody's catalogue the first time a product carries it.
 */
const RESERVED = Object.assign(
  {},
  /* preflight already refuses these on a file, for reasons that hold identically on a single add. */
  preflight.BLOCKED,
  {
    /* The system fields: written to item_data like any value, SHOWN in the panel, but never declarable — their
       SHAPE is load-bearing (status is an enum with a lifecycle, avail is {qty, source, as_of}). See
       column-rules.SYSTEM_FIELDS, which is where the panel gets them from. */
    status:         'the ◍ Status control owns this, and its shape is read by the storefront and the matcher',
    avail:          'a quantity feed, not a typed column — it carries the date it was true',
    categories:     'the Categories screen owns these; a product cites them by id',
    /* ⚠️ A slab is CITED by definition_id, so a typed cell ("18%") would resolve to nothing while looking
       answered. `gst_rate` is deliberately NOT reserved — see the note in column-rules.SYSTEM_FIELDS. */
    tax_slab:       'the Pricing & tax pane owns this; a product cites one slab by id',
    /* Travelling copies and overlays — bookkeeping that rides ON a product without being a fact ABOUT it. */
    category_names: 'a positional copy of the category names, for counterparties who cannot resolve our ids',
    tax_slab_name:  'a copy of the slab\'s name, for counterparties who cannot resolve our ids',
    category:       'the legacy single-category key — read, never written again',
    commercials:    'the adopter\'s overlay on a referenced line, not a field of the product',
    synonyms:       'match hints for the message matcher, not something the product records',
    source_ref:     'where a referenced line came from — the system\'s, not the merchant\'s',
  }
);

/** Every system field the panel shows, so a resolver can list them without re-deciding what they are. */
const SYSTEM_KEYS = columnRules.SYSTEM_FIELDS.map((f) => f.field_key);

/**
 * ⚠️ NOT preflight's FUZZY_ACCEPT — see the note in fold(). That bar answers "may I propose this to a human?";
 * this one answers "should I mention it to nobody in particular?", and the cost of a false positive is a sentence.
 * Low enough to catch a dropped letter (grde/grade ≈ 0.57), high enough that unrelated words stay quiet.
 */
const NEAR_FLOOR = 0.45;

/** The closest declared column to a key, by the same bigram measure preflight uses. Pure. */
function nearest(key, accepted, labels) {
  const n = preflight.normalise(key);
  const lab = labels || {};
  let best = { canonical: null, score: 0 };
  for (const k of accepted || []) {
    for (const alias of [k, lab[k]].filter(Boolean)) {
      const s = preflight.similarity(n, preflight.normalise(alias));
      if (s > best.score) best = { canonical: k, score: Math.round(s * 100) / 100 };
    }
  }
  return best;
}

/* ── the pure half ─────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * fold(key, accepted, labels) → { key, how, from }
 *
 * `how` ∈ exact | label | synonym | new | similar | reserved.
 * `from` is the incoming spelling when it differed, so a caller can report what it did.
 *
 * ⭐ THE ORDER IS THE POLICY. A column the catalogue itself declares beats any synonym, because a declared key IS
 * this catalogue's accepted format — the same precedence csv-preflight.matchHeader applies to a file header, and
 * for the same reason: our own vocabulary outranks a general one.
 */
function fold(key, accepted, labels) {
  const raw = String(key == null ? '' : key);
  const acc = accepted || [];
  const lab = labels || {};

  if (Object.prototype.hasOwnProperty.call(RESERVED, raw)) {
    return { key: raw, how: 'reserved', from: raw, why: RESERVED[raw] };
  }
  /* Exact, on the key as stored — the overwhelmingly common case, and it must cost nothing. */
  if (acc.includes(raw)) return { key: raw, how: 'exact', from: raw };

  const m = preflight.matchHeader(raw, acc, lab);
  if (m.canonical && (m.how === 'exact' || m.how === 'synonym')) {
    return { key: m.canonical, how: m.how === 'exact' ? 'label' : 'synonym', from: raw, why: m.why };
  }
  if (m.how === 'blocked') return { key: raw, how: 'reserved', from: raw, why: m.why };

  const k = preflight.toFieldKey(raw);
  if (!k) return { key: raw, how: 'reserved', from: raw, why: 'a column needs a name' };
  if (acc.includes(k)) return { key: k, how: 'exact', from: raw };
  if (Object.prototype.hasOwnProperty.call(RESERVED, k)) {
    return { key: k, how: 'reserved', from: raw, why: RESERVED[k] };
  }

  /**
   * ⚠️ A SIMILAR NEIGHBOUR IS A WARNING, NOT A DECISION. This is the whole safety argument of the file: we say
   * "this looks like `grade`" and still create `grde`, because merging them unattended could silently destroy the
   * distinction between two real products. The merchant can rename; they cannot un-merge.
   *
   * ⭐⭐ AND WE WARN EARLIER THAN PREFLIGHT MATCHES, deliberately. `FUZZY_ACCEPT` (0.62) is tuned for a DIFFERENT
   * question — "may I propose this mapping to a person who will confirm it?" — where a bad guess wastes their
   * attention. Here nobody is being asked, so the two errors are not symmetrical: a warning nobody needed costs
   * one line of JSON, and a typo that silently becomes a permanent column costs a column that can never be
   * removed (it is in use, by definition). `grde` scores 0.57 against `grade` — under preflight's bar, and
   * exactly the case worth naming. So: **merge only at certainty, warn at any resemblance.**
   */
  const near = nearest(k, acc, lab);
  if (near.canonical && near.score >= NEAR_FLOOR) {
    return { key: k, how: 'similar', from: raw, near: near.canonical, confidence: near.score };
  }
  return { key: k, how: 'new', from: raw };
}

/**
 * planWrite({ item_data, declared, labels }) → { item_data, newFields, warnings, folded }
 *
 * Pure. Decides — for ONE product — the item_data that should be stored and the columns that must exist first.
 * Does no I/O so it can be unit-tested against a fixed declaration, and so a caller may inspect the plan before
 * committing to it.
 */
function planWrite({ item_data, declared, labels }) {
  const src = item_data && typeof item_data === 'object' ? item_data : {};
  const acc = (declared || []).map((d) => (typeof d === 'string' ? d : d.field_key));
  const lab = labels || {};

  const out = {};
  const newFields = [];
  const warnings = [];
  const folded = [];

  for (const [k, v] of Object.entries(src)) {
    const f = fold(k, acc, lab);

    /* Reserved keys are STORED, never declared. `status` must reach item_data; it just is not a column. */
    if (f.how === 'reserved') { out[f.key] = v; continue; }

    if (f.key !== f.from) folded.push({ from: f.from, to: f.key, how: f.how });

    /**
     * ⚠️ LAST WRITER WINS ONLY IF IT SAYS SOMETHING. Two incoming spellings can fold onto one column ({Price: 10,
     * price: ''}); taking the later blindly would let an empty string erase a real value on the strength of key
     * ordering, which nothing about the caller's intent supports.
     */
    const has = Object.prototype.hasOwnProperty.call(out, f.key);
    const empty = (x) => x === null || x === undefined || String(x).trim() === '';
    if (!has || !empty(v)) out[f.key] = v;

    if (acc.includes(f.key)) continue;
    if (newFields.some((n) => n.field_key === f.key)) continue;

    newFields.push({
      field_key: f.key,
      /* The merchant's own spelling becomes the label — it is what they will look for on the screen. */
      field_name: String(f.from).trim() || f.key,
      /* ⚠️ AN IDENTIFIER IS TEXT, WHATEVER IT LOOKS LIKE. A first product whose code was '1006' (an HSN) declared
         `code` as a NUMBER for the whole catalogue, and every later 'BAS-25' was refused on EDIT — 'code must be a
         number' (IDN-01, 2026-09-04). Digits with a leading zero, a dash or a check digit are a code, not a quantity. */
      field_type: IDENT_KEYS.has(f.key) ? 'text' : preflight.inferType([v]),
      required: false,
    });
    if (f.how === 'similar') {
      warnings.push(`"${f.from}" was added as a new column — it resembles your existing "${f.near}" `
        + `(${Math.round(f.confidence * 100)}% similar). Rename it if they are the same thing.`);
    }
  }
  return { item_data: out, newFields, warnings, folded };
}

/* ── the I/O half — dependencies injected, never required here ─────────────────────────────────────────────── */

/** The declaration as the writer needs it: keys, labels, and the rules a caller's validate() will want. */
async function readDeclaration(query, schema_id) {
  if (!schema_id) return [];
  const r = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`, [schema_id]);
  return r.rows;
}

/**
 * Append columns to a schema, in the order given, and return the keys actually created.
 *
 * ⚠️ APPEND, NEVER REORDER. Athi, 2026-08-06: *"we have to maintain the order of the column, so always the column
 * comes the same way — we cannot keep changing the column position."* A new column takes the next display_order
 * and nothing above it moves, so registering a column changes nothing anybody can see today, and from then on its
 * position is a stored fact rather than a rule that might sort differently tomorrow.
 */
async function commitFields({ query, schema_id, newFields }) {
  if (!schema_id || !(newFields || []).length) return [];
  const ord = await query(`SELECT COALESCE(MAX(display_order),0) AS m FROM schema_fields WHERE schema_id=$1`, [schema_id]);
  let n = Number(ord.rows[0].m) || 0;
  const created = [];
  for (const f of newFields) {
    /* A concurrent write could be adding the same column; this is a re-check, not a race-free claim. */
    const dup = await query(`SELECT 1 FROM schema_fields WHERE schema_id=$1 AND field_key=$2`, [schema_id, f.field_key]);
    if (dup.rows.length) continue;
    await query(
      `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
       VALUES ($1,$2,$3,$4,false,$5)`, [schema_id, f.field_name, f.field_key, f.field_type, ++n]);
    created.push(f.field_key);
  }
  return created;
}

/**
 * ensureDeclaredMany({ query, entity_id, schema_id, items, ensureSchema, validate })
 *   → { items, declared, warnings, schema_id, invalid }
 *
 * THE ONE WRITER, for any number of products.
 *
 * ⚠️⚠️ ONE READ AND ONE COMMIT, HOWEVER MANY ITEMS ARRIVE. The first version of this called the single-item
 * writer in a loop, which re-read `schema_fields` per product — 200 identical queries for a declaration that
 * cannot change mid-request. That is precisely the cost Athi has already had to point out twice (*"any of this
 * implementation, if it is greater than O(1), is not required — it will be very costly"*), and writing it a third
 * time in the very function built to unify the write paths would have been the joke telling itself.
 *
 * The plan is built in memory across the whole batch, so two rows introducing the same new column produce ONE
 * column, and the batch is refused or written as a whole.
 */
async function ensureDeclaredMany({ query, entity_id, schema_id, items, ensureSchema, validate }) {
  const list = Array.isArray(items) ? items : [];
  const declaredRows = await readDeclaration(query, schema_id || null);
  const labels = Object.fromEntries(declaredRows.filter((f) => f.field_name).map((f) => [f.field_key, f.field_name]));
  const accepted = declaredRows.map((f) => f.field_key);

  const out = [];
  const warnings = [];
  const pending = [];          // new columns, deduplicated across the batch, in first-seen order
  const invalid = [];

  list.forEach((it, i) => {
    const plan = planWrite({ item_data: it, declared: accepted, labels });
    out.push(plan.item_data);
    warnings.push(...plan.warnings);
    for (const f of plan.newFields) if (!pending.some((p) => p.field_key === f.field_key)) pending.push(f);
    if (typeof validate === 'function') {
      const verr = validate(plan.item_data, declaredRows);
      if (verr) invalid.push({ index: i, message: verr });
    }
  });

  /* ⚠️ Nothing is declared for a batch that was refused — see the ordering note in ensureDeclared. */
  if (invalid.length) return { items: out, declared: [], warnings, schema_id: schema_id || null, invalid };

  let sid = schema_id || null;
  if (!sid && pending.length && typeof ensureSchema === 'function') {
    const boot = await ensureSchema(entity_id);
    sid = (boot && boot.schema_id) || null;
  }
  const declared = await commitFields({ query, schema_id: sid, newFields: pending });
  return { items: out, declared, warnings, schema_id: sid, invalid: [] };
}

/**
 * ensureDeclared({ query, entity_id, schema_id, item_data, ensureSchema }) → { item_data, declared, warnings }
 *
 * THE ONE WRITER. Call before every insert or update of item_data.
 *
 * ⚠️ DECLARE FIRST, WRITE SECOND — the order is the guarantee. The columns have to exist before the products that
 * use them, so a failure here leaves nothing half-recorded. (The CSV import already did exactly this and said so;
 * this is that behaviour, lifted, so there is one of it.)
 */
/**
 * ensureDeclared(...) → { item_data, declared, warnings, schema_id, error }
 *
 * The single-product convenience over ensureDeclaredMany. ⚠️ A WRAPPER, NOT A SECOND IMPLEMENTATION — two
 * writers is the condition this whole file exists to end, and it would be a poor joke to introduce one here.
 */
async function ensureDeclared(opts) {
  const r = await ensureDeclaredMany(Object.assign({}, opts, { items: [opts && opts.item_data] }));
  return {
    item_data: r.items[0],
    declared: r.declared,
    warnings: r.warnings,
    schema_id: r.schema_id,
    error: r.invalid.length ? r.invalid[0].message : null,
  };
}

/**
 * resolveColumns({ query, withEntity, entity_id, schema_id }) → { columns, declared, undeclared, system, used, labels, types }
 *
 * THE ONE RESOLVER. The Columns panel, the template and the export all call this, so they cannot answer
 * differently.
 *
 * ⚠️ NO `LIMIT`. The template used to observe only the newest 200 items, so a column used solely by product #201
 * was invisible in the template and present in the export — a discrepancy with no explanation available to the
 * person meeting it. The scan is ONE query with a GROUP BY (the same one the Columns panel already runs for its
 * usage counts), so removing the limit costs nothing and buys correctness.
 *
 * ⭐ AFTER the declare-first writer and the backfill, `undeclared` is EMPTY and stays empty. It is kept because a
 * catalogue that predates this file still has legacy keys, and dropping them here would lose data on the way out.
 * When it is empty everywhere, this branch can go.
 */
async function resolveColumns({ query, withEntity, entity_id, schema_id }) {
  let declared = [];
  if (schema_id) {
    const r = await query(
      `SELECT field_key, field_name, field_type, required, display_order
       FROM schema_fields WHERE schema_id = $1 ORDER BY display_order ASC`, [schema_id]);
    declared = r.rows;
  }

  const used = {};
  try {
    const u = await withEntity(entity_id, (db) => db.query(
      `SELECT kv.key AS field_key, count(*)::int AS n
         FROM catalogue_items ci, LATERAL jsonb_each_text(ci.item_data) AS kv
        WHERE ci.entity_id = $1 AND ci.is_active = true
          AND kv.value IS NOT NULL AND btrim(kv.value) <> ''
        GROUP BY kv.key`, [entity_id]));
    u.rows.forEach((r) => { used[r.field_key] = r.n; });
  } catch (_) { /* a counting failure must not hide the columns themselves */ }

  const declaredKeys = declared.map((f) => f.field_key);
  /**
   * ⚠️ SORTED, NOT FIRST-SEEN. A legacy key has no display_order, so its position can only come from a rule — and
   * "the order rows happened to be created in" is not stable across a delete or a re-import. Alphabetical is
   * arbitrary but IDENTICAL on every surface, which is the only property that matters here.
   */
  const undeclared = Object.keys(used)
    .filter((k) => !declaredKeys.includes(k))
    .filter((k) => !Object.prototype.hasOwnProperty.call(RESERVED, k))
    .sort();

  const labels = {};
  const types = {};
  declared.forEach((f) => { if (f.field_name) labels[f.field_key] = f.field_name; types[f.field_key] = f.field_type; });

  return {
    columns: declaredKeys.concat(undeclared),
    declared, undeclared, used, labels, types,
    system: SYSTEM_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(used, k)),
  };
}

/** keys that hold an IDENTIFIER — never typed as a number, never validated as one */
const IDENT_KEYS = new Set(['code','sku','hsn','sac','gtin','ean','upc','isbn','barcode','part_no','article','item_code','product_code','pin','pincode','zip','phone','mobile']);
module.exports = { IDENT_KEYS, RESERVED, SYSTEM_KEYS, NEAR_FLOOR, nearest, fold, planWrite,
  readDeclaration, commitFields, ensureDeclared, ensureDeclaredMany, resolveColumns };
