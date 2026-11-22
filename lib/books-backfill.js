'use strict';
// lib/books-backfill.js — the ledger start date and the backfill of bills on or after it
// OWNER     cb-accounting
// RISK      money
// OWNS      THE LEDGER START DATE AND THE BACKFILL OF BILLS ON OR AFTER IT (walks P-F-02 and S2-F-07, 1129): when the books are switched on after the shop has billed,
//           the owner chooses a start date - bills on or after it are posted (once), bills before it are in the opening balances, and the screen says how many of each.
// CALLED BY routes/books.js (POST /enable with start_date, POST /backfill, GET /backfill)
// FLOW      runBackfill(entity, { start_date }) -> lower enabled_at to the start day (never raised) -> counter days before today through hooks.postDay -> every unposted chit from the start, oldest first, through hooks.postChit -> { posted, waiting, before_start }
// CARD      14-accounting/books-health-to-do-outbox
/**
 * NO SECOND POSTER: every bill goes through lib/books-hooks (postChit, postDay), the posting the nightly sweep and the reconciler use. A bill that already has its entry is not even
 *   read (store UNPOSTED_FROM is the one test), so a second run posts nothing new. The period lock is postChit's own (L-F-05: a bill in a locked month posts on the first open day, said in its note).
 * THE START DATE is books_setting.enabled_at, the one lower bound the nightly, the reconciler and ledgerStart already read. It only moves earlier, and never before the financial year the
 *   ledger opened in (that year's months exist; an earlier year would need a carry-forward, so it is refused in words: what was owed before goes in as an opening balance).
 * TODAY'S OPEN COUNTER DAYS wait for their day close (the walk-in rule); the answer says how many bills wait, never silently.
 */
const hooks = require('./books-hooks');
const store = require('./books-store');
const books = require('./books');
const engines = require('./books-engines');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 200;
const MAX_PAGES = 25; /* 5,000 bills in one press; a bigger shop presses again (a named stop, never silent) */
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

function refuse(words, code) {
  const x = new Error(words);
  x.refused = true;
  x.code = code || 'BOOKS_START_DATE';
  return x;
}

/** the start day a caller may choose: a real day, not in the future, not before the ledger's first day; refused in words otherwise */
function startGate(setting, day, today) {
  if (!DATE.test(String(day || ''))) throw refuse('Choose the day your books start, like 2026-07-01.');
  if (day > today) throw refuse('The start date cannot be in the future.');
  const first = books.ledgerStart(setting, books.packOf(setting));
  if (first && day < first) throw refuse('Your books cannot start before ' + first + ', the first day of the year they were opened in. What was owed before then goes in as an opening balance.');
  return day;
}

/** the singular word for a count of one, the plural word for any other count */
const oneOrMany = (count, one, many) => (count === 1 ? one : many);
/** the words the Books screen says: nothing is silently left out */
function wordsOf(result) {
  const parts = [];
  if (result.before_start) parts.push(result.before_start + oneOrMany(result.before_start, ' bill before', ' bills before') + ' your start date ' + oneOrMany(result.before_start, 'is', 'are') + ' in the opening balances');
  if (result.posted) parts.push(result.posted + oneOrMany(result.posted, ' bill', ' bills') + ' posted from ' + result.start_day);
  if (result.waiting) parts.push(result.waiting + oneOrMany(result.waiting, ' bill waits', ' bills wait') + ' for its day to close or for an answer on the To-do list');
  return parts.length ? parts.join(' - ') : 'Every bill from ' + result.start_day + ' is in the books.';
}

/** how many bills sit before the start moment with no entry: the opening balances carry them, they are never back-dated */
async function beforeStart(h, entity, startFrom) {
  const c = await store.unpostedCount(h, entity, '1970-01-01T00:00:00Z', startFrom, { skipWalkin: false });
  return c.count;
}

/** lower the start (enabled_at) to the shop's start day, never raise it; one change-log line */
async function lowerStart(entity, setting, startDay, by) {
  const from = new Date(hooks.dayBounds(startDay, setting).from).toISOString();
  const current = setting.enabled_at ? new Date(setting.enabled_at).toISOString() : null;
  if (current && current <= from) return false;
  const moved = await withEntity(entity, async (h) => {
    const did = await store.lowerStart(h, entity, from);
    if (did) await store.logChange(h, entity, { by, table_name: 'books_setting', row_id: entity, field: 'enabled_at', old: current, new: from });
    return did;
  });
  return moved;
}

/** the counters' closed days from the start to yesterday, through postDay (idempotent by walkin:<counter>:<day>) */
async function postPastDays(entity, setting, startDay, today, out) {
  for (let d = startDay; d < today; d = engines.addDays(d, 1)) {
    const bounds = hooks.dayBounds(d, setting);
    const counters = await withEntity(entity, (h) => store.countersBilling(h, entity, bounds.from, bounds.to));
    for (const c of counters) {
      const posted = await hooks.postDay(entity, c, d, { setting });
      if (posted && posted.entry_no && !posted.duplicate) out.days.push(c + ' ' + d + ' -> ' + posted.entry_no);
      if (posted && posted.queued) out.problems.push({ what: 'walk-in day', counter: c, day: d, why: posted.why });
    }
  }
}

/** postChit's answer says nothing new was posted: no answer, no books, covered already, or a duplicate */
function nothingToPost(posted) {
  return !posted || posted.none || posted.off || posted.covered || posted.duplicate || !!(posted.payment && posted.payment.duplicate);
}

/** every unposted chit of the window, oldest first, each through postChit; what answered "waiting" is not read again in this press */
async function postChits(entity, setting, window, out) {
  const skip = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const found = await withEntity(entity, (h) => store.unpostedInWindow(h, entity, window.from, window.to, PAGE, { skipWalkin: setting.walkin_grain !== 'bill', skipIds: skip }));
    if (!found.length) return;
    for (const c of found) {
      const posted = await hooks.postChit(entity, c.chit_id, { setting });
      if (nothingToPost(posted)) skip.push(c.chit_id);
      else if (posted.queued || posted.waiting) {
        out.waiting++;
        skip.push(c.chit_id);
      } else out.posted++;
    }
  }
  out.problems.push({ what: 'more bills than one press posts', read: PAGE * MAX_PAGES });
}

/**
 * run(entity, { start_date, by }) -> { start_day, posted, waiting, before_start, days, problems, words }
 * Safe to press again: a bill with an entry is not read, a day posts once.
 */
async function runBackfill(entity, opt) {
  const asked = opt || {};
  const setting = await hooks.isOn(entity);
  if (!setting) throw refuse('Switch the ledger on first.', 'BOOKS_OFF');
  const today = hooks.dayOf(require('./shop-clock').now(), setting);
  const startDay = startGate(setting, asked.start_date, today);
  await lowerStart(entity, setting, startDay, asked.by || null);
  hooks.forget(entity);
  const live = (await hooks.isOn(entity)) || setting;
  const out = { start_day: startDay, posted: 0, waiting: 0, before_start: 0, days: [], problems: [] };
  const window = { from: hooks.dayBounds(startDay, live).from, to: hooks.dayBounds(today, live).to };
  await postPastDays(entity, live, startDay, today, out);
  await postChits(entity, live, window, out);
  out.before_start = await withEntity(entity, (h) => beforeStart(h, entity, window.from));
  out.words = wordsOf(out);
  return out;
}

/** read: what the Books screen says now, the start day and the bills before it that the opening balances carry */
async function status(entity) {
  const setting = await hooks.isOn(entity);
  if (!setting) return { enabled: false };
  const startDay = setting.enabled_at ? hooks.dayOf(setting.enabled_at, setting) : null;
  const from = setting.enabled_at ? new Date(setting.enabled_at).toISOString() : null;
  const before = from ? await withEntity(entity, (h) => beforeStart(h, entity, from)) : 0;
  const words = before ? wordsOf({ start_day: startDay, before_start: before, posted: 0, waiting: 0 }) : startDay ? 'Your books start on ' + startDay + '.' : '';
  return { enabled: true, start_day: startDay, before_start: before, words };
}

module.exports = { run: runBackfill, status, startGate, wordsOf };
