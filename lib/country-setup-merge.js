// lib/country-setup-merge.js — the tax answer of a country-setup save as a MERGE-PATCH (a part of lib/country-setup.js, split out to keep its size row)
// OWNS  SET-86: mergeTax_ (the tax answer the save stands on) · needsConfirm_ (the deregister confirm, 409 TAX_DEREGISTER_UNCONFIRMED) · untouchedHeld_ (the held registration when no tax key is sent)
// CALLED BY lib/country-setup.js (intake_ · save); it hands in refuse_ · registeredOf · registrationOf so this file never requires its parent
// FLOW  body.tax → mergeTax_ over the held answer → needsConfirm_ → the save writes it
// CARD 20-settings-governance-and-plan/country-setup
'use strict';
const { numberRegisters } = require('./tax-facts');

/** the parent's three readers handed in (refuse_ builds the refusal, registeredOf reads a yes/no, registrationOf is the ONE "is this shop registered" reader) → the merge functions */
module.exports = function countrySetupMerge({ refuse_, registeredOf, registrationOf }) {
  const TAX_KEYS = ['registered', 'number', 'scheme'];
  const DEREGISTER_UNCONFIRMED = 'TAX_DEREGISTER_UNCONFIRMED';
  /** is the shop registered for its tax as the books read it now (regular or composition): the one reader, registrationOf, over what profile() holds */
  function registeredNow_(heldTax, country) {
    const held = heldTax || {};
    const answer = registrationOf({ country, number: held.number, scheme: held.scheme, tax_registration: typeof held.registered === 'boolean' ? { registered: held.registered } : null });
    return answer === 'regular' || answer === 'composition';
  }
  /** the sentence for taking a registered shop off its tax: names the reach, and that an open till learns at its next refresh */
  function deregisterWords_(country) {
    return (
      'This takes the shop off ' + require('./tax-shelf').taxWordOf(country) + ': from now on every invoice carries no tax, and a till that is already open keeps the old answer until it next refreshes. ' +
      'Confirm to go ahead, or leave the tax answer as it is.'
    );
  }
  /** no tax key in the body: nothing is written, but a CORRECTED country (first setup) still validates the held answer against the new pack */
  function untouchedTax_(current, country) {
    return current.country.code && current.country.code !== country ? Object.assign({}, current.tax) : {};
  }
  /** the held registration as tax_registration keeps it, for a save that changes only the setup answers beside it */
  function untouchedHeld_(current) {
    const held = current.tax || {};
    return held.registered === null || held.registered === undefined ? {} : { registered: held.registered, number: held.number || null, scheme: held.scheme || null };
  }
  /** an omitted or null sent value keeps the held one (null is "not said"); a value sent replaces it */
  function heldIfNull_(sent, held) {
    return sent == null ? held : sent;
  }
  /** the held registered answer, undefined read as not said */
  function heldOrNull_(held) {
    return held === undefined ? null : held;
  }
  /**
   * mergeTax_(current, body, country) → { tax, written } — the tax answer the save stands on. No `tax` key: nothing is written (written false). A
   * `tax` object merges over what the shop holds: registered absent/null keeps the answer (null is "not said", never "no"); number and scheme
   * absent keep. An explicit registered false is the owner's answer: it clears the number and the scheme, and over a registration it needs
   * `confirm_deregister: true` (save refuses 409 TAX_DEREGISTER_UNCONFIRMED when mergedTax.deregistered and it is absent) — the money promise is a deliberate confirm. A key the answer does not have is refused by name.
   */
  function mergeTax_(current, body, country) {
    if (!Object.prototype.hasOwnProperty.call(body, 'tax')) return { tax: untouchedTax_(current, country), written: false };
    const sent = body.tax;
    if (sent === null || typeof sent !== 'object' || Array.isArray(sent)) throw refuse_('COUNTRY_SETUP_BAD', 'The tax answer is { registered, number, scheme }.', 400);
    const stray = Object.keys(sent).filter((key) => TAX_KEYS.indexOf(key) < 0)[0];
    if (stray) throw refuse_('COUNTRY_SETUP_BAD', "The tax answer takes registered, number and scheme, not '" + stray + "'.", 400);
    const said = registeredOf(sent.registered);
    const held = current.tax || {};
    /* A-F-14: "not registered" keeps an ABN (the business number); a GSTIN or TRN goes with the registration */
    if (said === false) return { tax: { registered: false, number: numberRegisters(country) ? null : held.number || null, scheme: null }, written: true, deregistered: registeredNow_(current.tax, country) };
    return {
      tax: {
        registered: said === null ? heldOrNull_(held.registered) : said,
        number: heldIfNull_(sent.number, held.number),
        scheme: heldIfNull_(sent.scheme, held.scheme)
      },
      written: true
    };
  }
  /** the owner's confirm for taking a registered shop off its tax (the money promise is deliberate): 409 TAX_DEREGISTER_UNCONFIRMED unless the body says confirm_deregister: true */
  function needsConfirm_(mergedTax, body, country) {
    if (mergedTax.deregistered && (body || {}).confirm_deregister !== true) throw refuse_(DEREGISTER_UNCONFIRMED, deregisterWords_(country), 409);
  }
  return { mergeTax_, needsConfirm_, untouchedHeld_ };
};
