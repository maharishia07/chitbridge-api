/* bank-lock.js — A STATEMENT LINE IN A LOCKED MONTH: say it before any work, and offer the two ways out (W15-85).
 * OWNS      reading the shop's own month rows (GET /periods, the rows cap-books.js bkPeriodsLoad keeps in BK.lk.info) for one day: is that month locked, by whom and when, may it be reopened (the server's own
 *           reopen.may), which is the first OPEN month after it; the band's sentence and its groups ("September 2026 · 3 lines"); 
 *           the late-posted words a re-read shows ("posted 1 Oct 2026 (September locked)"). The note a moved line carries ("<narration> — September locked") is the api's (lib/books-lock-note): ONE wording, every door.
 * CALLED BY public/app/cap-bank-sheet.js (the controller's lockedMonth, the band's lock notice, the feed of posted lines) · public/app/bank-preview.js reads what lockedOf returns · cap-bank-post.js (narration).
 * FLOW      rows (GET /periods) + a line's day → lockedOf(rows, day) → { key, name, label, by, at, may, next } | null → the preview marks the line 'closed' → groupsOf(items) → noticeWords(group) → the band.
 * ⭐ NOTHING IS RE-DERIVED. The lock state, who closed it and whether it may be reopened are the server's rows (status, lock_trail, reopen.may); "the next open month" is the first row after the locked one whose status is open (the api's
 *   own rule, books.postingDateFor, moves the entry to the same day, and its answer — posting_date — is what the page shows after). No money is touched here; the entry keeps the statement line's own date as doc_date.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
(function (root) {
  'use strict';
  function sayText(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  function fillText(text, values) {
    return typeof root.txf === 'function' ? root.txf(text, values) : String(text).replace(/\{(\w+)\}/g, function (_, key) { return values[key]; });
  }
  var dayOf = function (value) { return String(value || '').slice(0, 10); };
  var isLocked = function (row) { return !!row && (row.status === 'soft_locked' || row.status === 'hard_locked'); };
  /* month words: helpers.js monthNames (the one list, in the reader's language); WHICH months exist and where a year starts is only ever the server's rows (country-neutral) */
  /** the month name of a 'YYYY-MM-DD' day ("September"), and with the year ("September 2026") */
  function monthName(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(iso || '');
    return m ? monthNames('long')[+m[2] - 1] : '';
  }
  function monthLabel(iso) {
    return monthName(iso) + ' ' + String(iso || '').slice(0, 4);
  }
  /** "1 Oct 2026" */
  function dayText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? +m[3] + ' ' + monthNames('short')[+m[2] - 1] + ' ' + m[1] : '';
  }
  /** the month row (1-12, never the opening period 0) that a day falls in, from the server's own start_date…end_date; null when the rows do not cover it */
  function rowOfDay(rows, iso) {
    var one = dayOf(iso);
    return (rows || []).filter(function (row) { return Number(row.period) >= 1 && dayOf(row.start_date) <= one && one <= dayOf(row.end_date); })[0] || null;
  }
  /** the first month AFTER this one that is open → { date: its first day, name, label }; null when the rows know none (a year not started yet is the server's to start: nothing is offered then) */
  function nextOpen(rows, row) {
    var later = (rows || [])
      .filter(function (one) { return Number(one.period) >= 1 && dayOf(one.start_date) > dayOf(row.end_date) && !isLocked(one); })
      .sort(function (a, b) { return dayOf(a.start_date) < dayOf(b.start_date) ? -1 : 1; })[0];
    return later ? { date: dayOf(later.start_date), name: monthName(dayOf(later.start_date)), label: monthLabel(dayOf(later.start_date)) } : null;
  }
  /** who closed the month and when, from the server's own trail (the latest 'locked' row): { by, at } with nulls when it names none */
  function closedBy(row) {
    var locks = ((row && row.lock_trail) || []).filter(function (item) { return item.action === 'locked'; }),
      last = locks[locks.length - 1] || {};
    return { by: last.by_name || null, at: last.at ? dayOf(last.at) : null };
  }
  /**
   * lockedOf(rows, day) → null when the day's month is open (or unknown), else what the controller keeps on the line: { key 'YYYY-MM', month (same), name, label, hard, by, at, may (the server's reopen.may), fy, period, next, words }.
   * `words` is what the line itself says; the band says the longer sentence (noticeWords).
   */
  function lockedOf(rows, isoDay) {
    var row = rowOfDay(rows, isoDay);
    if (!isLocked(row)) return null;
    var closer = closedBy(row),
      key = dayOf(row.start_date).slice(0, 7);
    return {
      key: key, month: key, name: monthName(dayOf(row.start_date)), label: monthLabel(dayOf(row.start_date)), hard: row.status === 'hard_locked',
      by: closer.by, at: closer.at, may: !!(row.reopen && row.reopen.may), fy: row.fiscal_year, period: Number(row.period), next: nextOpen(rows, row),
      words: fillText('{month} is locked', { month: monthLabel(dayOf(row.start_date)) })
    };
  }
  /** the locked months the not-yet-booked lines fall in, oldest first: [{ key, label, name, by, at, may, next, count, moved }]. `moved` = the person chose to post this month's lines in the next open month. */
  function groupsOf(items, moved) {
    var by = {};
    (items || []).forEach(function (item) {
      var closed = item.closed || item.moveTo;
      if (!closed) return;
      var group = by[closed.key] || (by[closed.key] = Object.assign({}, closed, { count: 0, moved: !!(moved && moved[closed.key]) }));
      group.count += 1;
    });
    return Object.keys(by).sort().map(function (key) { return by[key]; });
  }
  /** the band's first sentence for one locked month: "September 2026 is locked (closed by Anna, 3 Oct 2026). New lines can't be added until it's reopened." */
  function noticeWords(group) {
    /* who and when come from the month's own lock trail; a month whose trail names neither is simply "locked" — nothing is filled in (coordinator, 16 Nov) */
    var parts = [group.by ? fillText('closed by {who}', { who: group.by }) : '', group.at ? (group.by ? '' : sayText('closed') + ' ') + dayText(group.at) : ''].filter(Boolean),
      who = parts.length ? ' (' + parts.join(', ') + ')' : '';
    return fillText('{month} is locked', { month: group.label }) + who + '. ' + sayText("New lines can't be added until it's reopened.");
  }
  /** the line the person sees once they chose to post in the next month: "3 lines will post on 1 Oct 2026, noted 'September locked'." */
  function movedWords(group) {
    return fillText('{n} will post on {date}, with the note "{month} locked".', { n: group.count === 1 ? sayText('1 line') : group.count + ' ' + sayText('lines'), date: group.next ? dayText(group.next.date) : '', month: group.name });
  }
  /**
   * the posted line a re-read finds, as the log carries it ({ posting_date, doc_date }): words when it was posted in a LATER month than its own day ("posted 1 Oct 2026 (September locked)"), else null.
   * Read from the two carried dates, never matched by date: the line is found by its own client_ref.
   */
  function lateWords(row) {
    var posted = dayOf(row && row.posting_date),
      own = dayOf(row && row.doc_date);
    if (!posted || !own || posted.slice(0, 7) <= own.slice(0, 7)) return null;
    return fillText('posted {date} ({month} locked)', { date: dayText(posted), month: monthName(own) });
  }
  var API = { lockedOf: lockedOf, rowOfDay: rowOfDay, nextOpen: nextOpen, closedBy: closedBy, groupsOf: groupsOf, noticeWords: noticeWords, movedWords: movedWords, lateWords: lateWords, dayText: dayText };
  root.CBBankLock = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
