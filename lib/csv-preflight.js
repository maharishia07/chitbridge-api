// @stage tested
// @stage-note Dry-run header reconciliation for a catalogue upload. Reads nothing, writes nothing, decides nothing —
// it produces a REPORT a person approves. The commit half is deliberately not built yet.
'use strict';
/**
 * csv-preflight.js — read the file BEFORE it becomes data.
 *
 * Athi, 2026-08-06: *"download different catalogue and upload different types — what if the columns are different, or
 * named differently? do we have a parser before uploading and providing any suggestion?"*
 *
 * We did not. `cwImportCSV` regex-matched `name` and `price`, and every other header became an item key VERBATIM.
 * So `Rate`, `Price (INR)`, `Unit Price` and `price` were four different fields on four different products, and
 * nothing anywhere said so. Upload a Medusa export next to a hand-typed sheet and the catalogue quietly grows four
 * names for one fact — the exact schema drift the golden-record work exists to prevent.
 *
 * This is the same argument as the Medusa mapper, one notch down. There, two platforms had to land on the same line;
 * here, two SPREADSHEETS do. The difference is that a spreadsheet has no schema to consult, so the mapping is a
 * PROPOSAL a person confirms, never an inference we act on silently.
 *
 * ── ADOPTED, NOT INVENTED ──────────────────────────────────────────────────────────────────────────────────────
 *   · The shape of the answer is CSVW / Frictionless Table Schema's: incoming column → declared field, reported
 *     rather than assumed. We use the idea and the vocabulary; no third-party code is embedded.
 *   · Fuzzy matching is Dice–Sørensen on character bigrams — ~15 lines, no dependency, and it handles the actual
 *     failure ("Prodcut Name", "unit_price") better than Levenshtein at this length.
 *   · GTIN/SKU classification already exists in gs1.js and is not redone here.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IT REFUSES TO GUESS ───────────────────────────────────────────────────────────────────────────────────
 * A column it cannot place is reported as UNMATCHED, not dropped and not invented into the catalogue. A column that
 * carries governance (`order_input`) or is the server's to decide (`price_currency`, the internal ids) is BLOCKED
 * outright: no confidence score gets to override that, because the sheet is not allowed to declare a mode or a
 * currency however confidently it is labelled.
 */

// Kept in step with csv.js by the test below rather than by a require — same rule as the other Tier A libs: this
// file must stay liftable on its own.
const MONEY_KEYS = ['price', 'price_min', 'price_max'];

/**
 * The canonical fields, and what a real export calls them.
 *
 * Drawn from what actually turns up: Medusa/Saleor exports, Tally and Busy (the two every Indian SME desk runs),
 * and hand-typed sheets. `desc` sits beside `description` because our own live catalogue uses the short form.
 */
const SYNONYMS = {
  sku:            ['sku', 'code', 'item code', 'itemcode', 'product code', 'article', 'article no', 'part no', 'part number',
                   'mpn', 'barcode', 'ean', 'gtin', 'upc', 'hsn', 'hsn code', 'item id', 'id'],
  name:           ['name', 'product', 'product name', 'item', 'item name', 'title', 'particulars', 'description of goods'],
  unit:           ['unit', 'uom', 'u o m', 'unit of measure', 'measure', 'pack', 'pack size', 'per'],
  price:          ['price', 'rate', 'mrp', 'cost', 'amount', 'unit price', 'unit rate', 'selling price', 'sale price',
                   'list price', 'price per unit', 'value'],
  price_min:      ['price min', 'min price', 'minimum price', 'floor price', 'floor', 'from price', 'lower', 'low', 'starting price'],
  price_max:      ['price max', 'max price', 'maximum price', 'ceiling price', 'ceiling', 'to price', 'upper', 'high'],
  availability:   ['availability', 'available', 'status', 'stock status', 'in stock'],
  available_qty:  ['available qty', 'available quantity', 'qty', 'quantity available', 'stock', 'stock qty', 'on hand',
                   'closing stock', 'inventory', 'balance'],
  lead_time_days: ['lead time days', 'lead time', 'leadtime', 'delivery days', 'despatch days', 'dispatch days'],
  min_order_qty:  ['min order qty', 'minimum order quantity', 'moq', 'min qty', 'minimum qty', 'min order'],
  desc:           ['desc', 'description', 'details', 'remarks', 'notes', 'long description'],
};

/**
 * Columns a spreadsheet may never set, whatever it calls them.
 *
 * `order_input` is the item's declared MODE and negotiability is the shop's to declare — a range row inside a cart
 * shop imports clean and is refused at order time. `price_currency` is stamped from the owning entity. `quantity` is
 * the customer's, at order time. These are refused BEFORE matching, so a 100%-confident header still cannot set one.
 */
const BLOCKED = {
  order_input:   'the input mode is declared by your catalogue, not per row in a file',
  quantity:      'quantity is what a customer orders, not something a product carries',
  is_active:     'removing a product is a separate action, not a spreadsheet edit',
  item_id:       'record ids are the system\'s',
  entity_id:     'record ids are the system\'s',
  schema_id:     'record ids are the system\'s',
};
for (const k of MONEY_KEYS) BLOCKED[k + '_currency'] = 'prices are recorded in your business\'s own currency automatically';

/** Lowercase, strip punctuation and the noise real headers carry: "Price (INR) *" → "price". */
function normalise(h) {
  return String(h == null ? '' : h)
    .replace(/\([^)]*\)/g, ' ')            // "(INR)", "(kg)" — a unit or currency in the header is not the field name
    .replace(/[₹$€£¥]/g, ' ')         // a bare currency symbol in the header
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice–Sørensen coefficient on character bigrams, 0..1. */
function similarity(a, b) {
  const A = String(a), B = String(b);
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ga = grams(A), gb = grams(B);
  let hits = 0, total = 0;
  for (const [g, n] of ga) { total += n; const m = gb.get(g) || 0; hits += Math.min(n, m); }
  for (const n of gb.values()) total += n;
  return total ? (2 * hits) / total : 0;
}

const FUZZY_ACCEPT = 0.62;   // below this it is reported as unmatched rather than guessed at

/**
 * Words that qualify a column rather than name it.
 *
 * `Product Handle` and `Product Title` both contain "product", so on a straight containment tie the first column
 * won `name` by nothing more than its position in the file. A match made only of these scores lower.
 */
const QUALIFIERS = ['product', 'item', 'variant', 'base', 'default', 'main', 'master', 'primary', 'goods', 'the'];

/**
 * Place one incoming header. Returns { canonical, how, confidence, why }.
 *
 * `labels` maps a field key to the human name the catalogue gave it — `coverage_sqft_per_litre` → "Coverage
 * (sq ft/L)". Without it, a merchant who adopts the paint starter set and types the label they see on their own
 * product form is told the column is unrecognised, which is absurd: it is their own field, under their own name.
 */
function matchHeader(header, accepted, labels) {
  const n = normalise(header);
  if (!n) return { canonical: null, how: 'empty', confidence: 0, why: 'this column has no heading' };
  const lab = labels || {};

  for (const [key, why] of Object.entries(BLOCKED)) {
    if (n === normalise(key)) return { canonical: null, how: 'blocked', confidence: 1, why };
  }

  // A field the catalogue itself declares wins over any synonym — it IS the accepted format.
  for (const k of accepted) if (normalise(k) === n) return { canonical: k, how: 'exact', confidence: 1, why: 'matches your catalogue exactly' };
  for (const k of accepted) {
    if (lab[k] && normalise(lab[k]) === n) {
      return { canonical: k, how: 'exact', confidence: 1, why: `this is your own "${lab[k]}" column` };
    }
  }
  for (const [canon, alts] of Object.entries(SYNONYMS)) {
    if (!accepted.includes(canon)) continue;
    if (alts.some((a) => normalise(a) === n)) return { canonical: canon, how: 'synonym', confidence: 0.95, why: `"${header}" is a common name for ${canon}` };
  }

  // A header that plainly names a field this catalogue does NOT accept must be told so, not bent onto a neighbour.
  // "Min Price" in a cart shop scored 0.67 against `price` and was proposed as the listed price — a merchant who
  // confirmed it would have published their FLOOR as their selling price. Naming the mismatch is the honest answer.
  for (const [canon, alts] of Object.entries(SYNONYMS)) {
    if (accepted.includes(canon)) continue;
    if (canon !== n && !alts.some((a) => normalise(a) === n)) continue;
    return { canonical: null, how: 'not-accepted', confidence: 1,
      why: `this looks like ${canon}, which your catalogue does not use — a ${accepted.includes('price') ? 'fixed-price' : 'this'} catalogue has no ${canon} column` };
  }

  // CONTAINMENT, before fuzzy. A real export qualifies its columns — Medusa ships `Variant SKU` and `Variant
  // Price`, Shopify `Variant Inventory Qty`. Bigram similarity cannot see through the prefix ("variant sku" vs
  // "sku" scores 0.33) so both came back unrecognised on a live Medusa file, which is the single most likely file
  // anyone will upload.
  //
  // A qualifier is not a field name, though: `Product Handle` and `Product Title` both contain "product", and on a
  // straight tie Handle won `name` purely by column order. So a match made ONLY of qualifier words scores lower
  // than one that names an actual field, and `title` beats `product`.
  const tokens = n.split(' ');
  const cands = [];
  for (const k of accepted) {
    for (const alias of [k, lab[k], ...(SYNONYMS[k] || [])].filter(Boolean)) {
      const at = normalise(alias).split(' ').filter(Boolean);
      if (!at.length || !at.every((tk) => tokens.includes(tk))) continue;
      const specific = at.filter((tk) => !QUALIFIERS.includes(tk)).length;
      cands.push({ canonical: k, alias, len: at.length, confidence: specific ? 0.9 : 0.7 });
    }
  }
  if (cands.length) {
    cands.sort((a, b) => (b.confidence - a.confidence) || (b.len - a.len));
    const top = cands[0];
    const rivals = cands.filter((c) => c.confidence === top.confidence && c.len === top.len && c.canonical !== top.canonical);
    if (rivals.length) {
      return { canonical: null, how: 'ambiguous', confidence: top.confidence,
        why: `this could be ${[top.canonical, ...rivals.map((r) => r.canonical)].join(' or ')} — rename the column to say which` };
    }
    return { canonical: top.canonical, how: 'contains', confidence: top.confidence,
      why: `contains "${top.alias}", so it is probably ${top.canonical} — please confirm` };
  }

  // Fuzzy, against the accepted fields AND their aliases; the alias's canonical is what we propose.
  let best = { canonical: null, score: 0, via: null };
  for (const k of accepted) {
    const cands = [k, lab[k], ...(SYNONYMS[k] || [])].filter(Boolean);
    for (const c of cands) {
      const s = similarity(n, normalise(c));
      if (s > best.score) best = { canonical: k, score: s, via: c };
    }
  }
  if (best.score >= FUZZY_ACCEPT) {
    return { canonical: best.canonical, how: 'fuzzy', confidence: Math.round(best.score * 100) / 100,
      why: `looks like ${best.canonical}${best.via && best.via !== best.canonical ? ` (close to "${best.via}")` : ''} — please confirm` };
  }
  return { canonical: null, how: 'unmatched', confidence: Math.round(best.score * 100) / 100,
    why: 'no column in your catalogue matches this — it will be ignored unless you map it' };
}

const NUMERIC_FIELDS = ['price', 'price_min', 'price_max', 'available_qty', 'lead_time_days', 'min_order_qty'];

/** Strip the things people type into a price cell. "₹ 1,250.00" → 1250 · "1 200 AED" → 1200 · "n/a" → null. */
function looseNumber(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { value: null, cleaned: false };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: Number(s), cleaned: false };
  const stripped = s
    .replace(/[₹$€£¥]/g, '')
    .replace(/\b[A-Z]{3}\b/g, '')          // a currency code sitting in the cell
    .replace(/[,\s]/g, '')
    .trim();
  if (/^-?\d+(\.\d+)?$/.test(stripped)) return { value: Number(stripped), cleaned: true };
  return { value: null, cleaned: false };
}

/**
 * preflight({ headers, rows, template }) → the report a person approves.
 *
 * `template` is what templateFor() returned for THIS catalogue: `columns` is the accepted format. Nothing here
 * touches the database and nothing here writes an item — the caller decides what to do with the verdict.
 */
function preflight(opts = {}) {
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const tpl = opts.template || {};
  const accepted = Array.isArray(tpl.columns) ? tpl.columns : [];
  const optional = Array.isArray(tpl.optional) ? tpl.optional : [];

  const labels = opts.labels || {};
  const mapping = headers.map((h) => Object.assign({ incoming: h }, matchHeader(h, accepted, labels)));

  // Two headers landing on one field is a real ambiguity ("Rate" and "Price" both → price). Keep the stronger and
  // report the other, rather than letting column order decide silently.
  const claimed = new Map();
  for (const m of mapping) {
    if (!m.canonical) continue;
    const prev = claimed.get(m.canonical);
    if (!prev) { claimed.set(m.canonical, m); continue; }
    const loser = m.confidence > prev.confidence ? prev : m;
    const winner = loser === m ? prev : m;
    claimed.set(m.canonical, winner);
    loser.conflict = `also matched ${loser.canonical}; "${winner.incoming}" was the stronger match`;
    loser.canonical = null;
    loser.how = 'conflict';
  }

  const mapped = [...claimed.keys()];
  /**
   * What the file must carry.
   *
   * ⚠️ This was "every accepted column that is not one of the optional trade extras", and it made `ready` almost
   * unreachable: a catalogue that declares `code` and `desc` — both OPTIONAL in the schema, and both created
   * optional by an import — was told its file was incomplete for not carrying them. A merchant would have seen
   * "needs a look" forever and learned to ignore it.
   *
   * The schema knows which fields are required, so the caller passes them. With no list, only a product NAME is
   * insisted on: it is the one column with no sensible default, and a catalogue that takes no prices at all (an
   * enquiry desk) must not be told it is missing one.
   */
  const required = (Array.isArray(opts.required) ? opts.required : ['name'])
    .filter((c) => accepted.includes(c) && !optional.includes(c) && c !== 'sku');
  const missing = required.filter((c) => !mapped.includes(c));

  // ── row-level checks ──────────────────────────────────────────────────────────────────────────────────────────
  const issues = [];
  const add = (row, column, message, severity) => issues.push({ row, column, message, severity: severity || 'warn' });
  const skusSeen = new Map();
  const idxOf = (canon) => mapping.findIndex((m) => m.canonical === canon);
  const cellAt = (r, canon) => { const i = idxOf(canon); return i < 0 ? undefined : (Array.isArray(r) ? r[i] : r[mapping[i].incoming]); };

  let cleanedCells = 0, usable = 0;
  rows.forEach((r, n) => {
    const line = n + 2;                                  // +1 for the header, +1 because people count from 1
    const name = cellAt(r, 'name');
    if (mapped.includes('name') && !String(name == null ? '' : name).trim()) {
      add(line, 'name', 'no product name — this row cannot be imported', 'error');
    } else usable++;

    for (const f of NUMERIC_FIELDS) {
      if (!mapped.includes(f)) continue;
      const raw = cellAt(r, f);
      if (raw === undefined || String(raw).trim() === '') continue;
      const { value, cleaned } = looseNumber(raw);
      if (value === null) add(line, f, `"${raw}" is not a number`, 'error');
      else if (cleaned) { cleanedCells++; add(line, f, `"${raw}" will be read as ${value}`, 'info'); }
      else if (value < 0) add(line, f, `${f} cannot be negative`, 'error');
    }

    if (mapped.includes('price_min') && mapped.includes('price_max')) {
      const lo = looseNumber(cellAt(r, 'price_min')).value, hi = looseNumber(cellAt(r, 'price_max')).value;
      if (lo !== null && hi !== null && lo > hi) add(line, 'price_min', `low price ${lo} is above high price ${hi}`, 'error');
    }

    if (mapped.includes('sku')) {
      const sku = String(cellAt(r, 'sku') == null ? '' : cellAt(r, 'sku')).trim();
      if (sku) {
        if (skusSeen.has(sku)) add(line, 'sku', `"${sku}" also appears on line ${skusSeen.get(sku)}`, 'error');
        else skusSeen.set(sku, line);
      }
    }
  });

  const blocked = mapping.filter((m) => m.how === 'blocked');
  const unmatched = mapping.filter((m) => ['unmatched', 'empty', 'not-accepted', 'ambiguous'].includes(m.how));
  // A qualifier-stripped match is still an inference, so it needs the same confirmation a typo-match does.
  const needsConfirming = mapping.filter((m) => m.how === 'fuzzy' || m.how === 'contains');
  const errors = issues.filter((i) => i.severity === 'error');

  const notes = [];
  if (blocked.length) notes.push(`${blocked.length} column(s) will be ignored because a file may not set them: ${blocked.map((b) => b.incoming).join(', ')}.`);
  if (unmatched.length) notes.push(`${unmatched.length} column(s) do not match anything in your catalogue and will not be imported: ${unmatched.map((u) => u.incoming).join(', ')}.`);
  if (needsConfirming.length) notes.push(`${needsConfirming.length} column(s) were matched by similarity — check them before importing.`);
  if (cleanedCells) notes.push(`${cleanedCells} cell(s) contain symbols or separators that will be read as plain numbers.`);
  if (missing.length) notes.push(`Your catalogue expects ${missing.join(', ')} and the file has no column for ${missing.length > 1 ? 'them' : 'it'}.`);
  // ⚠️ THE IDENTITY COLUMN, and the most expensive thing to leave unsaid.
  //
  // A product is matched by its code. Without one there is nothing to match on, so every row is a NEW product —
  // upload the same sheet twice and you have two of everything. Proved live: a second upload of one unchanged
  // product created a second identical row, silently, and reported "1 added" as success.
  if (accepted.includes('sku') && !mapped.includes('sku') && rows.length) {
    notes.push(`⚠ No code column. Products are matched by their code, so every row here will be ADDED as a new product — nothing can be updated, and uploading this file twice would create duplicates.`);
  }

  return {
    mapping,
    mapped,
    missing,
    blocked: blocked.map((b) => ({ incoming: b.incoming, why: b.why })),
    unmatched: unmatched.map((u) => u.incoming),
    needsConfirming: needsConfirming.map((m) => ({ incoming: m.incoming, canonical: m.canonical, confidence: m.confidence })),
    issues,
    rowCount: rows.length,
    // What a person actually wants to know, stated once and honestly.
    summary: {
      rows: rows.length,
      importable: Math.max(0, rows.length - new Set(errors.map((e) => e.row)).size),
      errors: errors.length,
      warnings: issues.length - errors.length,
    },
    // NOT a decision — the caller and the person both have to agree. `false` means something needs a human first.
    ready: missing.length === 0 && errors.length === 0 && needsConfirming.length === 0 && rows.length > 0,
    notes,
  };
}

/**
 * ── THE COMMIT HALF ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-06: *"if we have to introduce or extend the column to map to the structure given in the excel, how
 * do we do? … after that if they are going to provide a list of columns based on their existing structure, can we
 * set the column accordingly, so the particular entity can follow the same standard always?"*
 *
 * Yes — and the mechanism is the loop we already have, closed:
 *
 *     declaration ──► template ──► the merchant's file ──► preflight ──► CONFIRM ──► declaration extended
 *          ▲                                                                                │
 *          └────────────────────────────────────────────────────────────────────────────────┘
 *
 * The entity's schema IS the standard. Template, preflight and export all project from it, so the moment a column is
 * added to the declaration, every one of them knows about it — the next template offers it, the next upload matches
 * it EXACTLY rather than guessing, and the entity keeps the same format for good. That is the whole answer to "can
 * the entity follow the same standard always": not because we remember the mapping, but because there is only one
 * declaration and it is the thing that changed.
 *
 * ── ADDITIVE ONLY, AND WHY THAT IS NOT A LIMITATION ────────────────────────────────────────────────────────────
 * A file may ADD a field. It may never rename one, retype one, or make one required — because the products already
 * in the catalogue satisfy the current contract, and a spreadsheet retroactively invalidating 400 existing products
 * is not an import, it is an outage. New fields are therefore always created OPTIONAL. Changing an existing field
 * stays a deliberate act on the schema, where a person can see what it will break.
 *
 * ── NOTHING HAPPENS WITHOUT A DECISION ─────────────────────────────────────────────────────────────────────────
 * Every column needs an explicit decision: `map` to a field the catalogue already accepts, `create` it as a new
 * field, or `ignore` it. A column with NO decision is ignored — never imported on the strength of the preflight's
 * own suggestion. The suggestion is a proposal; the decision is the person's.
 */

/** A header becomes a field key: "Warehouse Bay" → warehouse_bay. */
function toFieldKey(header) {
  const k = normalise(header).replace(/\s+/g, '_').replace(/^[^a-z]+/, '');
  return k.slice(0, 60);
}

/** text unless every value present in the column is a number — which is what schema_fields.field_type wants. */
function inferType(values) {
  const present = values.filter((v) => String(v == null ? '' : v).trim() !== '');
  if (!present.length) return 'text';
  return present.every((v) => looseNumber(v).value !== null) ? 'number' : 'text';
}

/**
 * applyDecisions({ headers, rows, template, decisions }) → { items, newFields, errors, lines }
 *
 * Pure. Validates the decisions against the file and the accepted format, then turns the rows into item_data.
 * Refuses rather than repairs: a decision that does not hold up is an error the caller must show, not something to
 * silently drop, because a silently dropped decision imports a column the person thought they had mapped.
 */
function applyDecisions(opts = {}) {
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const accepted = (opts.template && opts.template.columns) || [];
  const decisions = Array.isArray(opts.decisions) ? opts.decisions : [];

  const errors = [];
  const byHeader = new Map();
  const claimed = new Map();
  const newFields = [];

  for (const d of decisions) {
    const incoming = d && d.incoming;
    const idx = headers.indexOf(incoming);
    if (idx < 0) { errors.push(`The file has no column called "${incoming}".`); continue; }
    const action = (d.action || 'ignore').toLowerCase();
    if (action === 'ignore') continue;

    // A blocked column stays blocked. This is re-checked here and not merely trusted from the report, because the
    // report came back through the client and a decision is the one place someone could try to reintroduce one.
    const m = matchHeader(incoming, accepted, opts.labels || {});
    if (m.how === 'blocked') { errors.push(`"${incoming}" cannot be imported: ${m.why}.`); continue; }

    if (action === 'map') {
      const field = d.field;
      if (!accepted.includes(field)) { errors.push(`"${incoming}" cannot be mapped to ${field} — your catalogue does not accept that column.`); continue; }
      if (BLOCKED[field]) { errors.push(`"${incoming}" cannot be mapped to ${field}: ${BLOCKED[field]}.`); continue; }
      if (claimed.has(field)) { errors.push(`Both "${claimed.get(field)}" and "${incoming}" were mapped to ${field}. Pick one.`); continue; }
      claimed.set(field, incoming);
      byHeader.set(incoming, { field, idx });
      continue;
    }

    if (action === 'create') {
      const key = d.field ? toFieldKey(d.field) : toFieldKey(incoming);
      if (!key) { errors.push(`"${incoming}" cannot become a column name — give it a name in letters.`); continue; }
      if (BLOCKED[key] || key === 'quantity') { errors.push(`"${incoming}" cannot become ${key}: ${BLOCKED[key] || 'quantity is set by the customer at order time'}.`); continue; }
      if (accepted.includes(key)) { errors.push(`Your catalogue already has a ${key} column — map "${incoming}" to it instead of creating it again.`); continue; }
      if (claimed.has(key)) { errors.push(`Both "${claimed.get(key)}" and "${incoming}" would create ${key}. Pick one.`); continue; }
      claimed.set(key, incoming);
      byHeader.set(incoming, { field: key, idx });
      // Created OPTIONAL, always. A new required field would retroactively invalidate every product already stored.
      newFields.push({ field_key: key, field_name: String(incoming).trim().slice(0, 120),
        field_type: inferType(rows.map((r) => r[headers.indexOf(incoming)])), required: false });
      continue;
    }

    errors.push(`"${incoming}": ${action} is not something that can be done with a column.`);
  }

  // Build the items. A column with no decision is simply absent — never imported on the strength of a suggestion.
  const items = [];
  const lines = [];
  rows.forEach((r, n) => {
    const line = n + 2;
    const it = {};
    for (const [, { field, idx }] of byHeader) {
      const raw = r[idx];
      if (raw === undefined || String(raw).trim() === '') continue;
      const numeric = NUMERIC_FIELDS.includes(field) || (newFields.find((f) => f.field_key === field) || {}).field_type === 'number';
      if (numeric) {
        const { value } = looseNumber(raw);
        if (value === null) continue;                        // already reported by preflight as an error
        it[field] = value;
      } else it[field] = String(raw).trim();
    }
    // A row needs SOMETHING to go on: a name (to create by) or a code (to find an existing product by).
    //
    // ⚠️ This used to demand a NAME, full stop — which quietly made partial updates impossible. A file of
    // `sku,price` (the most ordinary update there is: today's prices) was refused with "no row had a product name",
    // so the only way to change one number was to resend every column of every row. The route decides what a row
    // WITHOUT a name means: matched on code it is an update, unmatched it cannot be created and is reported.
    if (!String(it.name || '').trim() && !String(it.sku || '').trim()) return;
    items.push(it);
    lines.push(line);
  });

  return { items, lines, newFields, errors, mappedFields: [...claimed.keys()] };
}

module.exports = { preflight, matchHeader, normalise, similarity, looseNumber, applyDecisions, toFieldKey, inferType,
  SYNONYMS, BLOCKED, QUALIFIERS, FUZZY_ACCEPT, NUMERIC_FIELDS };
