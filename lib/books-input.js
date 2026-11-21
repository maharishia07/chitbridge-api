'use strict';
/**
 * lib/books-input.js — H-h2-001/002: the ONE strict-input rules a typed books entry shares on every door (POST /entries, books-actions journal, the Day book events).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      openingRows (AS-F-07) · NARRATION_MAX (300) · narration(value) → the narration trimmed, refused in words when longer · minorOnly(value, field) → the value, refused when it is text (an amount is a JSON number of whole minor units)
 * CALLED BY routes/books.js POST /entries · lib/books-action.js journalBodyOf · lib/books-manual.js wholeMinor and narr
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * FLOW      a typed entry body ──▶ narration · client_ref · amounts checked → the value, or a 422 refusal in words, before any posting code runs
 * Standards: OpenAPI 3.0 / JSON Schema 2020-12 (type integer, maxLength) · OWASP API3/API4:2023 · ISO 4217 (amounts are minor units).
 * ⚠️ Law is not a switch: this refuses a malformed request, it never changes what a posting is.
 */
const NARRATION_MAX = 300;
const REF_MAX = 80; /* the width the books key a client_ref on: a longer one used to be cut to this, so two long refs collided into one entry */
const refuse = (words) => Object.assign(new Error(words), { code: 'BOOKS_REFUSED', refused: true, status: 422 });
/** a narration for the books: whatever was typed, trimmed; more than NARRATION_MAX characters is refused in words, never cut silently */
function narration(value) {
  if (value != null && typeof value !== 'string') throw refuse('The narration is sent as text, not as a ' + (Array.isArray(value) ? 'list' : typeof value) + '. Nothing was posted.');
  const text = value == null ? '' : value.trim();
  if (text.length > NARRATION_MAX) throw refuse('The narration is ' + text.length + ' characters; the most is ' + NARRATION_MAX + '. Shorten it. Nothing was posted.');
  return text;
}
/** a client_ref (the replay key): text no longer than REF_MAX, or null when none was sent; over the limit is refused in words, never cut (a cut made two long refs one) */
function clientRef(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw refuse('The client_ref is sent as text. Nothing was posted.');
  const text = String(value);
  if (text.length > REF_MAX) throw refuse('The client_ref is ' + text.length + ' characters; the most is ' + REF_MAX + '. Send a shorter one. Nothing was posted.');
  return text;
}
/** MONEY-01 A10: a yes/no the books act on (price_includes_tax, claim_credit): the ONE reader. true/false (or the words 'true'/'false') read as sent; blank/absent = undefined (the caller's own default); ANYTHING else is refused in words, never read as truthy ("false" used to book as yes) */
function flagOf(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === false) return value;
  const word = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (word === 'true') return true;
  if (word === 'false') return false;
  throw refuse('The ' + field + ' must be true or false. Nothing was posted.');
}
/** an amount in minor units arrives as a JSON number, never as text ("100"): refused in words */
function minorOnly(value, field) {
  if (value != null && typeof value !== 'number') throw refuse('The ' + field + ' is sent as a whole number of minor units (a JSON number), not as text. Nothing was posted.');
  if (value != null && !Number.isSafeInteger(value)) {
    /* MONEY-01 A24: a fraction is refused; ACC-276: a whole figure too big to hold exactly is not a "fraction", it says it is beyond what a ledger line holds */
    if (Number.isInteger(value)) throw refuse('The ' + field + ' ' + String(value).slice(0, 24) + ' is beyond what a ledger line holds. Nothing was posted: send a whole number of minor units.');
    throw refuse('The ' + field + ' is not a whole number of minor units (paise, cents): it is not rounded. Nothing was posted: send a whole number of minor units.');
  }
  return value;
}
/**
 * AS-F-07 (walk AS, 22 Nov 2026): the opening-balance door's rows — a fractional minor unit (100.5 paise) is refused in words, never rounded to 101, by the SAME reader the typed journal uses (minorOnly).
 * A whole figure, text that reads as a whole figure and an empty side pass as before (the door's other rules judge them); a numeric text with a fraction is judged as the number it reads as.
 */
function openingRows(rows) {
  (Array.isArray(rows) ? rows : []).forEach((row, index) =>
    ['dr_minor', 'cr_minor'].forEach((key) => {
      const value = row ? row[key] : undefined;
      const readsAsNumber = typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
      if (typeof value === 'number' || readsAsNumber) minorOnly(readsAsNumber ? Number(value) : value, 'row ' + (index + 1) + ' ' + (key === 'dr_minor' ? 'debit' : 'credit'));
    })
  );
}
/** an amount typed in MAJOR units (`amount`, a journal line's dr/cr) as a JSON number no finer than the currency's minor unit: text is refused (like the minor door) and 0.005 is refused, never rounded to 0.01 */
function majorOnly(value, field, currency, plain) {
  if (value == null || value === '') return value;
  if (typeof value !== 'number' && plain) throw Object.assign(new Error(plain), { code: 'BOOKS_BAD_REQUEST', status: 400 }); /* the payment door's plain question "How much?" (a 400), as before */
  if (typeof value !== 'number') throw refuse('The ' + field + ' is sent as a number, not as text. Nothing was posted.');
  const cash = require('./books-cashflow');
  if (Number.isFinite(value) && cash.fromMinor(cash.toMinor(value, currency), currency) !== value) throw refuse('The ' + field + ' ' + value + ' is finer than the smallest unit of ' + currency + '; it is not rounded. Nothing was posted: send a figure with no more decimals than the currency has.');
  return value;
}
/** a rate the owner may type: a finite non-negative JSON number written without an exponent, or decimal text such as "83.25" */
function isPlainRate(rate) {
  if (typeof rate === 'number') return Number.isFinite(rate) && rate >= 0 && rate < 1e21; /* the range rule of fx-rates (1e-6..1e6) refuses a tiny or huge figure in words */
  return typeof rate === 'string' && /^\d+(\.\d+)?$/.test(rate.trim());
}
/** a typed exchange rate (POST /fx-rates, the owner's own evidence): a JSON number or a plain decimal text ("83.25" — the web form sends text; no sign, comma or exponent), and dated no later than the shop's tomorrow (the same future rule as a typed journal): refused in words */
function typedRate(body, setting) {
  const rate = body && body.rate;
  if (rate != null && !isPlainRate(rate)) throw refuse('The rate must be a plain number such as 83.25 (no sign, letters or exponent). Nothing was saved.');
  refuseFutureRate(String((body && (body.date || body.rate_date)) || '').trim(), setting);
  return body;
}
/** a typed rate dated after the shop's tomorrow is refused in words (a day that is not a YYYY-MM-DD is the date reader's to refuse) */
function refuseFutureRate(date, setting) {
  const today = date ? require('./books-hooks').dayOf(require('./shop-clock').now(), setting) : null;
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > require('./books-engines').addDays(today, 1)) throw refuse('A rate cannot be dated in the future (' + date + '). Nothing was saved.');
}
/** the free journal's lines: each is an object, a null or non-object line is refused in words naming it (the one reader: books-manual.givenLines) */
function lineShape(list) {
  const bad = (Array.isArray(list) ? list : []).findIndex((item) => item === null || typeof item !== 'object' || Array.isArray(item));
  if (bad >= 0) throw refuse('Line ' + (bad + 1) + ' is not a journal line. Nothing was posted: send each line as { account, dr | cr }.');
}
/** GOR-12: a date the caller SENT as null or '' is a client slip, not 'today' (refused 400 DATE_INVALID by books-period.dateOf); only a date left out falls back (manual entries document 'default today') */
const sentEmpty = (body, field) => !!body && Object.prototype.hasOwnProperty.call(body, field) && (body[field] === null || body[field] === '');
module.exports = { sentEmpty, NARRATION_MAX, REF_MAX, clientRef, narration, flagOf, minorOnly, openingRows, majorOnly, typedRate, lineShape };
