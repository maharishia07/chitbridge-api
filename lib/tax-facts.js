'use strict';
/**
 * tax-facts.js - the owner's registration ANSWER, read one way (moved out of country-setup.js, CMP-13, so lib/entity-header can use the same reader without loading the whole setup).
 * OWNS      SCHEMES (the registration schemes a shop can state) and taxFactsOf(taxReg, number, flags)
 * CALLED BY lib/country-setup.js (profile, save, registrationOf's callers) · lib/entity-header.js (the GST-registration trade check)
 * FLOW      entity_governance.tax_registration + the tax number + policy_flags -> { registered: true | false | null, number, scheme }
 * CARD      28-platform-and-operations/country-setup
 */
const SCHEMES = ['regular', 'composition'];

/** the tax facts as the step reads them: registered is true (a number, or the owner said so), false (ONLY the owner's explicit "not registered") or null (unknown, never assumed false) */
function taxFactsOf(taxReg, number, flags, numberRegisters) {
  const registers = numberRegisters !== false; /* A-F-14: an ABN is a business number, not a GST registration */
  const flagged = flags.gst_registration ? String(flags.gst_registration).toLowerCase() : null;
  const scheme = (taxReg && taxReg.scheme) || flagged;
  return {
    registered: taxReg && typeof taxReg.registered === 'boolean' ? taxReg.registered : number && registers ? true : null,
    number,
    scheme: scheme && SCHEMES.indexOf(scheme) >= 0 ? scheme : number && registers ? 'regular' : null
  };
}

/**
 * A-F-14 · numberRegisters(country) → does typing the shop's tax number MAKE it registered for the tax? A GSTIN or a TRN IS the registration; an
 * Australian ABN is the BUSINESS number — a shop under A$75,000 has one and charges no GST — so the number alone says nothing about registration.
 * Read from the pack's own tax-id word (the pack decides; no country is named here). A pack may also say `taxId.registers: false` itself.
 */
const BUSINESS_NUMBER_WORDS = ['ABN'];
function numberRegisters(country) {
  if (!country) return true;
  let pack = null;
  try {
    pack = require('./regulation').packFor(String(country).toUpperCase());
  } catch (_) {
    return true; /* no pack: the old reading (a number is a registration) stands */
  }
  if (!pack) return true;
  if (pack.taxId && pack.taxId.registers === false) return false;
  return BUSINESS_NUMBER_WORDS.indexOf(require('./profile').taxIdWordOf(pack)) < 0;
}

module.exports = { SCHEMES, taxFactsOf, numberRegisters };
