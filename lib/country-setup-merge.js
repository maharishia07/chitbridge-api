/**
 * country-setup-merge.js — the tax answer of a country-setup save as a MERGE-PATCH (SET-86; a part of country-setup.js, split out to keep its size row).
 * OWNER     cb-settings (the setup answers) with cb-accounting (the registration the books read)
 * RISK      money (a registered shop taken off its tax invoices without tax)
 * OWNS      mergeTax_ (the tax answer the save stands on) · needsConfirm_ (the deregister confirm, 409 TAX_DEREGISTER_UNCONFIRMED) · untouchedHeld_ (the held registration when no tax key is sent)
 * CALLED BY lib/country-setup.js (intake_ · save), through boundTo({ refuse_, registeredOf, registrationOf }) so this file never requires its parent
 * FLOW      body.tax ──▶ mergeTax_ over the held answer ──▶ needsConfirm_ ──▶ the save writes it
 * CARD      20-settings-governance-and-plan/country-setup
 */
'use strict';
const { numberRegisters } = require('./tax-facts');

/* ── SET-86 · THE SAVE IS A MERGE-PATCH: an omitted key is unchanged, a null never clears a known answer (Athi: never default an unasked fact) ── */
const TAX_KEYS = ['registered', 'number', 'scheme'];
const DEREGISTER_UNCONFIRMED = 'TAX_DEREGISTER_UNCONFIRMED';
/** is the shop registered for its tax as the books read it now (regular or composition): the one reader, registrationOf, over what profile() holds */
function registeredNow_(deps, heldTax, country) {
  const held = heldTax || {};
  const answer = deps.registrationOf({ country, number: held.number, scheme: held.scheme, tax_registration: typeof held.registered === 'boolean' ? { registered: held.registered } : null });
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
/** the sent tax answer, or the refusal in words: an object of registered, number and scheme only (a key it does not have is refused by name) */
function checkedAnswer_(deps, sent) {
  if (sent === null || typeof sent !== 'object' || Array.isArray(sent)) throw deps.refuse_('COUNTRY_SETUP_BAD', 'The tax answer is { registered, number, scheme }.', 400);
  const stray = Object.keys(sent).filter((key) => TAX_KEYS.indexOf(key) < 0)[0];
  if (stray) throw deps.refuse_('COUNTRY_SETUP_BAD', "The tax answer takes registered, number and scheme, not '" + stray + "'.", 400);
  return sent;
}
/** an explicit "not registered": clears the scheme; the number goes too unless it is a business number (A-F-14: an ABN stays) */
function notRegistered_(deps, current, country) {
  const held = current.tax || {};
  return { tax: { registered: false, number: numberRegisters(country) ? null : held.number || null, scheme: null }, written: true, deregistered: registeredNow_(deps, current.tax, country) };
}
/**
 * mergeTax_(deps, current, body, country) → { tax, written } — the tax answer the save stands on. No `tax` key: nothing is written (written false). A
 * `tax` object merges over what the shop holds: registered absent/null keeps the answer (null is "not said", never "no"); number and scheme
 * absent keep. An explicit registered false is the owner's answer: it clears the number and the scheme, and over a registration it needs
 * `confirm_deregister: true` (save refuses 409 TAX_DEREGISTER_UNCONFIRMED when mergedTax.deregistered and it is absent) — the money promise is a deliberate confirm. A key the answer does not have is refused by name.
 */
function mergeTax_(deps, current, body, country) {
  if (!Object.prototype.hasOwnProperty.call(body, 'tax')) return { tax: untouchedTax_(current, country), written: false };
  const sent = checkedAnswer_(deps, body.tax);
  const said = deps.registeredOf(sent.registered);
  if (said === false) return notRegistered_(deps, current, country);
  const held = current.tax || {};
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
function needsConfirm_(deps, mergedTax, body, country) {
  if (mergedTax.deregistered && (body || {}).confirm_deregister !== true) throw deps.refuse_(DEREGISTER_UNCONFIRMED, deregisterWords_(country), 409);
}
/** the three functions the parent calls, with its refuse_ · registeredOf · registrationOf handed in once (deps) */
function boundTo(deps) {
  return {
    mergeTax_: (current, body, country) => mergeTax_(deps, current, body, country),
    needsConfirm_: (mergedTax, body, country) => needsConfirm_(deps, mergedTax, body, country),
    untouchedHeld_
  };
}

module.exports = { boundTo, mergeTax_, needsConfirm_, untouchedHeld_ };
