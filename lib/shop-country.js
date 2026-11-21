/**
 * lib/shop-country.js — the ONE read of "which country does this shop's installation state" for the starter lists.
 * OWNER     cb-country
 * RISK      plain
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 * OWNS      shopCountryOf(entity_id) → 'AU' | 'AE' | 'IN' | '' (nobody stated one → the neutral list).
 * CALLED BY routes/products.js (/lists, /lists/adopt) and routes/till.js (catalogueStartPlan, via POST /catalogue).
 * FLOW      govresolve.resolveEntityGovernance → basics.country; a read that fails answers '' and is logged, never a 500.
 */
'use strict';

async function shopCountryOf(entity_id) {
  try {
    const gov = await require('./govresolve').resolveEntityGovernance(entity_id);
    return String((gov && gov.basics && gov.basics.country) || '');
  } catch (failure) {
    require('./logger').warn('shop-country: the shop country was unread — the neutral starter list is used', { why: String(failure && failure.message) });
    return '';
  }
}

module.exports = { shopCountryOf };
