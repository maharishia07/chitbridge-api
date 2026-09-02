// @stage tested
// @stage-note The user-facing projection of a catalogue row: answers out, records in. Pure — no I/O, no DB.
'use strict';
/**
 * sheet.js — a spreadsheet carries ANSWERS, not RECORDS.
 *
 * Athi, 2026-09-02: *"in your download file, you have given availability as a json data, flag, when and who etc,
 * in a csv file, json is too much for the user and he will not understand… for the user, availability yes or no
 * is only matter, internally we need to set when and who etc. next time if the upload comes with yes again, then
 * update the timestamp, that is how the system need to interpret."*
 *
 * ── ⚠️⚠️ WHAT THE EXPORT ACTUALLY DID ──────────────────────────────────────────────────────────────────────────
 * `csv.cell()` JSON-stringifies any object, and the export widens its columns from the rows themselves. So a
 * merchant who downloaded their catalogue got cells like
 *
 *     {"qty":12,"source":"manual","as_of":"2026-09-01T04:11:07.221Z"}
 *
 * next to their product names, plus a `categories` column of raw UUIDs. Nobody can edit that in Excel and nobody
 * should have to. The information is not wrong — it is simply not theirs to maintain.
 *
 * ── ⭐⭐ THE RULE, AND IT IS ALREADY IN THE CODEBASE ─────────────────────────────────────────────────────────────
 * **Flatten on the way out, stamp on the way in.** `money.js` has done exactly this since it was written: a price
 * is stored as `{amount, currency}` and exported as a plain number, with the currency in its own column, and the
 * currency is re-stamped from the entity on import — the merchant never types it and never sees the record.
 * Availability was simply never given the same treatment.
 *
 * So this file is not a new idea; it is the money rule, applied to everything else that is a record:
 *
 *   OUT   status  'available'                       → available: 'yes'
 *         avail   {qty, source, as_of}              → qty: 12          (the number alone)
 *         categories ['9c33…','7b21…']              → hidden; the NAMES already travel in their own key
 *   IN    available: 'yes'                          → status 'available', AND a fresh as_of stamp
 *         qty: 12                                   → avail {qty:12, source:'upload', as_of: now}
 *
 * ⚠️ "IF THE UPLOAD COMES WITH YES AGAIN, UPDATE THE TIMESTAMP." That is the whole reason a re-upload is not a
 * no-op. `yes` in a file uploaded today means *this is true today* — the value did not change but its AS-OF did,
 * and for availability the as-of IS most of the information. See availability.js: a count with no date is a
 * rumour. So an unchanged `yes` still re-stamps.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/**
 * ⚠️ RECORDS, NOT COLUMNS — never emitted into a sheet in their stored form. Each is either projected to a simple
 * answer (below) or omitted because the merchant already has a readable version of the same fact.
 */
const HIDDEN = {
  avail:          'a quantity record — projected to a plain number',
  status:         'a lifecycle enum — projected to yes/no',
  categories:     'category IDs; the readable names travel in category_names',
  commercials:    'an adopter\'s overlay — applied to the visible values, not shown beside them',
  synonyms:       'matcher hints, maintained by the system',
  source_ref:     'where a referenced line came from — the system\'s bookkeeping',
  order_input:    'the catalogue\'s declared mode; a per-row cell could contradict it',
  is_active:      'retiring a product is an action, not a spreadsheet edit',
  item_id:        'record id',
  entity_id:      'record id',
  schema_id:      'record id',
};

/** The plain columns the records above are projected onto. Order is the order they appear in a sheet. */
const PROJECTED = ['available', 'qty', 'qty_as_of', 'qty_source', 'categories'];

/**
 * ⚠️ Keys where a BLANK cell means "inherit the catalogue default", never "clear this". Read from defaults.js so
 * there is one list: a key that is defaultable there and not inheritable here would be silently cleared by an
 * upload, which is the failure this whole pairing exists to prevent.
 */
const INHERITABLE = new Set(require('./defaults').COLUMN_KEYS);

const YES = new Set(['yes', 'y', 'true', '1', 'in stock', 'instock', 'available', 'a']);
const NO  = new Set(['no', 'n', 'false', '0', 'out of stock', 'outofstock', 'unavailable', 'none']);

/** yes/no/'' — '' means the sheet said nothing, which is NOT the same as "no". */
function readYesNo(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (YES.has(s)) return 'yes';
  if (NO.has(s)) return 'no';
  return '';
}

/**
 * toSheet(item) → the row a person sees.
 *
 * ⚠️ It DROPS rather than mangles. A record with no simple projection does not belong in a spreadsheet at all;
 * emitting it as JSON so that "nothing is lost" loses the reader instead, which is the more expensive loss.
 */
function toSheet(item) {
  const it = (item && typeof item === 'object') ? item : {};
  const out = {};
  for (const [k, v] of Object.entries(it)) {
    if (Object.prototype.hasOwnProperty.call(HIDDEN, k)) continue;
    if (k === 'category_names') continue;          // emitted below, under the name a person expects
    out[k] = v;
  }
  /* ⭐ ONE COLUMN, TWO WORDS. `status` carries four states, and three of them mean "you cannot buy this" — so a
     merchant reading a sheet needs one answer, and the lifecycle stays where the ◍ Status control owns it. */
  if (it.status !== undefined && it.status !== null && String(it.status) !== '') {
    out.available = String(it.status) === 'available' ? 'yes' : 'no';
  }
  /**
   * ⭐⭐ SPLIT INTO FLAT COLUMNS, NEVER NESTED — Athi, 2026-09-02: *"otherwise split the field and provide as 3
   * fields but not as a json for sure."*
   *
   * And this is precisely what `money.js` has always done: a price is stored as `{amount, currency}` and leaves
   * as `price` + `price_currency`, two plain cells. Availability is the same shape of thing and got none of the
   * same treatment. So: the number a person maintains, and beside it the two facts the system recorded — each
   * its own column, each readable, none of them JSON.
   *
   * ⚠️ THE TWO STAMP COLUMNS ARE OUTPUT-ONLY. They come back on a re-upload and are IGNORED, because a merchant
   * cannot meaningfully assert when they knew something — the upload itself is the assertion, and its timestamp
   * is now. See fromSheet.
   */
  if (it.avail && typeof it.avail === 'object') {
    if (it.avail.qty !== undefined && it.avail.qty !== null) out.qty = it.avail.qty;
    if (it.avail.as_of) out.qty_as_of = String(it.avail.as_of).slice(0, 10);   // a date, not a machine timestamp
    if (it.avail.source) out.qty_source = it.avail.source;
  }
  /* Names, not ids — the readable half of the pair a product already carries. */
  const names = Array.isArray(it.category_names) ? it.category_names.filter(Boolean) : [];
  if (names.length) out.categories = names.join(', ');
  return out;
}

/**
 * fromSheet(row, { now, source }) → { item_data, stamped }
 *
 * The inverse: a person's answers become the system's records, with the bookkeeping filled in here rather than
 * asked for.
 *
 * ⚠️ AN ABSENT CELL SAYS NOTHING AND MUST CHANGE NOTHING. A merchant who deletes the `available` column, or
 * leaves it blank on the rows they did not touch, is not saying "unavailable" — same rule as
 * availability.countedZero and itemstatus: absent is not a value. Only a cell that actually says something is
 * acted on, or a partial-column upload silently retires half a catalogue.
 */
function fromSheet(row, opts) {
  const r = (row && typeof row === 'object') ? row : {};
  const o = opts || {};
  const now = o.now || new Date().toISOString();
  const src = o.source || 'upload';

  const item_data = {};
  const stamped = [];
  for (const [k, v] of Object.entries(r)) {
    if (PROJECTED.includes(k)) continue;
    if (Object.prototype.hasOwnProperty.call(HIDDEN, k)) continue;   // never settable from a sheet
    /**
     * ⚠️⚠️ A BLANK CELL IN A DEFAULTABLE COLUMN MEANS *INHERIT*, NOT *CLEAR* — and writing it would be the
     * quietest data loss in the product. A merchant who clears the `unit` column to tidy their sheet, or who
     * uploads a partial file with that column empty, is not saying "these products have no unit"; they are
     * saying nothing, and the catalogue default answers. Storing `unit: ''` would look like an override of
     * empty, so the row would stop following the catalogue for ever after — and the file that did it would look
     * completely reasonable.
     *
     * Same rule as `available` above and as availability.countedZero: absent is not a value. See defaults.js.
     */
    if (INHERITABLE.has(k) && (v === null || v === undefined || String(v).trim() === '')) continue;
    item_data[k] = v;
  }

  const yn = readYesNo(r.available);
  if (yn) {
    item_data.status = yn === 'yes' ? 'available' : 'unavailable';
    stamped.push('status');
  }

  /**
   * ⭐⭐ THE STAMP REFRESHES EVEN WHEN NOTHING CHANGED — Athi, 2026-09-02: *"availability and qty should be
   * stamped new even if the status or value didn't change."*
   *
   * ⚠️ AND THAT IS THE OPPOSITE OF WHAT money.stampPrice DOES, deliberately. A price carries `source`/`as_of`
   * that are PRESERVED when already present, because a price you were quoted last Tuesday is still a Tuesday
   * price no matter how often the row is rewritten. Availability is the other kind of fact: it decays. `yes` in
   * a file uploaded today asserts *this is true today*, and the assertion is the upload itself — so an identical
   * `yes, 12` is not a no-op, it is a fresh confirmation, and the as-of is the part that moved.
   *
   * ⚠️ SO THIS NEVER COMPARES TO THE PREVIOUS VALUE. There is deliberately no "did it change?" branch: adding one
   * would make a re-upload of unchanged stock leave a month-old date in place, which is the single most
   * misleading thing this record can say. See availability.js — a count without a date is a rumour.
   */
  const qtyRaw = r.qty;
  const hasQty = qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== '';
  if (hasQty || yn) {
    const n = hasQty ? Number(String(qtyRaw).replace(/,/g, '').trim()) : null;
    const rec = { source: src, as_of: now };
    if (hasQty && !Number.isNaN(n)) rec.qty = n;
    /* No number and only a yes/no: still worth the stamp — it records WHEN someone last said so. */
    if (rec.qty !== undefined || yn) { item_data.avail = rec; stamped.push('avail'); }
  }

  return { item_data, stamped };
}

/** Which sheet column is which, for a template or a preflight report. */
const COLUMN_HELP = {
  available: 'yes or no — whether customers can order it. The date and who said so are recorded for you.',
  qty:       'a plain number, or leave blank if you do not track stock. Blank means "not said", never zero.',
  qty_as_of: 'when that number was last confirmed. Recorded for you — editing it here does nothing.',
  qty_source: 'who or what said so. Recorded for you — editing it here does nothing.',
  categories: 'category names separated by commas, as they appear on the Categories screen.',
};

module.exports = { HIDDEN, PROJECTED, COLUMN_HELP, readYesNo, toSheet, fromSheet };
