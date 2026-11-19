'use strict';
/**
 * lib/books-input.js — H-h2-001/002: the ONE strict-input rules a typed books entry shares on every door (POST /entries, books-actions journal, the Day book events).
 * OWNS      NARRATION_MAX (300) · narration(value) → the narration trimmed, refused in words when longer · minorOnly(value, field) → the value, refused when it is text (an amount is a JSON number of whole minor units)
 * CALLED BY routes/books.js POST /entries · lib/books-action.js journalBodyOf · lib/books-manual.js wholeMinor and narr
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Standards: OpenAPI 3.0 / JSON Schema 2020-12 (type integer, maxLength) · OWASP API3/API4:2023 · ISO 4217 (amounts are minor units).
 * ⚠️ Law is not a switch: this refuses a malformed request, it never changes what a posting is.
 */
const NARRATION_MAX = 300;
const refuse = (words) => Object.assign(new Error(words), { code: 'BOOKS_REFUSED', refused: true, status: 422 });
/** a narration for the books: whatever was typed, trimmed; more than NARRATION_MAX characters is refused in words, never cut silently */
function narration(value) {
  const text = value == null ? '' : String(value).trim();
  if (text.length > NARRATION_MAX) throw refuse('The narration is ' + text.length + ' characters; the most is ' + NARRATION_MAX + '. Shorten it. Nothing was posted.');
  return text;
}
/** an amount in minor units arrives as a JSON number, never as text ("100"): refused in words */
function minorOnly(value, field) {
  if (value != null && typeof value !== 'number') throw refuse('The ' + field + ' is sent as a whole number of minor units (a JSON number), not as text. Nothing was posted.');
  return value;
}
/** a typed exchange rate (POST /fx-rates, the owner's own evidence): a JSON number, and dated no later than the shop's tomorrow (the same future rule as a typed journal): refused in words */
function typedRate(body, setting) {
  if (body && body.rate != null && typeof body.rate !== 'number') throw refuse('The rate is sent as a number, not as text. Nothing was saved.');
  const date = String((body && (body.date || body.rate_date)) || '').trim();
  const today = date ? require('./books-hooks').dayOf(require('./shop-clock').now(), setting) : null;
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > require('./books-engines').addDays(today, 1)) throw refuse('A rate cannot be dated in the future (' + date + '). Nothing was saved.');
  return body;
}
module.exports = { NARRATION_MAX, narration, minorOnly, typedRate };
