'use strict';
/**
 * lib/rate-door.js — WHO MAY SET A TAX RATE ON A PRODUCT, on every door (CAT-210, ruling 24 Oct 2026: a rate is a money
 * promise, owner or manager ONLY). One predicate, one sentence, one "did this write change the rate?" test.
 *
 * OWNS      setsRate(req) · RATE_ASK_OWNER · RATE_OWNER_ONLY (the code) · rateChanged(next, stored) · rateNamed(item_data) · RATE_KEYS
 * CALLED BY routes/till.js (POST /rate) · routes/products.js (PATCH /:id · POST /bulk-update · POST /:id/schedule · POST / · POST /bulk) ·
 *           routes/entities.js (GET /me/can-see-costs → may_set_rate)
 * FLOW      request → setsRate(req) → (editor only) rateChanged / rateNamed over the keys tax-slab.setOn writes → 403 in words, nothing written
 * CARD      storefront-and-catalogue/products-routes
 * ⚠️ The hat comes from the DB (middleware/auth), never from the token. A change means the value differs from the stored one: an editor that
 *    echoes the record back unchanged is not changing the rate; one that drops the keys from a whole-record replace IS (it would wipe the rate).
 */
const { isOwner } = require('./owner');
const taxSlab = require('./tax-slab');

const RATE_ASK_OWNER = 'Ask the owner or a manager to set the tax rate.';
const RATE_OWNER_ONLY = 'TILL_RATE_OWNER_ONLY';
/** the three keys tax-slab.setOn writes: the citation, its travelling name, its travelling rate (the engine's own names, never retyped here) */
const RATE_KEYS = [taxSlab.SLAB_KEY, taxSlab.SLAB_NAME_KEY, taxSlab.RATE_KEY];

/** the business itself, or a co-assist whose hat is manager (a key or a cashier is not) */
const setsRate = (req) => isOwner(req) || !!(req && req.identity && req.identity.hat === 'manager');
const valueOf = (holder, key) => (holder && holder[key] !== undefined && holder[key] !== null ? JSON.stringify(holder[key]) : null);
/** does `next` (the record that would be stored) differ from `stored` on any rate key? null and absent are the same "nobody said". */
const rateChanged = (next, stored) => RATE_KEYS.some((key) => valueOf(next, key) !== valueOf(stored, key));
/** does a body NAME a rate (a create or a parked change has no stored record to compare with)? */
const rateNamed = (item_data) => RATE_KEYS.some((key) => valueOf(item_data, key) !== null);

module.exports = { setsRate, rateChanged, rateNamed, RATE_KEYS, RATE_ASK_OWNER, RATE_OWNER_ONLY };
