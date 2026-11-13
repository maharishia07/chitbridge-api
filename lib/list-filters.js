// CARD 01-rail-core-the-chit/chits-routes
// owns: which of a chit list's filters (?assigned_to, ?date_from, ?date_to) cannot be read, judged before the query casts them.
// called by: routes/chits.js filtersReadable (inbox, sent, folder).
// FLOW  req.query → unreadable(query) → ['date_from', ...] → 400 FILTER_INVALID
'use strict';
/**
 * lib/list-filters.js — THE FILTERS A CHIT LIST CASTS IN SQL, READ FIRST (C11 10b, RAIL-135, 2026-11-12).
 *
 * ⚠️ A garbage ?assigned_to (::uuid) or ?date_from (::timestamptz) used to reach the database and come back 500. A day is books-period's ONE isCalendarDay
 *    (2026-02-30 is not one); an instant is anything Date reads. 'me' and 'all' are the two words assigned_to takes besides an id.
 */
const trace = require('./trace');
const { isCalendarDay } = require('./books-period');

const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERSON_WORDS = ['me', 'all'];

/** a ?date_ value is readable when it is a real calendar day, or (with a time) an instant */
const dayReadable = (given) => (PLAIN_DAY.test(String(given).trim()) ? isCalendarDay(String(given).trim()) : Number.isFinite(Date.parse(String(given))));
const absent = (given) => given === undefined || given === '';

/** unreadable(query) → the names of the filters that cannot be read, in the order asked ([] when all can) */
function unreadable(query) {
  const found = [];
  const person = query.assigned_to;
  if (person && !PERSON_WORDS.includes(person) && !trace.UUID_RE.test(String(person))) found.push('assigned_to');
  for (const name of ['date_from', 'date_to']) if (!absent(query[name]) && !dayReadable(query[name])) found.push(name);
  return found;
}

module.exports = { unreadable };
