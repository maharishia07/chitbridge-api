'use strict';
// OWNS      what the books decide for a BUYER who may not claim the input tax (R1-01 / ACC-355, DEC-267): the stance (claim · no credit · wait with the question) and the ONE gate
//           every door meets, which is the composing step of the one writer (lib/books composeEntry). Also: did the ORIGINAL bill take credit (a supplier return follows it).
// CALLED BY lib/books.js composeEntry (the gate: chit bills, chit expenses, bank line tax, manual bills, recurring entries: ONE place, no door copies it) · lib/books-hooks.js (a supplier credit note)
// FLOW      door → postEntry / previewEntry → composeEntry → gate (registration read, cached) → the engine's event with input_credit:false (engines v1.99.0) → the posting engine
// CARD      14-accounting/books-buyer-credit
// NOT GATED move-in (carries another system's balances), a reversal (it mirrors an entry), an event the caller already decided (an explicit input_credit boolean: a supplier return follows its original bill).
const Store = require('./books-store');
const cbLog = require('./logger');

/** an input-tax ledger role: the one the posting engine debits for a claimed purchase tax */
const isInputTaxRole = (role) => role === 'gst_paid' || /^input_/.test(String(role));
const GATED = new Set(['purchase_bill', 'purchase_return', 'expense', 'contra']);
const positive = (value) => Number(value) > 0;
/** does a tax object { head: amount } carry any tax at all? (text or blank counts nothing: fail closed to "no tax") */
const objectTaxed = (tax, heads) => !!tax && typeof tax === 'object' && (heads || Object.keys(tax)).some((head) => positive(tax[head]));

/**
 * does this event post INPUT tax? An expense with `input_tax`, a bill / supplier return whose rows carry a tax head, a card settlement with `fee_input_tax`.
 * Only these ask the question; an event with no tax has nothing to claim and posts (no flood of the queue). `heads` = the pack's tax heads.
 */
function carriesInputTax(event, heads) {
  if (!event || !GATED.has(event.type)) return false;
  if (event.type === 'expense') return objectTaxed(event.input_tax, heads);
  if (event.type === 'contra') return objectTaxed(event.fee_input_tax, heads);
  return (event.by_rate || []).some((row) => objectTaxed(row, heads));
}

/**
 * the stance from the shop's own registration answer: 'regular' (or nothing read: the migration is not run) = claim, as before · 'unregistered' / 'composition' = no credit,
 * the tax is part of the cost · 'unknown' = nobody said, so a purchase that CARRIES input tax waits with the question. → {} | { noCredit: true } | { wait: { code, why } }
 */
function stanceOf(registration, country, ref, taxed) {
  if (!taxed || !registration || registration === 'regular') return {};
  if (registration !== 'unknown') return { noCredit: true };
  const asked = require('./country-setup').registrationAsk(country);
  return { wait: { code: asked.code, why: asked.question + ' Answer it in Settings → Country setup (yes with the number, or no); ' + (ref ? 'bill ' + ref : 'this entry') + ' posts then.' } };
}

/**
 * ⭐ THE ONE GATE (composeEntry calls it for every event of every door). Returns the event to compose: the same one, or a copy with input_credit:false; throws the
 * wait as a refusal (code TAX_REGISTRATION_UNKNOWN) when the event carries input tax and nobody said whether the shop is registered. An event that already says
 * input_credit true/false is the caller's decision (a supplier return of a no-credit bill) and passes.
 */
async function gate(entity, country, pack, event) {
  const heads = pack && Array.isArray(pack.taxHeads) ? pack.taxHeads : null;
  if (!carriesInputTax(event, heads) || typeof event.input_credit === 'boolean') return event;
  const registration = await require('./country-setup').registrationOfShop(entity).catch(cbLog.orElse('books-buyer-credit gate: the registration read failed — the credit is as before', null));
  const stance = stanceOf(registration, country, event.ref, true);
  if (stance.wait) {
    const refusal = new Error(stance.wait.why);
    refusal.code = stance.wait.code;
    refusal.refused = true;
    throw refusal;
  }
  return stance.noCredit ? Object.assign({}, event, { input_credit: false }) : event;
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
 * a supplier credit note follows the ORIGINAL bill, never today's registration: the original took no credit → the return carries input_credit:false (the tax comes back with the cost);
 * the original claimed it → input_credit:true (the tax is reversed, whatever the shop says now); no such entry → the verdict as it was (the gate decides). withEntity = books-hooks' own runner.
 */
async function followOriginal(withEntity, entity, business, verdict) {
  const event = verdict && verdict.kind === 'post' && verdict.event;
  const against = business && business.against && business.against.chit_id;
  if (!event || event.type !== 'purchase_return' || !against) return verdict;
  const refs = ['chit:' + against, 'chit:' + against + ':asset', 'chit:' + against + ':use'];
  const noCredit = await withEntity(entity, (db) => tookNoCredit(db, entity, refs)).catch(cbLog.orElse('books-buyer-credit followOriginal: the original bill read failed — the return is as before', null));
  return noCredit === null ? verdict : Object.assign({}, verdict, { event: Object.assign({}, event, { input_credit: !noCredit }) });
}

module.exports = { carriesInputTax, stanceOf, gate, tookNoCredit, followOriginal };
