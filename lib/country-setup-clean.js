/**
 * country-setup-clean.js — the field-by-field cleaners of a country-setup save, a part of country-setup.js (split out to keep its size row; no rule changed).
 * OWNER     cb-settings (the setup answers) with cb-accounting (the tax answer the books read)
 * RISK      money (a wrong registration or tax number reaches every invoice)
 * OWNS      cleanTax (+ cleanTaxNumber · refuseBadScheme · unknownBasisWords) · cleanSource · cleanTimezone · cleanCode · cleanMonth: what the owner sent → clean, or a 400 in words
 * CALLED BY lib/country-setup.js (clean), through boundTo({ refuse_, registeredOf, zoneOk }) so this file never requires its parent
 * FLOW      body ──▶ clean (country-setup.js) ──▶ these cleaners ──▶ intake_ ──▶ the save
 * CARD      20-settings-governance-and-plan/country-setup
 */
'use strict';
const regulation = require('./regulation');
const { numberRegisters, schemesOf } = require('./tax-facts');

/* the parent's three helpers, bound once by country-setup.js when it loads (the same pattern as country-setup-merge.js) */
let refuse_ = null; /* (code, message, status) → the 400 to throw */
let registeredOf = null; /* the owner's yes/no → true | false | null */
let zoneOk = null; /* an IANA zone name Intl knows */

/**
 * P1-7 CTRY-87: the sentence for a tax scheme the owner SENT that is not one we offer (e.g. "cash"): refused, never stored as "regular". The words come from the
 * country's pack — its tax word (GST · VAT) and its return's short name (BAS) — so no country is named here. The return is read on the non-cash (accrual) basis:
 * the books post at the invoice date. A per-shop basis is held until the shop's accountant names it (CTRY-87 c).
 */
function unknownBasisWords(country) {
  const pack = regulation.packFor(country);
  const taxWord = (pack && pack.tax && pack.tax.scheme) || 'Tax';
  const form = (pack && pack.returns && pack.returns.short) || 'return';
  return taxWord + ' basis is not set here yet; the ' + form + ' is read on the non-cash (accrual) basis.';
}
/** the tax answer the owner sent → { registered, number, scheme, registered_on? } clean, or a 400 in words (the number is checked by the pack's own rule) */
function cleanTax(country, taxSent) {
  const taxFields = taxSent && typeof taxSent === 'object' ? taxSent : {};
  const registered = registeredOf(taxFields.registered);
  const number = cleanTaxNumber(country, taxFields, registered);
  /* XC-1119: the pack's own word for its tax (VAT) is the registered scheme */
  const scheme = require('./no-pack-words').schemeOf(country, registered === true ? String(taxFields.scheme || 'regular').trim().toLowerCase() : null);
  refuseBadScheme(country, registered, scheme);
  const day = registered === true && taxFields.registered_on ? { registered_on: String(taxFields.registered_on) } : {}; /* SET-87: checked in mergeTax_ (a real day, not in the future); only a registered shop keeps one */
  return Object.assign({ registered, number, scheme }, day);
}
/** a number with no yes/no beside it, or a yes with no number: refused in words, so nothing the owner typed is silently lost and nothing is registered on a guess */
function refuseUnpairedNumber(taxFields, registered, number) {
  /* TAX01-11: a number SENT with no answer to "registered?" was dropped to null and the save said 200: refused instead, so nothing the owner typed is silently lost */
  if (registered === null && String(taxFields.number == null ? '' : taxFields.number).trim()) throw refuse_('COUNTRY_SETUP_BAD', 'Say whether the business is registered for tax, then the number can be saved.', 400);
  if (registered === true && !number) throw refuse_('COUNTRY_SETUP_BAD', 'Registered for tax: type the registration number, or say not registered.', 400);
}
/** the tax number as the pack writes it: typed only when registered (or when the pack's number is not a registration), checked by the pack's rule, '' when none */
function cleanTaxNumber(country, taxFields, registered) {
  const typed = registered === true || (registered === false && !numberRegisters(country));
  const number = typed ? String(taxFields.number || '').trim().toUpperCase() : '';
  refuseUnpairedNumber(taxFields, registered, number);
  /* ⭐ T2-POLICY (SET4): THE tax-number check — profile.taxIdRefusal, from the pack taxIdWordOf names (a GSTIN by its checksum, an ABN or
     TRN by the pack's validator, any number ≤ 40). The same check the profile's own save makes, so the column has one rule. */
  const idBad = registered === false ? null : require('./profile').taxIdRefusal(country, number); /* a kept business number was checked when it was typed */
  if (idBad) throw refuse_('COUNTRY_SETUP_BAD', idBad.why, 400);
  return number ? require('./profile').taxIdNormal(country, number) : number; /* AE-F-02: spaces and dashes out, as the pack writes it */
}
/** a registered shop's scheme must be one the country's PACK offers (TAX01-3: India regular or composition; AU and AE regular only); a pack with one scheme says its own basis word */
function refuseBadScheme(country, registered, scheme) {
  const offered = schemesOf(country);
  if (registered !== true || offered.indexOf(scheme) >= 0) return;
  throw refuse_('COUNTRY_SETUP_BAD', offered.length > 1 ? require('./tax-shelf').taxWordOf(country) + ' registration: ' + offered.join(' or ') + '.' : unknownBasisWords(country), 400);
}
/** the owner's words for where each answer came from: only the known fields, each cut to 60 characters */
function cleanSource(sent) {
  const sourceOut = {};
  const sourceIn = sent && typeof sent === 'object' ? sent : {};
  for (const k of ['country', 'currency', 'fy_start_month', 'tax', 'timezone']) if (sourceIn[k] != null) sourceOut[k] = String(sourceIn[k]).slice(0, 60);
  return sourceOut;
}
/** the zone the owner picked (a multi-zone country) — an IANA name Intl knows, or nothing (the pack's one zone is set without asking) */
function cleanTimezone(sent) {
  const timezone = String(sent || '').trim();
  if (timezone && !zoneOk(timezone))
    throw refuse_('COUNTRY_SETUP_BAD', 'That time zone is not one the system knows (an IANA name, like Australia/Sydney).', 400);
  return timezone;
}
/** a country or money code as the owner typed it: trimmed, upper-cased, and a 400 in words when it is not the shape */
function cleanCode(sent, shape, refusal) {
  const code = String(sent || '').trim().toUpperCase();
  if (!shape.test(code)) throw refuse_('COUNTRY_SETUP_BAD', refusal, 400);
  return code;
}
/** the month the financial year starts, 1 to 12, or a 400 in words */
function cleanMonth(sent) {
  const month = Number(sent);
  if (!(Number.isInteger(month) && month >= 1 && month <= 12)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the month the financial year starts.', 400);
  return month;
}
/** bind the parent's helpers and hand back the cleaners the parent's clean() calls */
function boundTo(deps) {
  ({ refuse_, registeredOf, zoneOk } = deps);
  return { cleanTax, cleanSource, cleanTimezone, cleanCode, cleanMonth };
}

module.exports = { boundTo };
