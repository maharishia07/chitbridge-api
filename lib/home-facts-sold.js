'use strict';
/**
 * lib/home-facts-sold.js — the Home Till card's books day: the newest Day book day (soldByDay's rows) as Sold, bills and Takings.
 * OWNER     cb-reports
 * OWNS      booksDay (one named day, one read) · booksFiguresOf · newestBooksDay (from days already read) · no route, no state
 * RISK      money
 * CALLED BY lib/home-facts.js (till)
 * FLOW      books-store.soldByDay (the ONE sold rule) -> figures in major units; nothing is recomputed from a bill
 * CARD      28-platform-and-operations/home-facts
 */
const { withEntity } = require('../db');
const notProvisioned = (e) => e && (e.code === '42P01' || e.code === '42703');

/**
 * booksDay — today's SOLD and TAKINGS as the Day book holds them (M144, REP-52): the shop day's entries of kind walk-in day (one closing covering
 * many bills, or a late walk-in posted on its own: books-hooks walkin-late, covers NULL, one bill) · sale_bill · credit_given · return, read through
 * books-store.soldByDay for that one day — the ONE sales rule (Trend and the practice read it too), never recomputed from the bills. Reversed entries and the reversals are left out, so the
 * card follows the books, not a stale summary chit.
 *   sales    = net Dr − Cr on cash · upi · card · bank · debtors — the bill value incl. tax, net of returns, paid OR on credit (G-MONEY's word: sold)
 *   takings  = the same on the tender roles only — what came in across the counter; a credit_given (Dr debtors, Cr the tender) adds a bill,
 *              sells 0 and LOWERS takings. Money collected later against dues is CB Finance's figure, not this one.
 * null when the ledger is off / not provisioned / has no such entry that day — the card then falls back to the summary chit.
 */
async function booksDay(ctx, dayKey, currency) {
  const booksStore = require('./books-store');
  let days;
  try {
    days = await withEntity(ctx.entity, (handle) => booksStore.soldByDay(handle, ctx.entity, { from: dayKey, to: dayKey }));
  } catch (e) {
    if (notProvisioned(e)) return null;
    throw e;
  }
  return booksFiguresOf(days[0], currency);
}

/** one Day book day (a soldByDay row) as the card's figures in major units; null for no entry that day or two currencies in one day (no figure rather than a sum across them) */
function booksFiguresOf(soldDay, currency) {
  const money = require('./money');
  if (!soldDay || soldDay.sold.minor == null || soldDay.taken.minor == null) return null;
  const major = (minor) => money.round(minor / Math.pow(10, money.decimals(currency)), currency || undefined);
  return { bills: soldDay.bills, sales: major(soldDay.sold.minor), takings: major(soldDay.taken.minor) };
}

/**
 * newestBooksDay (BD-F-01) — the newest day the books hold sales for, read from the days the teaser already fetched (no trip of its own). The Sell card names the
 * newest day of the BOOKS when it is newer than the counters' newest summary: bills sent by the api, not the till, never reach a counter summary, so the card
 * read an old closing (₹0.00 · 1 bill) over a shop with ₹2,71,971.43 of sales in the books. null when the books are off or hold no usable day.
 */
function newestBooksDay(books, currency) {
  const days = books && books.state === 'read' ? books.days : [];
  for (let i = days.length - 1; i >= 0; i--) {
    const figures = booksFiguresOf(days[i], currency);
    if (figures && (!days[i].sold.currency || !currency || days[i].sold.currency === currency)) return { key: days[i].day, figures };
  }
  return null;
}

module.exports = { booksDay, booksFiguresOf, newestBooksDay };
