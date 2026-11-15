// @stage tested
// @stage-note FIN-116: a bank line's own tax answer (the figure the Bank sheet already split), split out of lib/books-manual.js, behaviour unchanged.
'use strict';
/**
 * OWNS      a bank line's tax answer on a hand-keyed expense: the checks (single tax head, registered shop, tax invoice, tax within net) and the refusals beside a bill; it works out no tax.
 * CALLED BY lib/books-manual.js (BUILD.expense · eventOf)
 * FLOW      expense body with input_tax_minor ──▶ refuseBankKeysBeside ──▶ withBankTax ──▶ bankLineTax (pack head · registration · requireTaxInvoice) ──▶ the engine's input_tax
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const books = require('./books');
const periodLib = require('./books-period');

const ask = periodLib.ask;
const refuse = periodLib.refuse; /* the books' one refusal in words */
/**
 * ⭐ FIN-116 — A BANK LINE'S OWN TAX ANSWER. The Bank sheet posts a bank charge as an `expense` whose figure it has already split: `amount` (or `amount_minor`) is the NET and
 * `input_tax_minor` is the tax INSIDE the bank figure (a whole, positive number of minor units, a JSON number). ONE calculation: this door splits and works out nothing — the figure
 * is posted as sent, as the engine's `input_tax` on the pack's one tax head, and the engine's own `expense` composes Dr class (net) + Dr input tax · Cr what paid it (gross).
 * Refused in words, never guessed: a bill, a supplier or a blocked-credit answer beside it (that is the bill path's own tax), a figure that is not a positive whole number, a pack with
 * no single tax head, a shop not known to be registered for its tax, tax above the net. → { input_tax, flag }
 */
async function bankLineTax(x, body, netMinor) {
  const taxMinor = body.input_tax_minor;
  if (typeof taxMinor !== 'number' || !Number.isSafeInteger(taxMinor) || taxMinor <= 0) throw ask('The tax inside the bank figure (input_tax_minor) must be a whole number of minor units above nothing.');
  const pack = books.packOf(x.s);
  if (pack.fallback || !Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) throw refuse("This shop's country has no single tax to claim on a bank line, so the tax is not posted. Nothing was posted.");
  const inputLedger = pack.taxLedgers && pack.taxLedgers[pack.taxHeads[0]] && pack.taxLedgers[pack.taxHeads[0]].input;
  if (!inputLedger) throw refuse('This country gives no tax credit ledger to claim on a bank line (the tax is part of the cost): record the whole bank figure as the expense, with no tax. Nothing was posted.'); /* the engine's expense drops a tax line that lands on the class ledger itself: it would post short */
  await requireRegistered(x);
  if (taxMinor > netMinor) throw refuse('The tax (' + taxMinor + ') is more than the amount it is inside (' + netMinor + '), in minor units. Nothing was posted.');
  requireTaxInvoice(x, body, [netMinor, taxMinor]);
  return { input_tax: { [pack.taxHeads[0]]: periodLib.toRupees(taxMinor, x.cur) }, flag: 'The tax is the figure the bank line gave; the books post it as sent and work out nothing.' };
}
/**
 * B5-03 on the server: a credit on a bank line that the pack says needs a TAX INVOICE (AU: from A$82.50 incl. GST, GST Act s.29-80) is claimed only when the person says they hold it
 * (`tax_invoice: 'held'`). The threshold is the pack's own `taxInvoice(gross)` answer, never a number here. The paper itself is the person's word: nothing on the wire proves it. Below the
 * threshold the key may be left out; 'none' beside a tax figure contradicts it (no invoice, no credit: send the whole figure as the expense, without input_tax_minor).
 */
function requireTaxInvoice(x, body, partsMinor) {
  const word = body.tax_invoice;
  if (word !== undefined && word !== 'held' && word !== 'none') throw ask("tax_invoice is 'held' (you hold the tax invoice) or 'none'.");
  if (word === 'none') throw refuse('With no tax invoice there is no tax credit: record the whole bank figure as the expense, with no input_tax_minor. Nothing was posted.');
  const pack = require('./country').packFor(x.s && x.s.country);
  const cash = require('./books-cashflow');
  const gross = require('./money').sum(partsMinor.map((minor) => ({ amount: cash.fromMinor(minor, x.cur), currency: x.cur }))); /* the value type's own sum: one currency, a mismatch is refused */
  const rule = pack && typeof pack.taxInvoice === 'function' ? pack.taxInvoice(cash.toMinor(gross.amount, x.cur)) : null;
  if (rule && rule.required && word !== 'held')
    throw refuse("At this amount the tax credit needs the supplier's tax invoice. Say you hold it (tax_invoice: 'held'), or record the whole bank figure as the expense with no tax. Nothing was posted.");
}
/** the shop's registration, from the ONE reader (country-setup.registrationOfShop): composition and unregistered shops claim no credit; unknown stays unknown, never read as registered or as not */
async function requireRegistered(x) {
  const answer = await require('./country-setup').registrationOfShop(x.entity);
  if (answer === 'regular') return;
  const word = require('./tax-shelf').taxWordOf(x.s && x.s.country);
  if (answer === 'composition' || answer === 'unregistered') throw refuse('This shop is not registered to claim ' + word + ' credit, so the ' + word + ' on a bank line cannot be posted as credit. Nothing was posted.');
  throw refuse('Nobody has said whether this shop is registered for ' + word + '. Say so in Settings, Country setup, then record this again. Nothing was posted.');
}
/** a bank line's tax is its own: beside a bill, a supplier or a blocked-credit answer it is refused, never ignored */
function refuseBesideBill(body) {
  if (body.bill != null || body.supplier || body.party_id || body.blocked_credit || body.claim_credit != null)
    throw refuse('A bank line carries its own tax figure: send input_tax_minor without a bill, a supplier or a blocked-credit answer.');
}
/** a bank line's tax answer lands on the expense event: the figure as sent on the pack's head, the credit marked claimed */
async function withBankTax(x, body, netMinor, event, meta) {
  const bank = await bankLineTax(x, body, netMinor);
  event.input_tax = bank.input_tax;
  Object.assign(meta, { credit: 'claimed', flag: bank.flag });
}
/** the bank line's keys belong to an expense and to each other: beside a bill, on another kind, or `tax_invoice` without a tax figure they are refused, never ignored */
function refuseBankKeysBeside(body, kind) {
  const hasTax = body.input_tax_minor !== undefined, hasWord = body.tax_invoice !== undefined;
  if (!hasTax && !hasWord) return;
  if (kind !== 'expense') throw refuse('input_tax_minor and tax_invoice are only for an expense recorded from a bank line; this entry reads no such figure, so it is refused, not ignored.');
  if (!hasTax) throw refuse('tax_invoice goes with input_tax_minor (the bank line tax); alone it is refused, not ignored.');
  refuseBesideBill(body);
}

module.exports = { withBankTax, refuseBankKeysBeside };
