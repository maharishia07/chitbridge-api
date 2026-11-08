'use strict';
/**
 * lib/currency-cells.js — EVERY MONEY CELL NAMES THE CURRENCY OF ITS DOCUMENT, OR NAMES NONE (CUR-1 · ACC-331 · ACC-332).
 *
 * OWNS    which cells of a bill or a journal can carry a currency (billCellsOf, journalCellsOf) and the ONE refusal of a cell that names another
 *         currency than the document's (assertSame: lib/money.assertSameCurrency decides, this adds the code CURRENCY_MISMATCH and the sentence).
 * CALLED BY routes/chits.js sendPartCurrency (POST /chits/send) · lib/books-manual.js givenLines (POST /books/entries, the journal builder).
 * FLOW    cells → assertSame(cell, document currency) → throws { status 409, code CURRENCY_MISMATCH, field } → the door answers the one problem shape.
 * ⚠️ A cell that names NO currency is the document's own money (WX-R2R: a chit that names none is the sender's; the till sends none) — never a guess,
 *    the contract already says so. A cell that names one must equal it: an amount is labelled, never converted, never re-labelled.
 * CARD 14-accounting/README
 */
const Money = require('./money');

const naming = (currency) => (currency === undefined || currency === null || currency === '' ? null : String(currency).trim().toUpperCase());

/** the currency a cell carries: its own `currency` key, or the code of a money value in `price` — null when it names none */
function cellCurrency(cell) {
  if (!cell || typeof cell !== 'object') return null;
  const own = naming(cell.currency);
  if (own) return own;
  return cell.price && typeof cell.price === 'object' ? naming(cell.price.currency) : null;
}

/** the money cells of one bill: the payment and its parts, the refund and its parts, each line — { field, currency } for those that name a currency */
function billCellsOf(business, lines) {
  const cells = [];
  const add = (field, cell) => cells.push({ field, currency: cellCurrency(cell) });
  for (const slot of ['payment', 'refund']) {
    const part = business && business[slot];
    if (!part || typeof part !== 'object') continue;
    add(slot + '.currency', part);
    (Array.isArray(part.parts) ? part.parts : []).forEach((one, i) => add(slot + '.parts[' + i + '].currency', one));
  }
  (Array.isArray(lines) ? lines : []).forEach((line, i) => add('line_items[' + i + '].currency', line));
  return cells.filter((cell) => cell.currency);
}

/** the typed lines of one journal: { field, currency } for those that name a currency */
function journalCellsOf(list) {
  const rows = (Array.isArray(list) ? list : []).map((line, i) => ({ field: 'lines[' + i + '].currency', currency: cellCurrency(line) }));
  return rows.filter((cell) => cell.currency);
}

/**
 * assertSame(cells, currency) → true, or throws the one refusal for the FIRST cell that names another currency than the document's.
 * No currency of the document's own (a draft before Country setup): nothing to compare against, nothing is claimed here.
 */
function assertSame(cells, currency) {
  const shop = naming(currency);
  if (!shop) return true;
  for (const cell of cells) {
    try {
      Money.assertSameCurrency({ amount: 0, currency: cell.currency }, { amount: 0, currency: shop }, cell.field);
    } catch (_refused) {
      const words = cell.field + ' says ' + cell.currency + ', but this shop\u2019s money is ' + shop + '. Nothing was saved. Use ' + shop + ', or leave the currency out.';
      const e = new Error(words);
      Object.assign(e, { status: 409, code: 'CURRENCY_MISMATCH', field: cell.field, claimed: cell.currency, governed: shop });
      throw e;
    }
  }
  return true;
}

module.exports = { billCellsOf, journalCellsOf, assertSame };
