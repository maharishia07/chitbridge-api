// lib/shop-day-ahead.js — AT-F-04 (walk AT, 22 Nov): is a date a LATER DAY than the shop's today, by the shop's own zone
// OWNS     the one "not in the future" test for a date a person types (a request that "came in tomorrow" is refused; the shop's own today is not tomorrow)
// OWNER    cb-compliance
// CARD     21-compliance-attestation-and-trade/privacy
// RISK     personal-data
// CALLED BY lib/privacy.js logRequest
// FLOW     data rights · log a request
'use strict';

/**
 * shopDayAhead(facts, given, moment, country) → true when the day of `given` (a date or a timestamp; else `moment`, ms) is after the shop's today.
 * `facts` = privacy.shopFacts (the shop's country, one read already made by the register). The zone is the shop's country's, else the request's country; the day rule is books-hooks.dayOf, the clock is shop-clock.
 * The server's UTC day was used before: a request dated the shop's today read as "tomorrow" for 11 hours of every Sydney day. Asked only when the moment is past the server's clock.
 */
async function shopDayAhead(facts, given, moment, country) {
  const zone = (facts && facts.country) || country;
  const hooks = require('./books-hooks');
  return String(hooks.dayOf(given == null ? moment : given, zone)) > require('./shop-clock').today(zone);
}

module.exports = { shopDayAhead };
