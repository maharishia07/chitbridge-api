'use strict';
/**
 * lib/till-summary.js — THE SHOP'S SUMMARY CHITS, READ ONCE (extracted for GET /api/facts/till, 2026-10-08).
 * CARD 26-reporting-mis-and-bi/trend
 *
 * OWNS      the summary statement both GET /api/till/summary and GET /api/facts/till run (one copy), the shop's-year statement and its
 *           reader, and — RPT2 (2026-10-17) — THE TREND: `trend()` (Reports › Trend: 52 weeks · 12 months · 8 quarters · 7 years, each beside
 *           last year) and `teaser()` (the Till card: 8 weeks' sales + "vs last year"). Both hand the summaries to rollup.series, the ONE
 *           comparison calculation (engines v1.66.0); nothing here adds, rounds or compares.
 * REP-48: the sales of a slot are READ FROM THE BOOKS when the shop keeps them (booksSold → overlayBooks): the Day book's SOLD per day
 *           (books-store.soldByDay, the rule Home's Till card reads a day by), put in the engine as stand-in summaries so rollup.series
 *           stays the ONE comparison. A credit bill and every day the counters never summarised are in; books off → the summaries, said in words.
 * CALLED BY routes/till.js (GET /api/till/summary) · lib/home-facts.js till() (GET /api/facts/till).
 * FLOW      R2R · reports — summaries (chit_header) + the shop's year → rollup.series → slots.
 *
 * ⚠️ A summary chit is purpose 'general' and so is a SHIFT chit: the test is the summary's period, never the purpose.
 * ⚠️ Ordered newest-first, which rollup.acrossCounters() relies on. Run it inside withEntity()/readBatch() (chit_header is FORCE RLS).
 * ⚠️ THE SHOP'S YEAR IS ITS OWN (N4): books_setting, else Country setup, else the country's pack — never April by default; none → refused.
 */
const rollup = require('./rollup');

const SUMMARY_SQL = `SELECT h.chit_id, h.created_at, h.business_json
         FROM chit_header h
        WHERE h.entity_id = $1
          AND h.purpose = 'general'
          AND h.business_json -> 'summary' ->> 'period' = $2
        ORDER BY h.business_json -> 'summary' ->> 'key' DESC, h.created_at DESC
        LIMIT $3`;

/** the statement + params for `limit` periods of one kind (reads limit*8 rows, as the route does: one per counter per re-send) */
const summaryStatement = (entity_id, period, limit) => ({ text: SUMMARY_SQL, params: [entity_id, period, Math.max(1, limit) * 8] });

/** rows of that statement → [{ key, totals, counters }] newest period first (the fold lives in lib/rollup, not here) */
const foldSummaries = (rows, limit) => rollup.acrossCounters((rows || []).map((x) => (x.business_json || {}).summary)).slice(0, limit);

/**
 * ⭐ THE SHOP'S MONEY AND YEAR, one statement (rides in the same readBatch as the summaries — no second trip). to_jsonb(row) so a column
 * that a migration has not added yet reads as null instead of failing the batch.
 */
const SHOP_YEAR_SQL = `SELECT i.country, i.currency_code,
       (SELECT to_jsonb(b) FROM books_setting b WHERE b.entity_id = i.identity_id) AS books,
       (SELECT to_jsonb(g) FROM entity_governance g WHERE g.entity_id = i.identity_id) AS gov
  FROM identities i
 WHERE i.identity_id = $1`;
const shopYearStatement = (entity_id) => ({ text: SHOP_YEAR_SQL, params: [entity_id] });

/** a read's first row, or null */
const firstRow = (read) => (read && read.rows && read.rows[0]) || null;
/** a summary statement's rows → the summary records they carry (a row without one is dropped) */
const summariesOf = (read) => ((read && read.rows) || []).map((row) => (row.business_json || {}).summary).filter(Boolean);

/**
 * shopYearOf(row) → { fyStart, currency, country } or { refused: { code, message } } — the year: books_setting, else Country setup, else
 * the pack (country-setup.fyStartOf); the money: the shop's own, else the books', else the pack's (country-setup.shopMoney). No guess, ever.
 */
function shopYearOf(row) {
  const countrySetup = require('./country-setup');
  const shop = row || {},
    books = shop.books || {},
    governance = shop.gov || {};
  const country = shop.country ? String(shop.country).trim().toUpperCase() : null;
  if (!country) return { refused: { code: 'NO_COUNTRY', message: require('./regulation').status(null, { name: '' }).why } };
  const fyStart = Number(books.fy_start_month) || Number(governance.fy_start_month) || countrySetup.fyStartOf(country);
  const currency = countrySetup.shopMoney(countrySetup.currencyStated(shop.currency_code, books.functional_currency), country);
  if (!fyStart || !currency) return { refused: { code: 'NO_MONEY', message: countrySetup.MONEY_UNSTATED } };
  return { fyStart, currency, country };
}

/** how many slots each Trend tab shows by default, and the most it may ask for (REQUIREMENT §3 rule 7; the engine's own top) */
const TREND_N = { week: 52, month: 12, quarter: 8, year: 7 };
const TREND_MAX = { week: 53, month: 24, quarter: 12, year: 10 };

/** how many periods the query asked for: a whole number up to the top (so the read stays bounded), else the tab's default */
function periodsAsked(period, asked) {
  const count = Math.floor(Number(asked));
  return count >= 1 ? Math.min(count, TREND_MAX[period]) : TREND_N[period];
}

/**
 * the summary statements one series needs — its own slots AND last year's: weeks and months as stored; a quarter and a year are folded
 * from MONTHS by the engine (a stored year is read too, for a year with no months on CB).
 */
function trendStatements(entity_id, period, count) {
  if (period === 'week') return [summaryStatement(entity_id, 'week', count + 53)];
  if (period === 'month') return [summaryStatement(entity_id, 'month', count + 12)];
  if (period === 'quarter') return [summaryStatement(entity_id, 'month', 3 * (count + 4))];
  return [summaryStatement(entity_id, 'month', 12 * (count + 1)), summaryStatement(entity_id, 'year', count + 1)];
}

/** the period the books' days are grouped into for each Trend tab (a quarter and a year are folded from MONTHS by the engine) */
const BOOKS_PERIOD = { week: 'week', month: 'month', quarter: 'month', year: 'month' };

/**
 * trend(entity, actor, { period, n, now }) → { status, body } — ONE trip (readBatch). body = { period, n, currency, fy_start_month, slots }
 * (+ sales_from 'books' | 'summaries' and sales_note, the words when the books could not be read) where slots = rollup.series(...) exactly (newest last); 400 for a period that is not a Trend tab; 422 with the code and the one sentence
 * when the shop's country, money or year is not stated.
 */
async function trend(entity, actor, asked) {
  const { readBatch } = require('../db');
  const period = asked.period;
  if (!TREND_N[period]) return { status: 400, body: { code: 'BAD_PERIOD', error: 'Ask for week, month, quarter or year.' } };
  const count = periodsAsked(period, asked.n);
  const [shopRead, ...summaryReads] = await readBatch(entity, actor, [shopYearStatement(entity)].concat(trendStatements(entity, period, count)));
  const shop = shopYearOf(firstRow(shopRead));
  if (shop.refused) return { status: 422, body: Object.assign({ error: shop.refused.message }, shop.refused) };
  const now = asked.now || Date.now(), books = await booksSold(entity, shopRead, { period, count: count + LAST_YEAR_SLOTS[period], now }); /* YE-F-03: the books' days reach last year's slots too */
  const stored = [].concat(...summaryReads.map(summariesOf));
  const summaries = overlayBooks(stored, BOOKS_PERIOD[period], books, shop, now);
  const slots = rollup.series(period, count, summaries, { fyStart: shop.fyStart, currency: shop.currency, now });
  return { status: 200, body: { period, n: count, currency: shop.currency, fy_start_month: shop.fyStart, slots, sales_from: books.state === 'read' ? 'books' : 'summaries', sales_note: books.words || summariesOnlyWords(summaries, BOOKS_PERIOD[period], books) } };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** a stored period key said for a shopkeeper: 2026-07 → "Jul 2026" (a week key stays as the engine names it) */
const keyWords = (key) => (/^\d{4}-\d{2}$/.test(key) ? MONTH_NAMES[Number(key.slice(5)) - 1] + ' ' + key.slice(0, 4) : key);
/**
 * RW1-18 (26 Nov): the books WIN where they know and a period they hold nothing for keeps its counter summary (F-61), so Trend can carry a period Accounts does not (Accounts reads the books only):
 * Trend's total since 1 July was A$194,875.00 against Accounts' A$148,960.00 = exactly the July the books hold nothing for (A$45,915.00, a demo history summary). Both are tax in; the basis never differed.
 * The difference is SAID, never silent: the words name each period that shows the counters' day summaries (null when every period shown is the books'). Only a period with a figure is named.
 */
function summariesOnlyWords(summaries, period, books) {
  if (!books || books.state !== 'read') return null;
  const kept = [...new Set(summaries.filter((x) => x.period === period && x.till && x.till.id !== BOOKS_TILL.id && Number((x.totals && (x.totals.gross != null ? x.totals.gross : x.totals.total)) || 0) > 0).map((x) => x.key))].sort();
  if (!kept.length) return null;
  const shown = kept.slice(-4).map(keyWords).join(', ') + (kept.length > 4 ? ' and ' + (kept.length - 4) + ' earlier' : '');
  return 'The books hold nothing for ' + shown + ', so those periods show the counter day summaries; the Accounts figures count the books only.';
}

/** the words when Trend cannot read the books — said, never a 0 and never a silent fall-back (REP-44) */
const BOOKS_OFF_WORDS = "The books are not switched on for this shop, so these sales are the counters' day summaries only.";
const BOOKS_EMPTY_WORDS = "The books hold no sales yet, so these sales are the counters' day summaries only.";
const BOOKS_TILL = { id: 'BOOKS', name: 'The books' };

/** the slots a Trend tab also reads so its oldest slot holds last year (the stored statements read the same: trendStatements) */
const LAST_YEAR_SLOTS = { week: 53, month: 12, quarter: 4, year: 1 };
const DAY_MS = 86400000, SLOT_DAYS = { week: 7, month: 31, quarter: 93, year: 366 };
const dayOf = (ms) => require('./books-engines').ymd(new Date(ms)); /* the ONE day reader of the books */
/** the days a screen shows: count slots of the period back from now, plus two for a slot that starts before the shown ones (a financial year, a quarter) — soldByDay reads THESE days, never the book (REQ-MIS-SHOWCASE section 12 defect E) */
const booksWindow = (shows) => !shows ? undefined : ({ from: dayOf(shows.now - (shows.count + 2) * SLOT_DAYS[shows.period] * DAY_MS), to: dayOf(shows.now + DAY_MS) });
/** what the Till card's teaser shows: the 8 weeks and, for "vs last year", the same weeks a year back (8 + 53) */
const teaserShows = (now) => ({ period: 'week', count: TEASER_WEEKS + 53, now: now || Date.now() });

/** a books-enabled shop's SOLD per day over the days the caller shows (shows = { period, count, now }): { state: 'read' | 'off' | 'empty', words, days, first } — null shop (refused) → off. One withEntity, only when the books are on. */
async function booksSold(entity, shopRead, shows) {
  const row = firstRow(shopRead) || {}, on = !!(row.books && row.books.enabled);
  if (!on) return { state: 'off', words: BOOKS_OFF_WORDS, days: [] };
  const { withEntity } = require('../db');
  let days, first;
  try {
    [days, first] = await withEntity(entity, async (handle) => {
      const store = require('./books-store');
      const read = await store.soldByDay(handle, entity, booksWindow(shows));
      return [read, await store.soldFrom(handle, entity)]; /* where the books BEGIN, whatever the window: only that period is short */
    });
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return { state: 'off', words: BOOKS_OFF_WORDS, days: [] }; /* ledger not provisioned: the summaries, said so */
    throw e;
  }
  return days.length || first ? { state: 'read', words: null, days, first } : { state: 'empty', words: BOOKS_EMPTY_WORDS, days: [] };
}

/** minor units → a summary's major-unit figure (money.round, the one rounder, in the shop's currency) */
const majorOf = (minor, currency) => require('./money').round(minor / Math.pow(10, require('./money').decimals(currency)), currency);

/**
 * overlayBooks(summaries, period, books, shop, now) → the books' period rows put in front of any stored row of the same
 * period and key (the books win where they know; a period the books hold nothing for keeps its stored counter rollup: counter sales are real sales, F-61 decision 21 Nov). Days are grouped by the engine's own rollup.keyOf; each group becomes a rollup.summary of
 * the books (till "The books"). Only the period the books BEGIN in carries its day keys as `source`, so the engine itself says it is short;
 * a period wholly after that is whole by construction. No books days → the summaries untouched.
 */
function overlayBooks(summaries, period, books, shop, now) {
  if (!books || books.state !== 'read' || !books.days.length) return summaries;
  const opts = { fyStart: shop.fyStart }, first = rollup.keyOf(period, books.first || books.days[0].day, opts), byKey = new Map();
  /* a day in another currency than the shop's, or holding two, is not added into the shop's money (never summed across currencies) */
  for (const dayRow of books.days.filter((item) => item.sold.minor != null && (!item.sold.currency || item.sold.currency === shop.currency))) {
    const key = rollup.keyOf(period, dayRow.day, opts);
    byKey.set(key, (byKey.get(key) || []).concat(dayRow));
  }
  const made = [...byKey].map(([key, days]) => {
    const gross = majorOf(days.reduce((sum, item) => sum + item.sold.minor, 0), shop.currency);
    const totals = { count: days.reduce((sum, item) => sum + item.bills, 0), returns: 0, gross, refunds: 0, expenseCount: 0, expenses: 0, total: gross, by: {} };
    return rollup.summary(period, key, totals, { till: BOOKS_TILL, source: key === first ? days.map((item) => item.day) : null, at: new Date(now).toISOString() });
  });
  return made.concat(summaries.filter((x) => !(x.period === period && byKey.has(x.key)))); /* F-61: a period the books hold data for shows the books; any other keeps its counter rollup */
}

const TEASER_WEEKS = 8;
/** the statements the Till card's teaser adds to its own readBatch: the shop's year and 8 weeks + last year's (no trip of its own) */
const teaserStatements = (entity_id) => [shopYearStatement(entity_id), summaryStatement(entity_id, 'week', TEASER_WEEKS + 53)];

/**
 * teaser(shopRead, weekRead, now, books) — the two teaserStatements' results → { spark: [8 × gross_minor | null], vs_last_year_pct: number | null },
 * or undefined (omitted, never 0): the last 8 ISO weeks' sales, oldest first, and the newest CLOSED week's change against the same week last
 * year — the engine's change_pct, null when either week is short or last year sold nothing. Fewer than 2 weeks with a figure → undefined, except that ONE week the books hold is a real figure (REP-54: a shop whose books begin this week still gets its Sold, null weeks beside it).
 */
function teaser(shopRead, weekRead, now, books) {
  const shop = shopYearOf(firstRow(shopRead));
  if (shop.refused) return undefined;
  const slots = rollup.series('week', TEASER_WEEKS, overlayBooks(summariesOf(weekRead), 'week', books, shop, now || Date.now()), { fyStart: shop.fyStart, currency: shop.currency, now: now || Date.now() });
  const spark = slots.map((slot) => slot.gross_minor);
  if (spark.filter((minor) => minor != null).length < (books && books.state === 'read' ? 1 : 2)) return undefined;
  const closed = slots.filter((slot) => !slot.coverage.partial).pop();
  return { spark, vs_last_year_pct: closed && closed.change_pct != null ? closed.change_pct : null };
}

/**
 * firstWeekLine(teaser, shopRead) → the Home Trend fact's line when the teaser holds ONE figure (REP-55): a chart cannot draw one point
 * (SPEC-charts rule 1), so the server says it — { text: 'First week: {money} so far', money: { amount, currency } } in the shop's own
 * currency. null when the spark holds none or several figures (the chart speaks then).
 */
function firstWeekLine(teaser, shopRead) {
  const shop = shopYearOf(firstRow(shopRead)), figures = ((teaser && teaser.spark) || []).filter((minor) => minor != null);
  if (shop.refused || figures.length !== 1) return null;
  return { text: 'First week: {money} so far', money: { amount: majorOf(figures[0], shop.currency), currency: shop.currency } };
}

module.exports = {
  summariesOnlyWords,
  teaserShows,
  booksWindow,
  firstWeekLine,
  SUMMARY_SQL,
  summaryStatement,
  foldSummaries,
  SHOP_YEAR_SQL,
  shopYearStatement,
  shopYearOf,
  TREND_N,
  trendStatements,
  trend,
  teaserStatements,
  booksSold,
  overlayBooks,
  teaser
};
