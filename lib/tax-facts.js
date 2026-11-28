'use strict';
/**
 * tax-facts.js - the owner's registration ANSWER, read one way (moved out of country-setup.js, CMP-13, so lib/entity-header can use the same reader without loading the whole setup).
 * OWNS      SCHEMES (the registration schemes a shop can state) and taxFactsOf(taxReg, number, flags)
 * CALLED BY lib/country-setup.js (profile, save, registrationOf's callers) · lib/entity-header.js (the GST-registration trade check)
 * FLOW      entity_governance.tax_registration + the tax number + policy_flags -> { registered: true | false | null, number, scheme }
 * CARD      28-platform-and-operations/country-setup
 */
const SCHEMES = ['regular', 'composition'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** the tax facts as the step reads them: registered is true (a number, or the owner said so), false (ONLY the owner's explicit "not registered") or null (unknown, never assumed false) */
function taxFactsOf(taxReg, number, flags, numberRegisters) {
  const numberCounts = !!number && numberRegisters !== false; /* A-F-14: an ABN is a business number, not a GST registration */
  const held = flags && typeof flags === 'object' ? flags : {}; /* TAX01-14: no flags at all is no flag, not a throw */
  const flagged = held.gst_registration ? String(held.gst_registration).toLowerCase() : null;
  const scheme = (taxReg && taxReg.scheme) || flagged;
  /* TAX01-14: the flag 'unregistered' IS the owner's explicit no (country-setup.flagOf_ writes it only for one) — read as registrationOf reads it, so the two readers never disagree */
  if (String(scheme || '').toLowerCase() === 'unregistered') return { registered: false, number, scheme: null };
  return withRegisteredOn(taxReg, { registered: registeredOf(taxReg, numberCounts), number, scheme: schemeOf(scheme, numberCounts) });
}
/** SET-87: the day the registration began, kept only for a registered shop and only when the owner said it as a day */
function withRegisteredOn(taxReg, facts) {
  const day = String((taxReg && taxReg.registered_on) || '');
  return facts.registered === true && ISO_DAY.test(day) ? Object.assign(facts, { registered_on: day }) : facts;
}
/** the owner's explicit yes/no wins; else a number that counts says registered; else unknown (never assumed false) */
function registeredOf(taxReg, numberCounts) {
  if (taxReg && typeof taxReg.registered === 'boolean') return taxReg.registered;
  return numberCounts ? true : null;
}
/** a known scheme as given; else 'regular' under a number that counts; else unknown */
function schemeOf(scheme, numberCounts) {
  if (scheme && SCHEMES.indexOf(scheme) >= 0) return scheme;
  return numberCounts ? 'regular' : null;
}

/**
 * A-F-14 · numberRegisters(country) → does typing the shop's tax number MAKE it registered for the tax? A GSTIN or a TRN IS the registration; an
 * Australian ABN is the BUSINESS number — a shop under A$75,000 has one and charges no GST — so the number alone says nothing about registration.
 * Read from the pack's own `taxId.registers` (the pack decides; no country is named here; AU says false since engines v1.102.0).
 */
function numberRegisters(country) {
  if (!country) return true;
  let pack = null;
  try {
    pack = require('./regulation').packFor(String(country).toUpperCase());
  } catch (e) {
    require('./logger').fellBack('tax-facts: no pack for the country — a number is read as a registration', e, 'debug');
    return true; /* no pack: the old reading (a number is a registration) stands */
  }
  if (!pack) return true;
  if (pack.taxId && pack.taxId.registers === false) return false; /* engines v1.102.0: the AU pack says it itself */
  return true;
}

/**
 * TAX01-3 · schemesOf(country) → the registration schemes the country's PACK offers (tax.registrationForm.schemes: India regular · composition, AU and AE regular). No country is named
 * here. A country with no pack (or a pack that does not say) keeps the global list, as before: nothing is refused on a rule nobody wrote.
 */
function schemesOf(country) {
  let pack = null;
  try {
    pack = country ? require('./regulation').packFor(String(country).toUpperCase()) : null;
  } catch (e) {
    require('./logger').fellBack('tax-facts: no pack for the country — the global scheme list stands', e, 'debug');
  }
  const form = pack && pack.tax && pack.tax.registrationForm;
  return form && Array.isArray(form.schemes) && form.schemes.length ? form.schemes.slice() : SCHEMES;
}

module.exports = { SCHEMES, taxFactsOf, numberRegisters, schemesOf };
