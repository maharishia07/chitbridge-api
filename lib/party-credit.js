'use strict';
/**
 * lib/party-credit.js — a credit limit typed in major units becomes minor units through the shop currency
 * OWNER     cb-crm
 * RISK      money
 * OWNS      a credit limit typed in major units -> minor units through the shop's OWN currency exponent (money.toMinor): KWD 3 places, JPY none, INR 2.
 *           A non-finite amount ("1e400") or an unknown currency is refused, never stored (reviews4 EL-crm-01 M2: it was a literal x100).
 * CALLED BY lib/party-fields.js creditLimitMinorOf
 * FLOW      value + currency -> money.toMinor -> a safe integer, or the refusal in words (400)
 * CARD      01-crm/parties
 */
function majorToMinor(value, currency, badRequest, words) {
  if (!currency) throw badRequest('We could not tell which currency this shop uses, so a limit in whole amounts cannot be stored. Send credit_limit_minor.');
  const minor = require('./money').toMinor(Number(value), currency);
  if (minor === null || !Number.isSafeInteger(minor)) throw badRequest(words);
  return minor;
}
module.exports = { majorToMinor };
