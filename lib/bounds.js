// @stage tested
// @stage-note Slice 0a of SHARED-CHECKS: no route adopts a fragment yet (slices 1 and on); proven by tests/bounds.test.cjs.
'use strict';
/**
 * lib/bounds.js — THE BOUNDS A FIELD OF A ROUTE'S SCHEMA CARRIES, WRITTEN ONCE (SHARED-CHECKS slice 0a, 2026-11-09).
 *
 * OWNS      the ajv schema fragments a route's OpenAPI body or query names for a quantity, a minor-unit amount, a day, a flag, a text, a page, a limit, a list and a word list
 * CALLED BY a route contract (lib/*-contract.js) when it adopts a bound; no route adopts one yet (slices 1 and on), middleware/validate.js is what reads the fragments
 * FLOW      contract writes B.qty({ column: 'quantity' }) → schemaValidate compiles it → a value past the bound answers 422 INVALID_INPUT, field named, WRONG_VALUE
 * CARD      api-surface/input-bounds
 *
 * ⚠️ ONE NUMBER PER COLUMN: a ceiling is read off lib/chit-ceiling.js COLUMNS (ceilingOf), never typed here. A column that is not in that table is a new row there plus the
 *    real-stack information_schema test (RAIL-205), not a constant in this file.
 * ⚠️ NO CROSS-FIELD RULE: qty x price, a scale that depends on a currency, a day that must not pass another day stay in the handler and the money engine (money.decimals).
 * ⚠️ A DAY IS ONE READER: the day format is registered in middleware/validate.js over isCalendarDay (date only) and isDay (date-time-day); the year floor here is a pattern, a
 *    "not in the future" rule needs today and is the handler's (a schema cannot read the clock).
 * ⚠️ A CAP IS A REFUSAL: maxLength and maxItems refuse; nothing here cuts a text short (CRM-232).
 */
const ceiling = require('./chit-ceiling');

/* every fragment carries x-bound so the shopkeeper sentences of middleware/validate.js apply to it and to no hand-written schema */
const TEXT_MAX = 200;
const PAGE_MAX = 10000;
const LIMIT_MAX = 200;
/* years 1900 to 2999: the year of a day a shop can mean (FIN-103, CMP-41, ACC-335 took year 0001 and 9999) */
const SANE_DAY = '^(19|2\\d)\\d{2}-';
/* a control character other than newline (0x0A) and tab (0x09), written as escapes so the source holds no raw control byte */
const NO_CONTROL = '^[^\\u0000-\\u0008\\u000B-\\u001F\\u007F]*$';
const NO_CONTROL_ANY = '^[^\\u0000-\\u001F\\u007F]*$';

/** the exclusive ceiling of a named chit column, or a plain error (a column nobody declared is a missing row in chit-ceiling, never a guess here) */
function limitOf(column) {
  if (!ceiling.COLUMNS[column]) throw new Error('bounds: no ceiling row for column ' + column + ' (add it to lib/chit-ceiling COLUMNS with its real-stack test)');
  return { precision: ceiling.COLUMNS[column].precision, scale: ceiling.COLUMNS[column].scale, below: ceiling.ceilingOf(column) };
}

/** B.qty({ column }) → a quantity above 0 and below its column's ceiling */
const quantity = ({ column }) => ({ 'x-bound': true, type: 'number', exclusiveMinimum: 0, exclusiveMaximum: limitOf(column).below });

/** B.minor({ column, signed }) → whole minor units (a fraction of a minor unit is refused), at least 0 unless a credit or refund is legitimate, below the column's ceiling in minor units */
function minor({ column, signed }) {
  const { scale, below } = limitOf(column);
  const top = below * 10 ** scale;
  return { 'x-bound': true, type: 'integer', multipleOf: 1, minimum: signed ? -top + 1 : 0, exclusiveMaximum: top };
}

/**
 * B.amount({ column, signed }) → a money figure in whole currency units (decimals allowed, as typed) from 0 up (or either side of 0 when signed: a cost that corrects an earlier one),
 * below the ceiling of the named chit column (a cost is bounded by the chit total's column: it cannot exceed what a chit can total). A boolean, a text and a figure past the ceiling (1e308, 2^53) are refused: money is a value type. The ceiling is the one chit-ceiling row, never typed here.
 */
function amount({ column, signed }) {
  const { below } = limitOf(column);
  return { 'x-bound': true, type: 'number', [signed ? 'exclusiveMinimum' : 'minimum']: signed ? -below : 0, exclusiveMaximum: below };
}

/** B.int32({ signed }) → a whole number a 4-byte integer column holds (minutes): a figure past it answered 500 from the database, now a refusal */
const int32 = (options) => ({ 'x-bound': true, type: 'integer', minimum: options && options.signed ? -2147483648 : 0, maximum: 2147483647 });

/** B.day({ dateTime }) → a real day (format calendar-day, or date-time-day when a time may follow) in years 1900 to 2999 */
const calendarDay = (options) => ({ 'x-bound': true, type: 'string', format: options && options.dateTime ? 'date-time-day' : 'calendar-day', pattern: SANE_DAY });

/** B.flag() → true or false exactly; in a query the url engine coerces, so a query flag is B.oneOf(['true', 'false']) */
const flag = () => ({ 'x-bound': true, type: 'boolean' });

/** B.text({ max, lines }) → a string no longer than max (default 200), with no control character; lines: true lets newline and tab through (narration, notes) */
const text = (options) => ({ 'x-bound': true, type: 'string', maxLength: (options && options.max) || TEXT_MAX, pattern: options && options.lines ? NO_CONTROL : NO_CONTROL_ANY });

/** B.page() → page number, at least 1 and at most 10000 */
const page = () => ({ 'x-bound': true, type: 'integer', minimum: 1, maximum: PAGE_MAX });

/** B.limit() → rows per page, at least 1 and at most 200 */
const limit = () => ({ 'x-bound': true, type: 'integer', minimum: 1, maximum: LIMIT_MAX });

/** B.list({ of, max }) → an array of at most max items, each as given */
const list = ({ of, max }) => ({ 'x-bound': true, type: 'array', maxItems: max, items: of });

/** B.oneOf(words) → one of the words, so a junk word is refused and never read as "all" */
const oneOf = (words) => ({ 'x-bound': true, type: 'string', enum: words.slice() });

module.exports = { qty: quantity, minor, amount, int32, day: calendarDay, flag, text, page, limit, list, oneOf, TEXT_MAX, PAGE_MAX, LIMIT_MAX };
