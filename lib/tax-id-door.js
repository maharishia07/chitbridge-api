'use strict';
/**
 * lib/tax-id-door.js — WHO MAY CHANGE THE SHOP'S TAX NUMBER (GSTIN / ABN / TRN), on every door (CTR-182, Athi P1 7 Nov 2026).
 * The tax number prints on every tax invoice a buyer claims against, so a person signed in under the owner (a clerk or any other
 * co-assist) never changes it: the OWNER or a MANAGER does (Athi, same door shape and sentence as a tax rate, CAT-210). A till or connector KEY keeps the right it always had (Athi, 19 Sep: "the till key
 * alone for the time being" — a key, not a person). One predicate, the one OWNER_ONLY refusal (lib/owner), one test of "did this change it?".
 *
 * OWNS      mayChangeTaxId(req) · taxIdDiffers(stored, sent) · gate(changesIt) (the route middleware) · refusal() (the 403 as problem() takes it) · TAX_ID_ASK_OWNER (the sentence)
 * CALLED BY routes/till.js (POST /shop) · routes/entities.js (PATCH /profile) · routes/governance.js (PUT /profile/vault) · routes/integrations.js (POST /profile)
 * FLOW      request → mayChangeTaxId(req) → (a person who is not the owner) the tax number is compared with the stored one → 403 in words, nothing written
 * CARD      storefront-and-catalogue/products-routes
 * ⚠️ The hat comes from rate-door (owner or hat manager). A request that leaves the number as it is changes nothing and is not refused.
 */
const { OWNER_ONLY } = require('./owner');
const { setsRate } = require('./rate-door'); /* the ONE definition of "owner or manager" (CAT-210) */
const { problem } = require('./problem');
const log = require('./logger');

const TAX_ID_ASK_OWNER = 'Ask the owner or a manager to change the shop’s tax number.';

/** the owner or a manager (rate-door.setsRate, the same test as a tax rate), or a till/connector key (a key is not a person); false for every other person under the owner */
const mayChangeTaxId = (req) => !!(req && (req.api_key || setsRate(req)));

/** is the number SENT a different one from the STORED one? (case and spaces ignored; a blank is nobody saying anything) */
const norm = (value) => String(value == null ? '' : value).trim().toUpperCase();
const taxIdDiffers = (stored, sent) => !!norm(sent) && norm(sent) !== norm(stored);

/** the 403 as problem() takes it: the one OWNER_ONLY code, may/why in the old body so a screen greys the action WITH the sentence */
const refusal = () => ({
  status: 403,
  code: OWNER_ONLY,
  detail: TAX_ID_ASK_OWNER,
  legacy: { error: 'Forbidden', code: OWNER_ONLY, may: false, why: TAX_ID_ASK_OWNER, message: TAX_ID_ASK_OWNER }
});

/**
 * gate(changesIt) — the route middleware: the owner and a key pass untouched; a person under the owner is asked `changesIt(req)` (async → true when the request
 * would CHANGE the tax number) and refused 403 before anything is written. FAILS CLOSED: if the question cannot be answered the person is refused, and it is logged.
 */
const gate = (changesIt) => async (req, res, next) => {
  if (mayChangeTaxId(req)) return next();
  let changes = true;
  try {
    changes = !!(await changesIt(req));
  } catch (e) {
    log.fellBack('tax-id-door: could not tell whether the request changes the tax number — refused as if it did', e);
  }
  return changes ? problem(req, res, refusal()) : next();
};

module.exports = { mayChangeTaxId, taxIdDiffers, gate, refusal, TAX_ID_ASK_OWNER };
