// @stage tested
// @stage-note CSV round-trip for a catalogue. Import already existed in the browser (_catfParseCSV); this adds the
// EXPORT half and makes both testable. No caller yet — the /api/products/export route lands with it.
'use strict';
/**
 * csv.js — a catalogue leaves the way it arrived.
 *
 * The Medusa mapper proved a merchant can arrive and leave. This is the same argument one notch down: a business
 * that has typed 400 products into ChitBridge should be able to get them back out, into the tool every business
 * already has — a spreadsheet. Import existed (`_catfParseCSV` in the browser); export did not, so the round trip
 * was one-way, which is a lock-in whether or not anyone intended it.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 * Same rule as order-input / form-handshake / money / gs1: liftable as a file.
 *
 * ── RFC 4180, and the three details everyone gets wrong ────────────────────────────────────────────────────────
 *   1. A field containing a comma, a quote or a newline must be quoted; quotes inside are DOUBLED, not escaped
 *      with a backslash. `He said "hi"` → `"He said ""hi"""`.
 *   2. CRLF is the spec's line ending and what Excel expects. Parsing accepts both.
 *   3. A field beginning `=`, `+`, `-` or `@` is executed as a FORMULA by Excel and Sheets. A product named
 *      `=cmd|...` in a catalogue someone else opens is a real attack, not a curiosity. Those are prefixed with a
 *      single quote on export — the standard mitigation, and invisible in the cell.
 *
 * ── MONEY GETS TWO COLUMNS ─────────────────────────────────────────────────────────────────────────────────────
 * A stamped price is `{ amount, currency }`. Flattening it to "890 INR" in one cell would make the amount
 * unusable for arithmetic, which is the entire reason someone opened a spreadsheet. So: `price` carries the
 * number and `price_currency` carries the code.
 *
 * `price_currency` is INFORMATIONAL ON IMPORT and the header says so. The server stamps the owning entity's
 * currency on write and refuses a different one — editing that column in Excel cannot change what a business is
 * priced in, and a file that pretended otherwise would be inviting someone to try.
 */

const MONEY_KEYS = ['price', 'price_min', 'price_max'];
const FORMULA_LEAD = /^[=+\-@\t\r]/;

const isMoney = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.amount === 'number' && typeof v.currency === 'string';

/** One field, escaped per RFC 4180 and de-fanged for spreadsheets. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Formula injection: a leading = + - @ makes Excel/Sheets EXECUTE the cell. Prefixing with an apostrophe is the
  // standard mitigation and does not show in the cell.
  //
  // BUT NOT FOR NUMBERS. The first version guarded on the leading character alone, so -50 exported as '-50 and
  // arrived in Excel as TEXT — breaking the arithmetic that splitting money into its own column exists to
  // preserve. A credit note, a negative adjustment, a below-zero delta: all silently unusable.
  // A plain number cannot be a formula, so it is never guarded; `-1+1` is not a plain number, so it still is.
  const plainNumber = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(s);
  if (!plainNumber && FORMULA_LEAD.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Which columns to emit, in order.
 *
 * Identity first (a person scanning the file wants to know WHAT before HOW MUCH), then money, then everything the
 * schema declares, then anything an item carries that the schema does not — because a column silently dropped on
 * export is data silently lost on the round trip.
 */
function columnsFor(items, schema) {
  const cols = ['sku', 'name', 'unit'];
  const push = (k) => { if (!cols.includes(k) && !k.startsWith('_')) cols.push(k); };

  for (const k of MONEY_KEYS) {
    if (items.some((i) => i && i[k] !== undefined)) { push(k); push(k + '_currency'); }
  }
  for (const k of Object.keys((schema && schema.properties) || {})) push(k);
  for (const it of items) for (const k of Object.keys(it || {})) push(k);
  return cols;
}

/** The value for one column of one item, money already split into amount + currency columns. */
function valueFor(item, col) {
  for (const k of MONEY_KEYS) {
    if (col === k)              return isMoney(item[k]) ? item[k].amount : (item[k] ?? '');
    if (col === k + '_currency') return isMoney(item[k]) ? item[k].currency : '';
  }
  return item[col];
}

/**
 * toCSV(items, { schema, header }) → an RFC 4180 document.
 *
 * `header:false` omits the header row — useful for appending, never for a file a person will open.
 */
function toCSV(items, opts = {}) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const cols = columnsFor(rows, opts.schema);
  const out = [];
  if (opts.header !== false) out.push(cols.map(cell).join(','));
  for (const it of rows) out.push(cols.map((c) => cell(valueFor(it, c))).join(','));
  return out.join('\r\n') + (out.length ? '\r\n' : '');
}

/**
 * parseCSV(text) → { headers, rows }. The inverse of toCSV for everything toCSV emits.
 *
 * A character-by-character parser rather than a split on commas, because a split cannot survive a quoted field
 * containing a comma or a newline — which is exactly what a product description contains.
 */
function parseCSV(text) {
  const s = String(text == null ? '' : text);
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }   // a doubled quote is a literal one
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);          // skip blank lines, keep genuinely empty cells
      row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows.shift().map((h) => String(h).trim());
  return {
    headers,
    rows: rows.map((r) => {
      const o = {};
      headers.forEach((h, n) => { if (h) o[h] = r[n] === undefined ? '' : r[n]; });
      return o;
    }),
  };
}

/**
 * toItems(parsed) → catalogue item_data objects, money recombined.
 *
 * Numbers are coerced ONLY where the value is unambiguously numeric — `"12A"` stays a string rather than becoming
 * 12. A price is left as a bare number for the server to stamp; the file's `price_currency` is NOT trusted, for
 * the reason in the header. The apostrophe added by export's formula guard is stripped back off.
 */
function toItems(parsed) {
  const rows = (parsed && parsed.rows) || [];
  return rows.map((r) => {
    const out = {};
    for (const [k, raw] of Object.entries(r)) {
      if (k.endsWith('_currency')) continue;                       // stamped by the server, never read from a file
      let v = typeof raw === 'string' ? raw.trim() : raw;
      if (typeof v === 'string' && v.startsWith("'") && FORMULA_LEAD.test(v.slice(1))) v = v.slice(1);
      if (v === '') continue;                                      // an empty cell is absence, not an empty string
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      out[k] = v;
    }
    return out;
  });
}

module.exports = { toCSV, parseCSV, toItems, cell, columnsFor, MONEY_KEYS };
