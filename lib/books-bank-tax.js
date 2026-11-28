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
 * B5-03 on the server: a credit on a bank line that the pack says needs a TAX INVOICE (AU: more than A$82.50 incl. GST, GST Act s.29-80; business.gov.au wording, Athi 20 Nov) is claimed only when the person says they hold it
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
/**
 * the pack's tax-invoice answer for a gross in minor units, ON a day (the row in force that day, ACC-7: tax-packs.rowAsOf) or undated (the open row); null when the pack has no rule.
 * THE one place a caller turns a pack and a gross into "is a tax invoice needed" (the bank door above, and the Day book's "No tax invoice" flag in lib/books-evidence.js): the threshold is the pack's data, never a number here.
 */
/** the country's official wording says "more than" the threshold, not "or more" (lib/tax-invoice-overrides.json, until an engines release carries it): the gross sits exactly ON the pack's threshold row */
const onExclusiveThreshold = (pack, row, grossMinor) => !!row && !!require('./tax-invoice-overrides.json')[String(pack.country || '').toUpperCase()] && grossMinor === row.from_minor;
function taxInvoiceOn(pack, grossMinor, ymd) {
  if (!pack || typeof pack.taxInvoice !== 'function') return null;
  const rows = pack.tax && pack.tax.taxInvoice && pack.tax.taxInvoice.rows;
  const row = Array.isArray(rows) ? (ymd ? require('./tax-packs').rowAsOf(rows, ymd) : rows[rows.length - 1]) : null;
  const dated = ymd && row ? { dated: true, row } : undefined;
  return pack.taxInvoice(onExclusiveThreshold(pack, row, grossMinor) ? grossMinor - 1 : grossMinor, dated);
}
/** the pack's own answer for this gross (never a number here); null when the pack has none */
function taxInvoiceRule(x, partsMinor) {
  const pack = require('./country').packFor(x.s && x.s.country);
  const cash = require('./books-cashflow');
  const gross = require('./money').sum(partsMinor.map((minor) => ({ amount: cash.fromMinor(minor, x.cur), currency: x.cur }))); /* the value type's own sum: one currency, a mismatch is refused */
  return taxInvoiceOn(pack, cash.toMinor(gross.amount, x.cur));
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
/** BB-P1-3: the body of a bank line paid to a NAMED supplier, ready for the expense's own builder: the supplier is asked for (an id) and taken off the body (the expense would post it on credit); a bill or a blocked-credit answer is refused */
function supplierPaid(body, ask) {
  const supplier = ask(body.supplier || body.party_id, 'Which supplier?');
  if (body.bill != null || body.blocked_credit || body.claim_credit != null) throw refuse('A bank line carries its own tax figure: send input_tax_minor without a bill or a blocked-credit answer.');
  return { supplier, body: Object.assign({}, body, { supplier: undefined, party_id: undefined, not_this_bill: undefined }) }; /* not_this_bill is read by the open-bill ask, not by the expense builder */
}
/** BB-P1-3: the event of a bank line paid to a NAMED supplier, from the expense's own builder (`buildExpense`, one calculation): the engine's `bank_expense_supplier`, ONE entry with the supplier on both the bill and the payment half */
async function bankExpenseSupplier(x, body, buildExpense, ask) {
  const named = supplierPaid(body, ask);
  const built = await buildExpense(x, named.body);
  const ev = Object.assign(built.ev, { type: 'bank_expense_supplier', supplier: named.supplier });
  const answer = await require('./bank-pay-needs').askIfSupplierBill(null, x.entity, { party: named.supplier, gross_minor: grossMinorOf(x, ev), currency: x.cur, not_this_bill: body.not_this_bill, preview: () => require('./books').previewEntry(null, x.entity, ev) }); /* BB-P1-3: the ONE ask, the same finder as POST /payments */
  if (answer.skipped.length) ev.narration = (ev.narration ? ev.narration + ' · ' : '') + 'Owner said: not the open bill ' + answer.skipped.join(', ');
  return { ev, meta: built.meta };
}
/** the line's gross in minor units, read from the BUILT event (the net the builder took plus the tax inside it): no second calculation */
function grossMinorOf(x, ev) {
  const cash = require('./books-cashflow');
  const tax = Object.keys(ev.input_tax || {}).reduce((sum, head) => sum + cash.toMinor(ev.input_tax[head], x.cur), 0);
  return cash.toMinor(ev.amount, x.cur) + tax;
}
/** a bank line's tax is its own: beside a bill, a supplier or a blocked-credit answer it is refused, never ignored */
function refuseBesideBill(body, kind) {
  const named = kind !== 'bank_expense_supplier' && (body.supplier || body.party_id); /* BB-P1-3: the bank line for a named supplier is its own kind; on a plain expense a supplier is a credit purchase */
  if (body.bill != null || named || body.blocked_credit || body.claim_credit != null)
    throw refuse('A bank line carries its own tax figure: send input_tax_minor without a bill, a supplier or a blocked-credit answer. To keep the supplier on a bank line, send kind bank_expense_supplier.');
}
/** a whole number of minor units above nothing */
const isWholeAbove0 = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** the pack's one tax head, refused in words when the country has none or no output ledger for it */
function outputHeadOf(pack) {
  if (pack.fallback || !Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) throw refuse("This shop's country has no single tax to collect on a bank line, so the tax is not posted. Nothing was posted.");
  const head = pack.taxHeads[0];
  if (!(pack.taxLedgers && pack.taxLedgers[head] && pack.taxLedgers[head].output)) throw refuse('This country gives no output tax ledger for a bank line. Nothing was posted.');
  return head;
}
/**
 * l16-bankmatch-fix (BNK-new-6): the MIRROR for money IN. A bank line coded to an income class carries its own OUTPUT tax: `amount` is the NET and `output_tax_minor` the tax collected INSIDE the bank
 * figure, both the Bank sheet's own split. The engine's other_income composes Dr where it came in (gross) · Cr the class (net) · Cr output tax. No tax invoice is asked (it is the shop that issues one),
 * but the shop must be REGISTERED (regular): an unregistered shop collects no tax. Refused in words, never guessed: not a whole positive number, no single tax head, no output ledger, tax above the net.
 */
async function withBankOutputTax(x, body, netMinor, event, meta) {
  const taxMinor = body.output_tax_minor;
  if (!isWholeAbove0(taxMinor)) throw badRequest('The tax inside the bank figure (output_tax_minor) must be a whole number of minor units above nothing.');
  const head = outputHeadOf(books.packOf(x.s));
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
/**
 * BB-04: a CARD SETTLEMENT that arrived net of the acquirer's fee, as ONE contra { from: 'card', to: 'bank', amount (what the bank got), fee, fee_tax_minor?, fee_currency? }. `fee` is the fee NET of its tax, in the shop's currency's
 * major units, and must be a whole number of minor units above nothing; `fee_tax_minor` is the tax INSIDE the fee (the Bank sheet's own split, checked by the one bankLineTax: single head, registered, tax invoice, tax within the fee);
 * `fee_currency` if sent must be the entry's. The engine's contra composes Dr to (net) · Dr bank charges (fee) · Dr input tax · Cr from (all of it). This door works out nothing. The gross card sales (amount + fee + tax) are the caller's figure.
 */
async function withContraFee(x, body, event, meta) {
  const feeAmount = body.fee;
  if (body.fee_currency !== undefined && body.fee_currency !== x.cur) throw badRequest('The fee (' + body.fee_currency + ') must be in the same currency as the entry (' + x.cur + ').');
  if (typeof feeAmount !== 'number' || !Number.isFinite(feeAmount)) throw badRequest('The card fee (fee) must be a number in the currency of the entry.');
  const feeMinor = periodLib.amountOf({ amount: feeAmount }, 'amount', x.cur, { ask: 'How much was the fee?' });
  if (!Number.isSafeInteger(feeMinor) || feeMinor <= 0) throw badRequest('The card fee (fee) must be an amount above nothing.');
  event.fee = periodLib.toRupees(feeMinor, x.cur);
  if (event.fee !== feeAmount) throw badRequest('The card fee (fee) has more decimals than ' + x.cur + ' has: send a whole number of its smallest unit.');
  if (body.fee_tax_minor === undefined) return;
  const bank = await bankLineTax(x, { input_tax_minor: body.fee_tax_minor, tax_invoice: body.tax_invoice }, feeMinor);
  event.fee_input_tax = bank.input_tax;
  Object.assign(meta, { credit: 'claimed', flag: bank.flag });
}
/** a card settlement's own keys: tax_invoice goes with fee_tax_minor, and its tax is fee_tax_minor only */
function refuseOfContraFee(body) {
  if (body.input_tax_minor !== undefined || body.output_tax_minor !== undefined) throw refuse('A card settlement carries its tax as fee_tax_minor only.');
  if (body.tax_invoice !== undefined && body.fee_tax_minor === undefined) throw refuse('tax_invoice goes with fee_tax_minor (the tax inside the fee); alone it is refused, not ignored.');
}
/** the card-fee keys (fee, fee_tax_minor, fee_currency) belong to a card settlement recorded as a contra, and to each other; true when the entry is such a settlement and its own keys were checked */
function refuseFeeKeys(body, kind) {
  const hasFee = ['fee', 'fee_tax_minor', 'fee_currency'].some((key) => body[key] !== undefined);
  if (hasFee && kind !== 'contra') throw refuse('fee, fee_tax_minor and fee_currency are only for a card settlement recorded as a contra; this entry reads no such figure, so it is refused, not ignored.');
  if (kind === 'contra' && body.fee === undefined && hasFee) throw refuse('fee_tax_minor and fee_currency go with fee (the card fee); alone they are refused, not ignored.');
  if (kind !== 'contra' || body.fee === undefined) return false;
  refuseOfContraFee(body);
  return true;
}
/** the bank line's keys belong to an expense and to each other: beside a bill, on another kind, or `tax_invoice` without a tax figure they are refused, never ignored */
function refuseBankKeysBeside(body, kind) {
  if (body.not_this_bill !== undefined && kind !== 'bank_expense_supplier') throw refuse('not_this_bill answers the open-bill question of a bank line paid to a named supplier; this entry reads no such key, so it is refused, not ignored.');
  if (refuseFeeKeys(body, kind)) return;
  refuseTaxKeysBeside(body, kind);
}
/** money in carries its tax as output_tax_minor alone: only for other income, and with no input tax key or tax_invoice beside it */
function refuseOutputKeys(kind, withInputKeys) {
  if (kind !== 'other_income') throw refuse('output_tax_minor is only for money in recorded from a bank line (other income); this entry reads no such figure, so it is refused, not ignored.');
  if (withInputKeys) throw refuse('output_tax_minor is the tax collected on money in: it takes no input_tax_minor and no tax_invoice.');
}
/** the tax keys of a bank line (input_tax_minor, output_tax_minor, tax_invoice) belong to an expense or to money in, and to each other */
function refuseTaxKeysBeside(body, kind) {
  const hasIn = body.input_tax_minor !== undefined,
    hasOut = body.output_tax_minor !== undefined,
    hasWord = body.tax_invoice !== undefined;
  if (!hasIn && !hasOut && !hasWord) return;
  if (hasOut) return refuseOutputKeys(kind, hasIn || hasWord);
  if (kind !== 'expense' && kind !== 'bank_expense_supplier') throw refuse('input_tax_minor and tax_invoice are only for an expense recorded from a bank line; this entry reads no such figure, so it is refused, not ignored.');
  if (!hasIn) throw refuse('tax_invoice goes with input_tax_minor (the bank line tax); alone it is refused, not ignored.');
  refuseBesideBill(body, kind);
}

module.exports = { bankExpenseSupplier, taxInvoiceOn, withContraFee, withBankTax, withBankOutputTax, refuseBankKeysBeside, requireRegistered };
