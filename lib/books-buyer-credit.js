'use strict';
// OWNS      what the books decide for a BUYER who may not claim the input tax (R1-01, DEC-267): the stance (claim · no credit · wait with the question), the bill's
//           "carries tax" test, the event without the credit, and the two facts postChit reads for it (the shop's registration answer, did the original bill take credit)
// CALLED BY lib/books-hooks.js (classify's purchase, expense and supplier-credit-note verdicts; readAndClassify for the facts)
// FLOW      readAndClassify → buyerFacts → classify (pure) → inputCreditStance → withoutInputCredit → the posting engine (input_credit:false, engines v1.97.0)
// CARD      14-accounting/books-buyer-credit
const MONEY = require('./money');
const Store = require('./books-store');
const cbLog = require('./logger');

const roundMoney = (value) => MONEY.round(Number(value) || 0);
/** an input-tax ledger role: the one the posting engine debits for a claimed purchase tax */
const isInputTaxRole = (role) => role === 'gst_paid' || /^input_/.test(String(role));

/**
 * ⭐ R1-01 (DEC-267): A BUYER WHO MAY NOT CLAIM THE TAX. What the shop's own registration says about the input tax on what it buys: 'regular' (or nothing read: the
 * migration is not run) = claim, as before · 'unregistered' / 'composition' = no credit, the tax is part of the cost · 'unknown' = nobody said, so a purchase that
 * CARRIES input tax waits with the question (never a "yes" nobody said; a purchase with no tax has nothing to claim and posts). input.buyerRegistration is
 * postChit's prefetch of country-setup.registrationOfShop (classify stays pure). → { wait } | { noCredit: true } | {}
 */
function inputCreditStance(input, country, ref, taxed) {
  const registration = input && input.buyerRegistration;
  if (!taxed || !registration || registration === 'regular') return {};
  if (registration !== 'unknown') return { noCredit: true };
  const asked = require('./country-setup').registrationAsk(country);
  return { wait: { kind: 'queue', code: asked.code, why: asked.question + ' Answer it in Settings → Country setup (yes with the number, or no); bill ' + ref + ' posts then.' } };
}
/** does the bill carry any tax at all (its by_rate total above its taxable)? the wait and the flag only matter when it does */
function carriesTax(byRate) {
  const taxable = roundMoney(byRate.rows.reduce((total, item) => total + item.taxable, 0));
  return roundMoney(byRate.total - taxable) > 0;
}
/** one posting event of a bill I bought, without the input credit: a purchase_bill / purchase_return carries input_credit:false (engines v1.97.0 folds the tax into the cost); an expense is handed the GROSS (the engine drops a tax line on the class's own ledger) */
function withoutInputCredit(event) {
  if (event.type === 'purchase_bill' || event.type === 'purchase_return') return Object.assign({}, event, { input_credit: false });
  if (event.type !== 'expense' || !event.input_tax) return event;
  const inputTax = Object.keys(event.input_tax).reduce((total, head) => total + (Number(event.input_tax[head]) || 0), 0);
  return Object.assign({}, event, { amount: roundMoney(event.amount + inputTax), input_tax: undefined });
}
/** the ready-to-post verdict of a bill I bought: its event, without the input credit when the stance says the buyer may not claim */
function postBill(stance, event) {
  return { kind: 'post', supplier_check: true, event: stance.noCredit ? withoutInputCredit(event) : event };
}
/**
 * did the posted bill (its entry, or its resale / asset / use parts: the given source refs) take NO input tax? true = the entries exist and none debited an
 * input-tax ledger (the buyer could not claim: a supplier return follows it); false = one did; null = no such entry (nothing to follow). Reads through the
 * store's own entryBySource + entryDebitsByRole (one home each), never a second SQL.
 */
async function tookNoCredit(db, entity, refs) {
  const entries = [];
  for (const ref of refs) {
    const found = await Store.entryBySource(db, entity, ref);
    if (found) entries.push(found);
  }
  if (!entries.length) return null;
  for (const posted of entries) {
    const debits = await Store.entryDebitsByRole(db, entity, posted.entry_id);
    if (debits.some((row) => isInputTaxRole(row.role))) return false;
  }
  return true;
}
/**
 * R1-01 (DEC-267): what classify needs to decide a BUYER's input credit, read only for an expense or a bill I received (the seller's hot path costs nothing more):
 * buyerRegistration = the shop's own registration answer (country-setup.registrationOfShop; null when it cannot be read = no change); originalTookNoCredit = for a
 * supplier credit note, whether the ORIGINAL bill's entry posted no input tax (a return follows the original, never today's registration).
 * withEntity is books-hooks' own one-shop-connection runner, handed in so this module never opens a second way to the database.
 */
async function buyerFacts(withEntity, entity, copy, business, entry, mine) {
  if (!(copy.purpose === 'expense' || (entry.invoice && !mine))) return {};
  const buyerRegistration = await require('./country-setup').registrationOfShop(entity).catch(cbLog.orElse('books-hooks buyerFacts: the registration read failed — the credit is as before', null));
  const against = copy.purpose === 'credit_note' && business.against && business.against.chit_id;
  if (!against) return { buyerRegistration };
  const refs = ['chit:' + against, 'chit:' + against + ':asset', 'chit:' + against + ':use'];
  const originalTookNoCredit = await withEntity(entity, (db) => tookNoCredit(db, entity, refs)).catch(cbLog.orElse('books-hooks buyerFacts: the original bill read failed — the return is as before', null));
  return { buyerRegistration, originalTookNoCredit };
}

module.exports = { inputCreditStance, carriesTax, withoutInputCredit, postBill, tookNoCredit, buyerFacts };
