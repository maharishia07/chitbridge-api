'use strict';
/**
 * lib/books-money-ops.js — the sums, differences and whole-unit roundings the books files need, over MINOR-UNIT rows, each carrying its currency.
 *
 * OWNS      sumMinor · diffMinor · addMinor · roundMinor (a thin door onto the engine's value-type operators: lib/money.js plusMoney · minusMoney · timesMoney)
 * CALLED BY lib/books.js · books-opening · books-period · books-party-bills · books-evidence · books-statement-notes · books-return-split · books-report-period · books-store · routes/books.js
 * FLOW      a list of rows + the books' currency ──▶ makeMinor per amount ──▶ plusMoney / minusMoney / timesMoney (a second currency REFUSES, 409) ──▶ a whole minor integer
 * CARD      14-accounting/README
 *
 * ⭐ CUR-1 / ACC-206: no books file adds, subtracts or rounds a money figure itself; it asks here, and the engine does the arithmetic. Nothing is calculated here: each
 * function is one engine operator applied along a list (money.js is ADOPTED, never edited here). `pick` reads one row's minor amount (default: the row is the amount).
 * A blank reads as 0, as the hand sums did; a figure that is not a whole minor unit is refused by the engine (MONEY_AMOUNT_INVALID), never silently rounded.
 */
const Money = require('./money');

const minorOf = (value) => Number(value) || 0;

/** the rows' amounts added, in one currency (the engine's plusMoney) → whole minor units */
function sumMinor(list, currency, pick) {
  let total = Money.makeMinor(0, currency);
  (list || []).forEach((item) => {
    total = Money.plusMoney(total, Money.makeMinor(minorOf(pick ? pick(item) : item), currency));
  });
  return total.amount_minor;
}
/** a − b in minor units, same currency (the engine's minusMoney) */
function diffMinor(first, second, currency) {
  return Money.minusMoney(Money.makeMinor(minorOf(first), currency), Money.makeMinor(minorOf(second), currency)).amount_minor;
}
/** a + b in minor units, same currency (the engine's plusMoney) */
function addMinor(first, second, currency) {
  return Money.plusMoney(Money.makeMinor(minorOf(first), currency), Money.makeMinor(minorOf(second), currency)).amount_minor;
}
/** a figure to WHOLE minor units, half away from zero, read at 15 significant digits (the engine's timesMoney by one) */
function roundMinor(value, currency) {
  return Money.timesMoney(Money.makeMinor(1, currency), minorOf(value)).amount_minor;
}

module.exports = { sumMinor, diffMinor, addMinor, roundMinor };
