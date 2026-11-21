/**
 * profile-payee.js — the payee bridge of the entity profile (a part of profile.js, split out to keep its size row)
 * OWNER     cb-people (the profile vault) with cb-counter (the payee shown at the till)
 * RISK      money (a payee address shown on a bill; a wrong one sends money to the wrong place)
 * OWNS      where a shop's declared payee addresses are KEPT (the mirrored UPI id on the identities row): upiOf · payeesOf · payWays over lib/jurisdiction
 * CALLED BY lib/profile.js (re-exports isUpiId · upiOf · payeesOf · payWays unchanged)
 * FLOW      identities.policy_flags ──▶ upiOf ──▶ payeesOf ──▶ jurisdiction.payWays
 * CARD      28-platform-and-operations/know-your-business
 */
'use strict';
const log = require('./logger');
const jurisdiction = require('./jurisdiction');

/**
 * ⭐ MOVED TO THE CAPABILITY (lib/jurisdiction.js). "Is this a payee address we may show" is a fact about a payment
 * scheme, not about a profile, and it is needed by products that will never open a vault.
 * ⚠️ Re-exported under the old name so nothing that imports it breaks.
 */
const isUpiId = jurisdiction.isPayeeHandle;
/** the mirrored copy on an identities row (policy_flags.profile_provenance.upi_id) → the id, or null */
function upiOf(policy_flags) {
  try {
    const v = policy_flags && policy_flags.profile_provenance && policy_flags.profile_provenance.upi_id && policy_flags.profile_provenance.upi_id.value;
    return isUpiId(v) ? String(v).trim() : null;
  } catch (e) {
    log.fellBack('profile upiOf: failed — answered with nothing', e);
    return null;
  }
}

/**
 * ⭐ THE BRIDGE BETWEEN A STORED PROFILE AND THE CAPABILITY. This is the ONE thing that genuinely belongs here: it
 * knows where a shop's declared payee addresses are KEPT (mirrored onto the identities row beside the vault). The
 * capability then decides what any of that means.
 * ⚠️ Today only UPI is mirrored, so this reads one key. A second scheme adds a line here and a row there — not a
 * rewrite of anything that calls payWays.
 */
function payeesOf(policy_flags) {
  return { upi: upiOf(policy_flags) };
}
/** ⚠️ kept under the old signature so existing callers do not change; the decision itself is the capability's */
function payWays({ country, policy_flags }) {
  return jurisdiction.payWays({ country, payees: payeesOf(policy_flags) });
}

module.exports = { isUpiId, upiOf, payeesOf, payWays };
