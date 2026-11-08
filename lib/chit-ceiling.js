'use strict';
/**
 * lib/chit-ceiling.js — THE LARGEST NUMBER A CHIT CAN HOLD, from the columns that hold it (RAIL-205 · RAIL-191).
 *
 * OWNS      ceilingOf (the exclusive upper bound of one chit money column, 10^(precision - scale), read off the column's own declared type) · COLUMNS (the three the chit write
 *           lands in) · maxWords (the largest value, said in digits) · overOf (which field of a send's total and lines is past its column) · refusalFor (the 400 with the code and the
 *           sentence, thrown as data) · inCurrency · refuseLine (the same for one replacement line of an amend)
 * CALLED BY routes/chits.js sendCeiling (POST /send, before the write transaction) · lib/amend.js withinColumns (POST /:chit_id/amend and every caller of amend.prepare)
 * FLOW      the total send carries (summary.total_value) and each line's quantity and price → overOf → refusalFor → 400 CHIT_AMOUNT_TOO_LARGE, nothing written
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * ⚠️ SCOPE: ONLY SEND AND AMEND. Not behind this ceiling yet (RAIL-206): routes/connectors.js, routes/ctp.js, routes/catalogue.js offer chits, lib/capture.js, lib/autoraise.js, and the /reprice, /deliver-lines and /proposals doors.
 * ⚠️ NO MAGIC NUMBER. chit_detail.total_value is numeric(15,2) (a total must be below 10^13), chit_line.quantity numeric(18,3) (below 10^15), chit_line.price numeric(18,2) (below
 * 10^16). Writing past one answered 500 (22003 inside chit_deliver) after the whole send had been built. The precision and scale below are the column types, and
 * tests/rail-205-send-ceiling-truth.realstack.cjs reads information_schema and fails when they drift from the database.
 * ⚠️ NOT THE CATALOGUE'S CEILING. api #1051 caps a catalogue value at 1e12 in lib/catalogue-write: a price list's own business rule on catalogue_item_version numeric(18,2), a different column
 * and a different number. This one is the physical width of a chit, so it is the larger and the two do not share a constant.
 * ⚠️ MONEY IS A VALUE TYPE: the refusal carries the currency beside the maximum, never a bare number. The figure the person typed is never echoed back (Q19).
 */

/** the chit columns a send or an amend writes a number into: precision and scale exactly as the database declares them */
const COLUMNS = {
  total: { column: 'chit_detail.total_value', precision: 15, scale: 2, money: true, words: 'The chit total' },
  quantity: { column: 'chit_line.quantity', precision: 18, scale: 3, money: false, words: 'A line quantity' },
  price: { column: 'chit_line.price', precision: 18, scale: 2, money: true, words: 'A line price' }
};

/** the exclusive upper bound of a column: numeric(p, s) holds values that round to less than 10^(p - s) */
const ceilingOf = (field) => 10 ** (COLUMNS[field].precision - COLUMNS[field].scale);

/** the largest value the column holds, in digits with thousands commas: 9,999,999,999,999.99 for numeric(15,2) */
function maxWords(field) {
  const { precision, scale } = COLUMNS[field];
  const whole = '9'.repeat(precision - scale).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return scale ? whole + '.' + '9'.repeat(scale) : whole;
}

/** true when a value would not fit: anything that is not a finite number is another check's to refuse, so it is not "over" here */
/** roundsToCeiling(size, field) → true when numeric(p, s) would round this size up to the ceiling (half a unit of the last place short of it: 9999999999999.996 is 1e13) */
const roundsToCeiling = (size, field) => size >= ceilingOf(field) - 0.5 / 10 ** COLUMNS[field].scale;

const isOver = (value, field) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && roundsToCeiling(Math.abs(Number(value)), field);

/**
 * overOf({ total, lines }) → { field, line } | null — the first figure that is past its column: the total, then each line's quantity and price.
 * `line` is the 1-based position of the line (absent for the total), so the sentence can say which one without echoing the value.
 */
function overOf({ total, lines }) {
  if (isOver(total, 'total')) return { field: 'total' };
  const rows = Array.isArray(lines) ? lines : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    for (const field of ['quantity', 'price']) if (isOver(row[field], field)) return { field, line: i + 1 };
  }
  return null;
}

/** the body of the 400: the code, the title, one plain sentence that names the maximum, and the currency beside it (the detail a screen or a client can read) */
function bodyFor(over, currency) {
  const spec = COLUMNS[over.field];
  const code = currency && spec.money ? String(currency) : null;
  const where = over.line ? ' on line ' + over.line : '';
  const max = maxWords(over.field) + (code ? ' ' + code : '');
  const message = spec.words + where + ' is too large: the most a chit can hold is ' + max + '. Nothing was saved — split it into smaller chits, or lower the amount.';
  return { error: 'Amount too large', code: 'CHIT_AMOUNT_TOO_LARGE', message, field: over.field, line: over.line, max: maxWords(over.field).replace(/,/g, ''), currency_code: code };
}

/** refusalFor(over, currency) → an Error that routes/chits.js faultOf answers as its own 400 body (the shape lib/cost-write throws): refused, status 400, body */
const refusalFor = (over, currency) => Object.assign(new Error(bodyFor(over, currency).message), { refused: true, status: 400, code: 'CHIT_AMOUNT_TOO_LARGE', body: bodyFor(over, currency) });

/** inCurrency(refusal, currency) → the same refusal with the chit's currency beside the maximum (the amend door learns it only after the line was refused) */
const inCurrency = (refusal, currency) => (refusal && refusal.code === 'CHIT_AMOUNT_TOO_LARGE' && refusal.body ? refusalFor({ field: refusal.body.field, line: refusal.body.line }, currency) : refusal);

/** refuseLine(line, currency) — throws when one replacement line's quantity or price is past its column (the amend door); returns nothing otherwise */
function refuseLine(line, currency) {
  const over = overOf({ lines: [line] });
  if (over) throw refusalFor({ field: over.field }, currency); /* an amend names the line by its own index, so the sentence does not */
}

module.exports = { COLUMNS, ceilingOf, maxWords, overOf, bodyFor, refusalFor, inCurrency, refuseLine };
