/**
 * books-manual-bill-tax.js — A TYPED BILL'S TAX, on the pack's own heads (split out of books-manual.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      taxedInvoice(x, bill, currency, opts) · billHeads(x, bill, currency) · billInputTax(x, heads)
 * CALLED BY lib/books-manual.js BUILD (expense bill · the difference of a credit or debit note)
 * FLOW      the typed lines → books-tax-lines invoiceFor (the engine, rated per line) → heads → the pack's own input_tax heads; a figure with no head to carry it waits in words
 * CARD      14-accounting/README
 */
'use strict';
const books = require('./books');
const periodLib = require('./books-period');

const { ask: inputQuestion, refuse } = periodLib; /* the books' one input question and one refusal in words (lib/books-period) */
/**
 * a typed bill's lines through the tax engine (tax-lines.invoiceFor) — THE one place a keyed-in bill is taxed; the expense's heads and the
 * debit note's rows both read it. → the engine's invoice. The tax word is the country's (tax-shelf.taxWordOf: GST, VAT …, else "tax").
 * ⚠️ Both states are needed: the tax engine says "nothing assumed" and returns no tax when it cannot tell CGST + SGST from IGST — so that is asked, not posted.
 * `o.taxed` false (every line at 0 %) asks for no tax number: a local supplier with none can still be noted.
 */
function taxedInvoice(x, bill, currency, opts) {
  const taxLines = require('./tax-lines');
  const taxWord = require('./tax-shelf').taxWordOf(x.s && x.s.country);
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) throw inputQuestion('Add the lines of ' + opts.what + '.');
  const numbers = taxNumbersOf(bill, opts, taxWord, x.s && x.s.country);
  /* CTRY-94: a typed bill is a local one — both parties are in the shop's country; the engines no longer read India when none is said */
  const shopCountry = (x.s && x.s.country) || null;
  const buyer = buyerOf(taxLines, numbers, shopCountry);
  const result = taxLines.invoiceFor(invoiceArgsOf(taxLines, { lines, bill, buyer, currency, opts, numbers, shopCountry }));
  if (result.unrated) throw inputQuestion('Every line of ' + opts.what + ' needs its ' + taxWord + ' rate.');
  return result.invoice;
}
/** what the tax engine is asked to build an invoice from: the lines, both parties, the money, the bill's own day, the purpose and its number */
function invoiceArgsOf(taxLines, given) {
  const { lines, bill, buyer, currency, opts, numbers, shopCountry } = given;
  return {
    lines,
    seller: taxLines.partyOf({ gstn: numbers.theirs || null, display_name: String(bill.supplier_name || 'Supplier'), country: shopCountry }),
    buyer,
    currency,
    priceIncludesTax: !!bill.price_includes_tax,
    at: bill.date || null,
    bill_day: taxLines.billDayOf({ billed_at: bill.date }, opts.purpose, null, null), /* CTRY-139: the supplier's bill date (a day already); a note is never banded: the ONE rule */
    purpose: opts.purpose,
    chit_id: bill.doc_no || null
  };
}
/** the shop as the buyer of a typed bill: its own tax number, the place of supply (the number's state, else the one typed) */
function buyerOf(taxLines, numbers, shopCountry) {
  return Object.assign(taxLines.partyOf({ gstn: numbers.mine || null, display_name: 'Shop', country: shopCountry }), { Pos: numbers.pos, State: taxLines.stateOfGstin(numbers.mine) || numbers.pos });
}
/** the two tax numbers and the place of supply a typed bill names — asked for only when the lines carry tax (opts.taxed) */
function taxNumbersOf(bill, opts, taxWord, country) {
  const theirs = String(bill.supplier_gstin || '').trim(),
    mine = String(bill.my_gstin || '').trim();
  if (opts.taxed && !theirs) {
    const missing = inputQuestion("The supplier's " + require('./tax-shelf').taxIdWordOf(country) + ' is needed to ' + opts.taxWhy + ' ' + taxWord + '. Type it in the box on the next screen.'); /* C-F-06: the pack's word for the number (ABN, not "GST number") */
    missing.needs = 'supplier_gstin'; /* the field the screen sends the person to */
    throw missing;
  }
  const pos = String(bill.place_of_supply || '').trim() || require('./tax-lines').stateOfGstin(mine);
  if (opts.taxed && !pos) throw inputQuestion('Your ' + taxWord + ' number (or the place of supply) is needed to split the ' + taxWord + '.');
  return { theirs, mine, pos };
}
/** the bill's tax lines → heads, never summed here */
function billHeads(x, bill, currency) {
  return require('./tax-lines').heads(taxedInvoice(x, bill, currency, { taxed: true, what: 'the bill', taxWhy: 'claim' }));
}
/**
 * the bill's tax → the engine's input_tax, on the pack's OWN heads. India's split rides cgst/sgst/igst/cess; a one-tax country (AU GST) rides tax-lines.heads `vat` (the invoice's TaxVal), which
 * is the pack's one head. A tax figure with no head to carry it waits in words, never posts at net (the same rule as the chit door, books-hooks strayTaxKey).
 */
function billInputTax(x, heads) {
  const tax = { cgst: heads.cgst, sgst: heads.sgst, igst: heads.igst, cess: heads.cess };
  if (!heads.vat) return tax;
  const pack = books.packOf(x.s);
  if (!Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) throw refuse("This bill's tax has no tax head in this country's books to post to, so it waits, and nothing was posted.");
  tax[pack.taxHeads[0]] = heads.vat;
  return tax;
}

module.exports = { taxedInvoice, billHeads, billInputTax };
