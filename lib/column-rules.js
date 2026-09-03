// @stage tested
// @stage-note Who may change a catalogue column, and when. Pure — no DB. The routes and the screen both read it.
'use strict';
/**
 * column-rules.js — flexible while the column is empty, tightened the moment somebody uses it.
 *
 * Athi, 2026-09-02: *"it should be very flexible initially, but once data loaded, the panel has to be tightened
 * what they can do, what they cannot."*
 *
 * ── ⭐⭐ THE RULE IS PER COLUMN, NOT PER CATALOGUE ───────────────────────────────────────────────────────────────
 * "Once data is loaded" is tempting to read as a property of the whole catalogue — 400 products, so lock the
 * screen. That would be wrong and it would feel wrong: a shop with 400 products may have added `grade` an hour
 * ago and used it nowhere, and that column is exactly as free to remove as it was on day one. Counting per
 * column is the difference between a rule that fits the work and one that freezes the screen the moment anything
 * exists.
 *
 * ── ⚠️ AND THE STARTING POINT WAS THE OPPOSITE OF FLEXIBLE ──────────────────────────────────────────────────────
 * `schema_fields` had no DELETE and no UPDATE anywhere in the codebase — columns were insert-only, for everyone,
 * for ever. The data was already safe; the entire cost fell on the person who adopted a set to get eight columns
 * and had the other three on every form permanently. The half that was missing was the flexibility, not the
 * guard.
 *
 * ── ⚠️ AN EMPTY VALUE IS NOT USE ────────────────────────────────────────────────────────────────────────────────
 * `''` and null mean the column exists on the row and says nothing, so removing it loses no fact. Only a value
 * somebody actually recorded counts. Same line `itemstatus.isOfferable` and `availability.countedZero` draw:
 * absent is not empty, and empty is not a number.
 *
 * ── ZERO DEPENDENCIES · TIER A ──────────────────────────────────────────────────────────────────────────────────
 */

/**
 * ⚠️⚠️ THE THREE COLUMNS A CATALOGUE CANNOT BE WITHOUT. `name`, `unit` and `price` are what every other surface
 * assumes exists — the cart, the storefront, the message matcher, the export template, the order line. Removing
 * one is not a catalogue decision, it is a decision to break every screen downstream, and NO usage count should
 * be able to authorise it. Refused even on a catalogue with nothing in it at all.
 */
const LOCKED = new Set(['name', 'unit', 'price']);

/**
 * ⭐⭐ THE COLUMNS THE SYSTEM KEEPS — Athi, 2026-09-02: *"we have discussed many flags, those things should be
 * part of the catalogue fields? aren't they."*
 *
 * ⚠️ HE IS RIGHT THAT THEY WERE MISSING, AND WRONG THAT THEY SHOULD BE ORDINARY COLUMNS — and both halves matter.
 * `status` and `avail` are written to `item_data` like any field, so a panel headed *"what every product
 * records"* that lists neither is lying by omission. That is the same failure as an incomplete legend: a reader
 * who finds nine of twelve explained concludes the other three are decorative, not that the list is short.
 *
 * ⚠️ BUT THEY CANNOT BE EDITABLE COLUMNS. `status` is an enum with a lifecycle — `isMatchable` and `isOfferable`
 * read it, the storefront hides on it, the message matcher resolves through it. `avail` is a record
 * `{qty, source, as_of}` whose freshness rules decide whether a number is an answer or a rumour. Let someone
 * retype `status` to text or reorder it into a free-form field and every one of those breaks quietly.
 *
 * ⭐ SO THEY ARE SHOWN, LOCKED, AND SAY WHERE THEY ARE SET. Visible because the product records them; locked
 * because their SHAPE is load-bearing; and pointing at their real control, because "you cannot change this here"
 * is only half an answer without "you change it there".
 */
const SYSTEM_FIELDS = [
  { field_key: 'status', field_name: 'Availability status', field_type: 'choice',
    managed_by: 'the ◍ Status control on a product',
    note: 'available · unavailable · redundant · retired. The storefront hides anything not available, and the '
        + 'message matcher still resolves an out-of-stock item so a request never silently loses the line.' },
  { field_key: 'avail', field_name: 'Quantity on hand', field_type: 'number',
    managed_by: 'Report it on a product, or a connector feed',
    note: 'A count with the date it was true. Absent is not zero — nobody has said, which is a different answer '
        + 'from an empty shelf.' },
  { field_key: 'categories', field_name: 'Categories', field_type: 'multichoice',
    managed_by: 'the Categories screen',
    note: 'A product cites categories by id and carries a copy of the name for counterparties who cannot resolve '
        + 'the id. Rename on the Categories screen and every product follows.' },
  /**
   * ⚠️⚠️ A SLAB IS CITED, NEVER TYPED. Athi, 2026-09-03: *"in india tax is not simple … define slab and attach the
   * slab to the product"*. If `tax_slab` were a declarable column somebody would eventually type "18%" into the
   * cell — a string where a definition_id belongs — and the product would resolve to no slab while LOOKING
   * answered. Same reasoning as `categories`: the id is the reference, and the screen that owns the shelf is the
   * only place it may be set.
   *
   * ⭐ `gst_rate` is DELIBERATELY NOT here. It is a real, importable column (csv-preflight already carries its
   * synonyms) and a merchant with a sheet of HSN codes and rates has answered honestly without a slab. It is also
   * the travelling copy a counterparty reads. Reserving it would refuse both.
   */
  { field_key: 'tax_slab', field_name: 'Tax slab', field_type: 'choice',
    managed_by: 'Pricing & tax on a product; the slabs themselves in Catalogue setup › Tax',
    note: 'A product cites ONE slab by id and carries a copy of its name and rate for counterparties who cannot '
        + 'resolve the id. Blank means inherit — first the product\'s category, then the catalogue default.' },
];

/**
 * why(field) → null when it may be removed, else the REASON it may not.
 *
 * ⚠️ A REASON, NEVER A BOOLEAN — the same contract as the step-flow guard. "Cannot remove" tells someone only
 * that the software disagrees with them; "12 products record a value in Grade" tells them what to do next, which
 * is either to clear it on those twelve or to keep the column. A refusal that cannot be acted on is a dead end
 * wearing a message.
 */
function why(field) {
  const f = field || {};
  const key = String(f.field_key || '');
  if (!key) return 'That column does not exist.';
  if (LOCKED.has(key)) {
    return `"${key}" is one of the three columns every catalogue keeps — the cart, the storefront and the export all read it.`;
  }
  if (f.required) {
    return `"${f.field_name || key}" is required by your catalogue definition. Make it optional first.`;
  }
  const n = Number(f.used_by || 0);
  if (n > 0) {
    return `${n} product${n === 1 ? '' : 's'} record a value in "${f.field_name || key}". `
         + 'Clear it on those first, or keep the column.';
  }
  return null;
}

/** The boolean, for a screen that only needs to enable a control. Always derived from why(), never re-decided. */
const removable = (field) => why(field) === null;

/**
 * ⭐ THE COLUMN'S OWN ATTRIBUTES — what a column IS, as opposed to where it sits (order) or whether it may go
 * (why). Athi, 2026-09-03 (observation 4): the Columns row carried three facts — name, unit of measure and
 * datatype — and the unit was smuggled inside the label ("Coverage (sq ft/L)") because schema_fields had nowhere
 * to put it. A counterparty importing that sheet got a column called "Coverage (sq ft/L)" and a number, with the
 * unit unreadable by anything but a person.
 *
 * `unit` is a UN/ECE Recommendation 20 code (KGM · LTR · MTK · H87 …) — the list GS1, Peppol and e-invoice
 * INV-01 already use — so it is machine-readable on the way out. `leg` / `via` are design intent: where a value
 * SHOULD come from (FIX-4, column-only; per-VALUE provenance stays with money.js). Adopted, not invented.
 */
const TYPES = new Set(['text', 'number', 'choice', 'date']);
const LEGS  = new Set(['system', 'customer', 'compute', 'cb']);
const VIAS  = new Set(['ERP', 'IoT', 'AI']);

/**
 * retypeWhy(field) → null when the DATATYPE may change, else the reason. Same shape as why(): a reason or nothing.
 *
 * ⚠️ TIGHTENS ON USE, LIKE REMOVAL. A type change on an empty column costs nothing; on a column with 40 values it
 * silently makes some of them wrong (text → number) or loses what a number meant (number → text). Renaming and a
 * unit are always free — they change no stored value.
 */
function retypeWhy(field) {
  const f = field || {};
  const key = String(f.field_key || '');
  if (!key) return 'That column does not exist.';
  if (LOCKED.has(key)) return `"${key}" keeps its type — the cart, the storefront and the export all read it as it is.`;
  const n = Number(f.used_by || 0);
  if (n > 0) return `${n} product${n === 1 ? '' : 's'} record a value in "${f.field_name || key}". Its type is fixed while they do.`;
  return null;
}
const retypable = (field) => retypeWhy(field) === null;

module.exports = { LOCKED, SYSTEM_FIELDS, why, removable, TYPES, LEGS, VIAS, retypeWhy, retypable };
