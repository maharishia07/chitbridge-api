'use strict';
// OWNS      the mark news the bell shows: noticesOf (the rows of the DB function mark_notices, b870, shaped as feed rows) · feedRow (one notice as a row of the Activity feed, naming the entry)
// CALLED BY routes/notifications.js (the feed and the badge count)
// FLOW      withEntity(me) → mark_notices(days, max): a Query on my books or a reply in a thread I own or opened, never my own words → a feed row { action 'mark_query'|'mark_reply', log_id 'mk:…'|'mr:…', mark_title, … }
//           the function is not on this database yet (b870) → no mark news, the rest of the bell answers as before
// CARD      22-channels-capture-and-messaging/notifications-and-the-bell · 14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT
const log = require('./logger');
const { withEntity } = require('../db');

const DAYS = Math.max(1, parseInt(process.env.NOTIF_FEED_DAYS || '90', 10) || 90);

/** the entry in words the bell can use: its number, its date (YYYY-MM-DD, the web paints it in the shop's way) and its money in minor units with the currency; null for what could not be read */
function titleOf(row) {
  if (!row.entry_no) return null;
  const date = row.posting_date instanceof Date ? row.posting_date.toISOString().slice(0, 10) : row.posting_date ? String(row.posting_date).slice(0, 10) : null;
  return { entry_no: row.entry_no, posting_date: date, currency: row.currency || null, total_minor: row.total_minor == null ? null : String(row.total_minor) };
}

/** one notice as a row of the feed (the bell's own shape: log_id, action, action_by_display_name, detail, created_at) plus `mark_entry` */
function feedRow(row) {
  return {
    log_id: row.notice_id,
    chit_id: null,
    action: row.notice_kind === 'query' ? 'mark_query' : 'mark_reply',
    action_by_display_name: row.by_name || null,
    new_status: null,
    detail: row.note || null,
    created_at: row.at instanceof Date ? row.at.toISOString() : row.at,
    mark_entry: titleOf(row)
  };
}

/** the mark news of this business, newest first; [] when the function is not there (b870 not run) or the read fails (the bell goes on without it, said in the log) */
async function noticesOf(entityId, max) {
  try {
    const found = await withEntity(entityId, (db) => db.query('SELECT * FROM mark_notices($1::int, $2::int)', [DAYS, max]));
    return found.rows.map(feedRow);
  } catch (err) {
    if (!(err && err.code === '42883')) log.fellBack('mark notices: the read failed, the bell goes on without them', err);
    return [];
  }
}

module.exports = { noticesOf, feedRow, titleOf };
