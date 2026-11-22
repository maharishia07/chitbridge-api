/**
 * books-stray-tax.js — an expense whose tax rides under a key the books do not read waits in words (BNK-new-3, lifecycle 16 Nov).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      strayTaxKey(expense) · strayTaxVerdict(expense) · splitUnlessStray(expense, amount, setting, splitter, currency)
 * CALLED BY lib/books-hooks.js expenseVerdict
 * FLOW      expense → strayTaxKey → the wait that names the key, or the tax split through books-hooks expenseTaxSplit
 * CARD      14-accounting/README
 * An expense with its tax under gst, tax_amount, tax … and no input_tax used to post as the WHOLE figure to the expense, the tax inside it (a 242.00 expense with 22.00 tax left 1B short by 22.00).
 * The one shape is input_tax { <head>: amount } (ACC-230); a stray tax key beside no input_tax waits, and the words name the key. Moved out of books-hooks.js, whose size row may not grow.
 */
'use strict';
const STRAY_KEYS = ['gst', 'gst_amount', 'tax', 'tax_amount', 'vat', 'vat_amount'];

/** the name of the first such key, else null */
function strayTaxKey(expense) {
  if (expense.input_tax != null) return null;
  return STRAY_KEYS.filter((key) => expense[key] != null && Number(expense[key]) !== 0 && expense[key] !== '')[0] || null;
}

/** the queue verdict that names the stray key, or null when the expense carries none */
function strayTaxVerdict(expense) {
  const strayTax = strayTaxKey(expense);
  return strayTax
    ? { kind: 'queue', why: 'The expense carries a tax figure under "' + strayTax + '", which the books do not read: give it as input_tax { <head>: amount }, the head being one of your tax heads.' }
    : null;
}

/** the expense's tax split — or, when its tax rides under a stray key, the wait that names it (same words as strayTaxVerdict); `splitter` is books-hooks expenseTaxSplit, passed in so this file never requires its caller */
function splitUnlessStray(expense, amount, setting, splitter, currency) {
  const stray = strayTaxVerdict(expense);
  return stray ? { why: stray.why } : splitter(expense.input_tax, amount, setting, currency);
}

module.exports = { strayTaxKey, strayTaxVerdict, splitUnlessStray };
