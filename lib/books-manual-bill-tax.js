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
  /* CTRY-94: a typed bill is a local one — both parties are in the shop's country; the engines no longer read India when none is said */
  const shopCountry = (x.s && x.s.country) || null;
  const taxWord = require('./tax-shelf').taxWordOf(shopCountry);
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) throw inputQuestion('Add the lines of ' + opts.what + '.');
  const numbers = taxNumbersOf(bill, opts, taxWord, shopCountry);
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
/** the question asked when a taxed bill has no supplier tax number: the pack's word for the number, and the field the screen sends the person to */
function supplierNumberQuestion(opts, taxWord, country) {
  const missing = inputQuestion("The supplier's " + require('./tax-shelf').taxIdWordOf(country) + ' is needed to ' + opts.taxWhy + ' ' + taxWord + '. Type it in the box on the next screen.'); /* C-F-06: the pack's word for the number (ABN, not "GST number") */
  missing.needs = 'supplier_gstin';
  return missing;
}
/** the two tax numbers and the place of supply a typed bill names — asked for only when the lines carry tax (opts.taxed) */
function taxNumbersOf(bill, opts, taxWord, country) {
  const theirs = String(bill.supplier_gstin || '').trim(),
    mine = String(bill.my_gstin || '').trim();
  if (opts.taxed && !theirs) throw supplierNumberQuestion(opts, taxWord, country);
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

/**
 * AE-F-18 · the plain Pay-expense form's own tax answer: `tax_rate` (the percent INCLUDED in the amount typed, one of the pack's rates) with the supplier's tax number (`supplier_gstin`)
 * becomes a one-line typed bill, priced tax-inclusive, and goes down the SAME door as a typed bill (taxedInvoice → the tax engine → heads → input tax). Nothing is worked out here:
 * the rate is the person's pick from the pack's own list, the split is the engine's. A rate of 0 or none = the ordinary expense, no bill built. → the bill, or null.
 */
async function expenseBillOf(x, body, klass, date) {
  const rate = pickedRate(x, body, date);
  if (!rate) return null;
  const gross = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much was it?' }), x.cur);
  const shopNumber = await require('./country-setup').shopTaxNumber(x.entity);
  return { supplier_gstin: body.supplier_gstin, my_gstin: shopNumber, place_of_supply: shopNumber ? undefined : x.s && x.s.country, supplier_name: body.supplier_name, price_includes_tax: true, date, lines: [{ name: klass, qty: 1, unit_price: gross, gst_rate: rate }] };
}
/** the rate the person picked from the pack's list: null for none or 0 (the ordinary expense); a bad or foreign rate is refused in words */
function pickedRate(x, body, date) {
  const rate = body.tax_rate == null || body.tax_rate === '' ? null : Number(body.tax_rate);
  if (rate == null) return null;
  if (!Number.isFinite(rate) || rate < 0) throw refuse('The rate is a percentage from the list, for example 5.');
  if (rate === 0) return null;
  refuseForeignRate(x, rate, date);
  refuseBadSupplierNumber(x, body);
  return rate;
}
/** a rate that is not on the pack's list for that day is refused, naming the list */
function refuseForeignRate(x, rate, date) {
  const rates = packRatesOf(x, date);
  if (rates.indexOf(rate) < 0) throw refuse('That rate is not one of ' + require('./tax-shelf').taxWordOf(x.s && x.s.country) + "'s: " + rates.filter((r) => r > 0).join(', ') + '. Nothing was posted.');
}
/** IN-F-09: the supplier's number goes through the same check as a party's or the shop's (GSTIN: shape, state code, check character) — its first two digits are the state that decides CGST + SGST or IGST */
function refuseBadSupplierNumber(x, body) {
  const supplierNumber = String(body.supplier_gstin || '').trim();
  const refused = supplierNumber ? require('./profile').taxIdRefusal(x.s && x.s.country, supplierNumber) : null;
  if (refused) throw refuse("The supplier's number is not right: " + refused.why + ' Nothing was posted.');
}
/**
 * the country pack's own rate list (every rate the pack names, 0 included) for the shop's country. IN-F-09: where the pack DATES its menu (India: rate_menu) the list is the menu in force on `asOf` (the
 * bill's own day; none = the row still open), through tax-packs.menuAsOf — the one reader, the same list the till and the item sheet offer (IN-F-04); else the pack's flat list.
 */
function packRatesOf(x, asOf) {
  const pack = require('./country').packFor(x.s && x.s.country);
  const tax = pack && pack.tax;
  if (!tax) return [];
  const menu = Array.isArray(tax.rate_menu) && tax.rate_menu.length ? (asOf === undefined ? require('./tax-packs').menuAsOf(tax) : require('./tax-packs').menuAsOf(tax, asOf)) : null;
  const rates = menu && Array.isArray(menu.rates) ? menu.rates : Array.isArray(tax.rates) ? tax.rates : [];
  return rates.filter((r) => typeof r === 'number');
}
/** AE-F-18: the expense form's tax answer, in the pack's words, for a country whose tax is ONE head (VAT · GST): the rates the pack names above nothing, and the supplier's tax number; [] when the pack has none */
function expenseTaxFields(settings) {
  const pack = books.packOf(settings);
  const rates = packRatesOf({ s: settings }).filter((r) => r > 0);
  /* IN-F-09: a pack with several heads (India: CGST · SGST · IGST) asks the same two questions; the engine splits them by the two states (billInputTax carries every head) */
  if (pack.fallback || !Array.isArray(pack.taxHeads) || !pack.taxHeads.length || !rates.length) return [];
  const word = require('./tax-shelf').taxWordOf(settings && settings.country);
  const taxIdWord = require('./country').taxId(require('./country').packFor(settings.country)).word || 'tax number';
  return [
    { key: 'tax_rate', kind: 'choice', required: false, label: word + ' in the amount', options: [{ v: '0', l: 'No ' + word }].concat(rates.map((r) => ({ v: String(r), l: r + '% ' + word + ' included' }))) },
    { key: 'supplier_gstin', kind: 'text', required: false, label: "Supplier's " + taxIdWord + ' (for the ' + word + ')' }
  ];
}
/**
 * G-F-06 (walk G): a body that names a tax amount under a key no entry kind reads (vat_minor, vat, gst_minor, tax_minor …; the keys inside the event object escape the closed body list) lost its VAT
 * without a word and posted the whole amount as expense. The door's own tax answers are tax_rate (percent included, with the supplier's number), bill, input_tax_minor (a bank line), output_tax_minor,
 * tax_invoice; any other key that names a tax is refused in words, nothing posted.
 */
const OWN_TAX_KEYS = ['tax_rate', 'tax_invoice', 'input_tax_minor', 'output_tax_minor', 'fee_tax_minor', 'blocked_credit', 'claim_credit', 'supplier_gstin', 'my_gstin', 'price_includes_tax'];
function refuseStrayTax(x, body) {
  const stray = Object.keys(body || {}).filter((key) => /(^|_)(vat|gst|tax|igst|cgst|sgst|cess)(_|$)/i.test(key) && OWN_TAX_KEYS.indexOf(key) < 0 && body[key] != null && body[key] !== '' && body[key] !== 0);
  if (!stray.length) return;
  const word = require('./tax-shelf').taxWordOf(x.s && x.s.country);
  throw refuse('This entry does not take the ' + word + ' as an amount (' + stray.join(', ') + '). Say the rate included in the amount (tax_rate) with the supplier’s tax number, or type the bill with its lines. Nothing was posted.');
}
/** a typed bill or a bank line's own tax figure is already beside the body */
const hasOwnTax = (body) => !!body.bill || body.input_tax_minor !== undefined;
/** the body with an expense form's tax answer turned into its typed bill (never beside a bill or a bank line's own tax figure); any other kind, or no answer, is the body as it came */
async function withFormBill(x, kind, body) {
  refuseStrayTax(x, body); /* G-F-06: a tax figure typed under a key no door reads is refused, never dropped */
  if (kind !== 'expense' || hasOwnTax(body) || body.tax_rate == null || body.tax_rate === '') return body;
  if (Number(body.tax_rate) > 0) await require('./books-bank-tax').requireRegistered(x); /* only a registered shop claims input tax */
  const klass = String(body.class || body.expense_class || '').trim();
  const bill = klass ? await expenseBillOf(x, body, klass, periodLib.dateOf(body, 'date', periodLib.today(x.s))) : null;
  return bill ? Object.assign({}, body, { bill }) : body;
}
module.exports = { taxedInvoice, billHeads, billInputTax, withFormBill, expenseBillOf, packRatesOf, expenseTaxFields };
