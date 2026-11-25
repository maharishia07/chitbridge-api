'use strict';
/**
 * lib/home-facts-sold.js — the Home Till card's books day: the newest Day book day (soldByDay's rows) as Sold, bills and Takings.
 * OWNER     cb-reports
 * OWNS      booksDay (one named day, one read) · booksFiguresOf · newestBooksDay (from days already read) · soldLines (the card's Sold and Takings lines) · tillSoldPart (the Sold half of the till card) · no route, no state
 * RISK      money
 * CALLED BY lib/home-facts.js (till)
 * FLOW      books-store.soldByDay (the ONE sold rule) -> figures in major units; nothing is recomputed from a bill
 * CARD      28-platform-and-operations/home-facts
 */
const { withEntity } = require('../db');
const toNumber = (value) => Number(value) || 0;
const plural = (count, singular, many) => count + ' ' + (count === 1 ? singular : many || singular + 's');
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

/** the day's bills, sold and takings: the books' figures when they gave the day, else the summary chit's (no takings there: a summary does not split its tenders) */
function dayFiguresOf(summaryDay, booksFigures) {
  if (booksFigures) return { bills: booksFigures.bills, sold: booksFigures.sales, took: booksFigures.takings };
  const money = require('./money'),
    totals = summaryDay.totals || {};
  return { bills: toNumber(totals.count), sold: money.round(toNumber(totals.gross) - toNumber(totals.refunds) - toNumber(totals.reduced)), took: undefined };
}

/**
 * RW2-07: the line says what it counts ("· 12 bills in the books"): every sale the books hold, not the counter bills the Till lists.
 * soldLines — the Till card's day as figures and lines (REP-52): Sold with the bills, then Takings when the books gave the day.
 * The books' figures (bk) win; the fallback is the summary chit's bill value net of returns (gross − refunds − reduced, CTR-196) — never rollup `total`,
 * which also nets the drawer's EXPENSES — and no takings, since a summary does not split its tenders (omitted, never 0).
 * A day that is not today is named by its date. No currency on the shop → bills only, no money placeholder.
 */
function soldLines(summaryDay, isToday, booksFigures, currency) {
  const { bills, sold, took } = dayFiguresOf(summaryDay, booksFigures);
  const figures = { day: summaryDay.key, bills, sales: sold, currency: currency || null };
  if (took != null) figures.takings = took;
  const lines = [
    {
      text: (currency ? (isToday ? 'Sold today {money} · ' : 'Sold {money} · ') : '') + plural(bills, 'bill') + ' in the books' + (isToday ? '' : ' on {date}'),
      value: bills,
      at: summaryDay.key,
      money: currency ? { amount: sold, currency } : undefined
    }
  ];
  if (took != null && currency) lines.push({ text: 'Takings {money}', money: { amount: took, currency } });
  return { figures, lines };
}

/** the Sold / Bills / Takings half of the till card: the newest day the counters closed or the books know (books win when newer), as { lines, figures } */
async function tillSoldPart(ctx, { row, summaryDay, booksNewest, today }) {
  const booksLead = booksNewest && (!summaryDay || booksNewest.key > summaryDay.key); /* BD-F-01: the books know a newer day than the counters' last closing */
  if (!summaryDay && !booksLead) return { lines: [], figures: {} };
  const newestDay = booksLead ? { key: booksNewest.key } : summaryDay;
  const isToday = newestDay.key === today;
  const booksFigures = booksLead
    ? booksNewest.figures
    : isToday
      ? await booksDay(ctx, newestDay.key, row.currency_code)
      : null; /* M144: today's figure is the Day book's (the books' entries), not the older summary chit */
  return soldLines(newestDay, isToday, booksFigures, row.currency_code || '');
}

module.exports = { booksDay, booksFiguresOf, newestBooksDay, soldLines, tillSoldPart, toNumber, plural };
