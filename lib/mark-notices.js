'use strict';
// OWNS      the mark news the bell shows: noticesOf (own transaction) · noticesOn (inside the caller's transaction) (the rows of the DB function mark_notices, b870, shaped as feed rows) · feedRow (one notice as a row of the Activity feed, naming the entry)
// CALLED BY routes/notifications.js (the feed and the badge count)
// FLOW      withEntity(me) → mark_notices(days, max[, internal]): a Query on my books, a reply in a thread I own or opened (a COLLEAGUE's too, b877, never my own words), and, when the caller may read notes, a colleague's reply on my firm's own note
//           → a feed row { action 'mark_query'|'mark_reply'|'note_reply', log_id 'mk:…'|'mr:…'|'fl:…', mark_client (the client's name when it is not my own business), mark_entry, … }
//           the function is not on this database yet (b870) → no mark news; the three-parameter form is not there yet (b877) → the two-parameter call, as before; the rest of the bell answers as before
// CARD      22-channels-capture-and-messaging/notifications-and-the-bell · 14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT
const log = require('./logger');
const E = require('./books-engines');
const { withEntity } = require('../db');

const DAYS = Math.max(1, parseInt(process.env.NOTIF_FEED_DAYS || '90', 10) || 90);

/** the entry in words the bell can use: its id (the key the Day book's Query chip opens its sheet by: a sales or payment entry alike), its number, its date (YYYY-MM-DD, the web paints it in the shop's way) and its money in minor units with the currency; the id alone when the entry itself could not be read; null when the row names no entry */
function titleOf(row) {
  const entryId = row.subject_id ? String(row.subject_id) : null;
  const label = row.label || null; /* an internal note's own words for its record (what the writer's page sent), never read from the client's books */
  if (!row.entry_no) return entryId ? { entry_id: entryId, entry_no: null, posting_date: null, currency: null, total_minor: null, label } : null;
  const date = E.ymd(row.posting_date);
  return { entry_id: entryId, entry_no: row.entry_no, posting_date: date, currency: row.currency || null, total_minor: row.total_minor == null ? null : String(row.total_minor), label };
}

/** one notice as a row of the feed (the bell's own shape: log_id, action, action_by_display_name, detail, created_at) plus `mark_entry` */
function feedRow(row) {
  return {
    log_id: row.notice_id,
    chit_id: null,
    action: row.notice_kind === 'query' ? 'mark_query' : row.notice_kind === 'internal' ? 'note_reply' : 'mark_reply',
    action_by_display_name: row.by_name || null,
    new_status: null,
    detail: row.note || null,
    created_at: row.at instanceof Date ? row.at.toISOString() : row.at,
    mark_entry: titleOf(row),
    mark_client: row.client_name || null
  };
}

/** one failed read is no news, said in the log unless the function is simply not there (b870 not run) */
function noNews(err) {
  if (!(err && err.code === '42883')) log.fellBack('mark notices: the read failed, the bell goes on without them', err);
  return [];
}

/**
 * the THREE-parameter form (p_internal, b877) is asked only when the caller may read notes; when this database has not got it (42883) the call falls back to the two-parameter form at once and
 * the three-parameter form is not tried again for a minute (a hand-run migration is picked up within the minute, the lib/schema rule for an absent column).
 */
let noInternalUntil = 0;
const wide = (internal) => internal === true && Date.now() >= noInternalUntil;
const callSql = (internal) => 'SELECT * FROM mark_notices($1::int, $2::int' + (wide(internal) ? ', true' : '') + ')';
/** true when this failure only means "the three-parameter form is not there": remembered, and the caller asks again in the two-parameter form */
function narrowAfter(err, askedWide) {
  if (askedWide && err && err.code === '42883') {
    noInternalUntil = Date.now() + 60000;
    return true;
  }
  return false;
}

/** the mark news of this business, newest first; [] when the function is not there (b870 not run) or the read fails (the bell goes on without it, said in the log). internal = the caller may read the firm's notes (private-flag's own right) */
async function noticesOf(entityId, max, internal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const asked = wide(internal);
    try {
      const found = await withEntity(entityId, (db) => db.query(callSql(internal), [DAYS, max]));
      return found.rows.map(feedRow);
    } catch (err) {
      if (!narrowAfter(err, asked)) return noNews(err);
    }
  }
  return [];
}

/**
 * the same news read on a handle that is ALREADY inside the caller's withEntity: no second transaction (the bell paid a trip for it).
 * A savepoint keeps the one transaction alive when the function is missing (42883) or fails, so the caller's other reads still commit.
 */
async function noticesOn(db, max, internal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const asked = wide(internal);
    await db.query('SAVEPOINT mark_notices_sp');
    try {
      const found = await db.query(callSql(internal), [DAYS, max]);
      await db.query('RELEASE SAVEPOINT mark_notices_sp');
      return found.rows.map(feedRow);
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT mark_notices_sp').catch(() => {});
      if (!narrowAfter(err, asked)) return noNews(err);
    }
  }
  return [];
}

/**
 * the badge's share of the news as two columns of the count statement itself (news_fresh: newer than the watermark, news_total): one statement, one transaction, no rows travel.
 * the days window and the cap (what mark_notices takes) are INTEGERS written into the text, so the statement's parameters stay the feed's three; `seen` is the SQL of the watermark text. Same rows, same rule as noticesOf + the route's own filter.
 */
const newsCte = (max, internal) => `news AS (SELECT n.at FROM mark_notices(${DAYS}, ${Math.trunc(Number(max)) || 0}${wide(internal) ? ', true' : ''}) n)`;
const newsColumns = (seen) => `(SELECT count(*) FROM news WHERE ${seen} IS NULL OR news.at > ${seen}::timestamptz)::int AS news_fresh, (SELECT count(*) FROM news)::int AS news_total`;
/** mark_notices is not on this database (b870 not run): remembered for a minute, so the badge does not try it on every poll and a hand-run migration is picked up within the minute (the lib/schema rule for an absent column) */
let absentUntil = 0;
const absent = () => Date.now() < absentUntil;
function noteFailure(err, internal) {
  if (narrowAfter(err, wide(internal))) return 'retry'; /* only the three-parameter form is missing: the caller asks again, in the two-parameter form */
  if (err && err.code === '42883') absentUntil = Date.now() + 60000;
  else log.fellBack('mark notices: the read failed, the bell goes on without them', err);
}

module.exports = { noticesOf, noticesOn, newsCte, newsColumns, absent, noteFailure, DAYS, feedRow, titleOf };
