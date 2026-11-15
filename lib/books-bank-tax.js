// @stage tested
// @stage-note FIN-116: a bank line's own tax answer (the figure the Bank sheet already split), split out of lib/books-manual.js, behaviour unchanged.
'use strict';
/**
 * lib/books-bank-tax.js — a bank line's own tax answer on a hand-keyed expense
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      a bank line's tax answer on a hand-keyed expense: the checks (single tax head, registered shop, tax invoice, tax within net) and the refusals beside a bill; it works out no tax.
 * CALLED BY lib/books-manual.js (BUILD.expense · eventOf)
 * FLOW      expense body with input_tax_minor ──▶ refuseBankKeysBeside ──▶ withBankTax ──▶ bankLineTax (pack head · registration · requireTaxInvoice) ──▶ the engine's input_tax
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const books = require('./books');
const periodLib = require('./books-period');

const badRequest = periodLib.ask; /* the books' one input question */
const refuse = periodLib.refuse; /* the books' one refusal in words */
/**
 * ⭐ FIN-116 — A BANK LINE'S OWN TAX ANSWER. The Bank sheet posts a bank charge as an `expense` whose figure it has already split: `amount` (or `amount_minor`) is the NET and
 * `input_tax_minor` is the tax INSIDE the bank figure (a whole, positive number of minor units, a JSON number). ONE calculation: this door splits and works out nothing — the figure
 * is posted as sent, as the engine's `input_tax` on the pack's one tax head, and the engine's own `expense` composes Dr class (net) + Dr input tax · Cr what paid it (gross).
 * Refused in words, never guessed: a bill, a supplier or a blocked-credit answer beside it (that is the bill path's own tax), a figure that is not a positive whole number, a pack with
 * no single tax head, a shop not known to be registered for its tax, tax above the net. → { input_tax, flag }
 */
/** the tax figure as sent: a whole, positive number of minor units, a JSON number */
const wholeTaxOf = (body) => {
  const taxMinor = body.input_tax_minor;
  if (typeof taxMinor !== 'number' || !Number.isSafeInteger(taxMinor) || taxMinor <= 0) throw badRequest('The tax inside the bank figure (input_tax_minor) must be a whole number of minor units above nothing.');
  return taxMinor;
};
/** the pack's one tax head that has a credit ledger to claim on; anything else is refused in words */
function creditHeadOf(x) {
  const pack = books.packOf(x.s);
  if (pack.fallback || !Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) throw refuse("This shop's country has no single tax to claim on a bank line, so the tax is not posted. Nothing was posted.");
  const head = pack.taxHeads[0];
  const inputLedger = pack.taxLedgers && pack.taxLedgers[head] && pack.taxLedgers[head].input;
  if (!inputLedger) throw refuse('This country gives no tax credit ledger to claim on a bank line (the tax is part of the cost): record the whole bank figure as the expense, with no tax. Nothing was posted.'); /* the engine's expense drops a tax line that lands on the class ledger itself: it would post short */
  return head;
}
async function bankLineTax(x, body, netMinor) {
  const taxMinor = wholeTaxOf(body);
  const head = creditHeadOf(x);
  await requireRegistered(x);
  if (taxMinor > netMinor) throw refuse('The tax (' + taxMinor + ') is more than the amount it is inside (' + netMinor + '), in minor units. Nothing was posted.');
  requireTaxInvoice(x, body, [netMinor, taxMinor]);
  return { input_tax: { [head]: periodLib.toRupees(taxMinor, x.cur) }, flag: 'The tax is the figure the bank line gave; the books post it as sent and work out nothing.' };
}
/**
 * B5-03 on the server: a credit on a bank line that the pack says needs a TAX INVOICE (AU: from A$82.50 incl. GST, GST Act s.29-80) is claimed only when the person says they hold it
 * (`tax_invoice: 'held'`). The threshold is the pack's own `taxInvoice(gross)` answer, never a number here. The paper itself is the person's word: nothing on the wire proves it. Below the
 * threshold the key may be left out; 'none' beside a tax figure contradicts it (no invoice, no credit: send the whole figure as the expense, without input_tax_minor).
 */
/** the person's word on the paper: 'held', 'none' or left out; 'none' beside a tax figure is refused */
function taxInvoiceWord(body) {
  const word = body.tax_invoice;
  if (word !== undefined && word !== 'held' && word !== 'none') throw badRequest("tax_invoice is 'held' (you hold the tax invoice) or 'none'.");
  if (word === 'none') throw refuse('With no tax invoice there is no tax credit: record the whole bank figure as the expense, with no input_tax_minor. Nothing was posted.');
  return word;
}
/** the pack's own answer for this gross (never a number here); null when the pack has none */
function taxInvoiceRule(x, partsMinor) {
  const pack = require('./country').packFor(x.s && x.s.country);
  const cash = require('./books-cashflow');
  const gross = require('./money').sum(partsMinor.map((minor) => ({ amount: cash.fromMinor(minor, x.cur), currency: x.cur }))); /* the value type's own sum: one currency, a mismatch is refused */
  if (!pack || typeof pack.taxInvoice !== 'function') return null;
  return pack.taxInvoice(cash.toMinor(gross.amount, x.cur));
}
function requireTaxInvoice(x, body, partsMinor) {
  const word = taxInvoiceWord(body);
  const rule = taxInvoiceRule(x, partsMinor);
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
/**
 * l16-bankmatch-fix (BNK-new-6): the MIRROR for money IN. A bank line coded to an income class carries its own OUTPUT tax: `amount` is the NET and `output_tax_minor` the tax collected INSIDE the bank
 * figure, both the Bank sheet's own split. The engine's other_income composes Dr where it came in (gross) · Cr the class (net) · Cr output tax. No tax invoice is asked (it is the shop that issues one),
 * but the shop must be REGISTERED (regular): an unregistered shop collects no tax. Refused in words, never guessed: not a whole positive number, no single tax head, no output ledger, tax above the net.
 */
async function withBankOutputTax(x, body, netMinor, event, meta) {
  const taxMinor = body.output_tax_minor;
  if (typeof taxMinor !== 'number' || !Number.isSafeInteger(taxMinor) || taxMinor <= 0) throw badRequest('The tax inside the bank figure (output_tax_minor) must be a whole number of minor units above nothing.');
  const pack = books.packOf(x.s);
  if (pack.fallback || !Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) throw refuse("This shop's country has no single tax to collect on a bank line, so the tax is not posted. Nothing was posted.");
  const head = pack.taxHeads[0];
  if (!(pack.taxLedgers && pack.taxLedgers[head] && pack.taxLedgers[head].output)) throw refuse('This country gives no output tax ledger for a bank line. Nothing was posted.');
  await requireRegistered(x);
  if (taxMinor > netMinor) throw refuse('The tax (' + taxMinor + ') is more than the amount it is inside (' + netMinor + '), in minor units. Nothing was posted.');
  event.output_tax = { [head]: periodLib.toRupees(taxMinor, x.cur) };
  Object.assign(meta, { flag: 'The tax is the figure the bank line gave; the books post it as sent and work out nothing.' });
}
/** a bank line's tax answer lands on the expense event: the figure as sent on the pack's head, the credit marked claimed */
async function withBankTax(x, body, netMinor, event, meta) {
  const bank = await bankLineTax(x, body, netMinor);
  event.input_tax = bank.input_tax;
  Object.assign(meta, { credit: 'claimed', flag: bank.flag });
}
/** the bank line's keys belong to an expense and to each other: beside a bill, on another kind, or `tax_invoice` without a tax figure they are refused, never ignored */
function refuseBankKeysBeside(body, kind) {
  const hasIn = body.input_tax_minor !== undefined,
    hasOut = body.output_tax_minor !== undefined,
    hasWord = body.tax_invoice !== undefined;
  if (!hasIn && !hasOut && !hasWord) return;
  if (hasOut && kind !== 'other_income') throw refuse('output_tax_minor is only for money in recorded from a bank line (other income); this entry reads no such figure, so it is refused, not ignored.');
  if (hasOut && (hasIn || hasWord)) throw refuse('output_tax_minor is the tax collected on money in: it takes no input_tax_minor and no tax_invoice.');
  if (hasOut) return;
  if (kind !== 'expense') throw refuse('input_tax_minor and tax_invoice are only for an expense recorded from a bank line; this entry reads no such figure, so it is refused, not ignored.');
  if (!hasIn) throw refuse('tax_invoice goes with input_tax_minor (the bank line tax); alone it is refused, not ignored.');
  refuseBesideBill(body);
}

module.exports = { withBankTax, withBankOutputTax, refuseBankKeysBeside };
