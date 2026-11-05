'use strict';
/**
 * lib/rate-door.js — WHO MAY SET A TAX RATE ON A PRODUCT, on every door (CAT-210, ruling 24 Oct 2026: a rate is a money
 * promise, owner or manager ONLY). One predicate, one sentence, one "did this write change the rate?" test.
 *
 * OWNS      setsRate(req) · RATE_ASK_OWNER · RATE_OWNER_ONLY (the code) · refusal(rows) (the 403 as problem() takes it) · rateChanged(next, stored) · rateNamed(item_data) · RATE_KEYS
 *           · defaultSlabChanged(nextHolder, storedHolder) (a category's rules.default_slab, CAT-211) · faceRateChanged(nextFace, storedFace) (face.tax.default_slab, CAT-211)
 * CALLED BY routes/till.js (POST /rate) · routes/products.js (PATCH /:id · POST /bulk-update · POST /:id/schedule · POST / · POST /bulk) ·
 *           routes/entities.js (GET /me/can-see-costs → may_set_rate) · routes/definitions.js (POST / · PUT /:id · DELETE /:id takeover) ·
 *           routes/catalogue-face.js (PUT /) · lib/products-contract.js and lib/catalogue-contract.js (words.rateOwnerOnly)
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


/** CAT-211: the two DEFAULT rates (a category's rules.default_slab, the shop's face.tax.default_slab) both live under this key; blank is "nobody said" */
const DEFAULT_SLAB_KEY = 'default_slab';
const slabValue = (holder) => {
  const value = holder && holder[DEFAULT_SLAB_KEY];
  return value === undefined || value === null || value === '' ? null : JSON.stringify(value);
};
/** does `next` (the rules or tax block that would be stored) differ from `stored` on default_slab? Dropping the key from a whole replace IS a change (it wipes the rate). */
const defaultSlabChanged = (next, stored) => slabValue(next) !== slabValue(stored);
/** the same for a whole catalogue face: only its tax block carries the shop default */
const faceRateChanged = (next, stored) => defaultSlabChanged(next && next.tax, stored && stored.tax);

/** the 403 as problem() takes it ({ code, detail, legacy }): one sentence, one code, may/why in the old body; `rows` only where a bulk names them. Never echoes the caller's value (Q19). */
const refusal = (rows) => ({
  code: RATE_OWNER_ONLY,
  detail: RATE_ASK_OWNER,
  legacy: Object.assign({ error: 'Forbidden', message: RATE_ASK_OWNER, may: false, why: RATE_ASK_OWNER }, rows ? { rows } : {})
});

module.exports = { setsRate, rateChanged, rateNamed, refusal, defaultSlabChanged, faceRateChanged, RATE_KEYS, DEFAULT_SLAB_KEY, RATE_ASK_OWNER, RATE_OWNER_ONLY };
