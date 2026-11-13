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
function taxFactsOf(taxReg, number, flags) {
  const flagged = flags.gst_registration ? String(flags.gst_registration).toLowerCase() : null;
  const scheme = (taxReg && taxReg.scheme) || flagged;
  return {
    registered: taxReg && typeof taxReg.registered === 'boolean' ? taxReg.registered : number ? true : null,
    number,
    scheme: scheme && SCHEMES.indexOf(scheme) >= 0 ? scheme : number ? 'regular' : null
  };
}

module.exports = { SCHEMES, taxFactsOf };
