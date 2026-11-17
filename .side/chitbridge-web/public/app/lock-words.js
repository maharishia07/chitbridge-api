/**
 * lock-words.js — W15-97: WHO LOCKED A MONTH, WHEN, WHO OPENED IT AGAIN AND WHY, in words. ONE reader of GET /api/books/periods' `lock_trail`, `locked_at`, `open_below_locked`, `lock.first` and `reopen.first`.
 *
 * OWNS      the sentences of a month's lock history (the owner's Month lock page and the auditor's Months view say the same words) · the sentence of the month a Lock or an Open again waits for
 * CALLED BY cap-books.js (Month lock) · books-grant-view.js (the auditor's Months) · loaded by accounts.html and network.html
 * FLOW      whoOf(row, state) → { line, note, all[] } · whyOf(row, 'lock'|'reopen', monthNames) → the sentence
 * ⭐ NOTHING IS RE-DERIVED: names, days and reasons are the server's rows; a month locked before the trail existed has only locked_at, so the line says "Locked · day" and leaves the name out rather than guess it.
 *   CBLockWords.eventWords · .whoOf · .whyOf · .stateWord
 * CARD      16-finance/month-lock
 */
(function (root) {
  'use strict';
  function sayWords(sentence, holes) {
    var text = typeof root.tx === 'function' ? root.tx(sentence) : sentence;
    Object.keys(holes || {}).forEach(function (key) { text = text.split('{' + key + '}').join(holes[key]); });
    return text;
  }
  /** E14: a lock's moment is read in the SHOP's day (helpers shopDay: the shop's zone), never cut to its UTC date, so a lock made at 05:30 on 17 Nov reads 17 Nov */
  function dayOf(iso) {
    var text = String(iso || '');
    if (!text) return '—';
    try {
      if (typeof root.shopDay === 'function') return root.shopDay(text);
      return root.CBLocale && root.CBLocale.date ? root.CBLocale.date(text.slice(0, 10)) : text.slice(0, 10);
    } catch (_) {
      return text.slice(0, 10);
    }
  }
  /** E13: ONE word per month state, from the server's state names (GET /periods status): the owner's Month lock page and the firm's Months say the same */
  var STATE = { open: 'Open', soft_locked: 'Locked', hard_locked: 'Closed for good' };
  function stateWord(status) {
    return sayWords(STATE[status] || String(status || ''));
  }
  /** one trail row → "Locked by Eastlake owner · 15 Nov 2026" · "Opened again by Pat Lee · 3 Oct 2026 · Why: late bill" · "Closed for good by … · …" */
  function eventWords(ev) {
    var holes = { who: ev.by_name || '', date: dayOf(ev.at) };
    if (ev.action === 'unlocked') return (ev.by_name ? sayWords('Opened again by {who} · {date}', holes) : sayWords('Opened again · {date}', holes)) + (ev.reason ? ' · ' + sayWords('Why: {reason}', { reason: ev.reason }) : '');
    if (ev.to === 'hard_locked') return ev.by_name ? sayWords('Closed for good by {who} · {date}', holes) : sayWords('Closed for good · {date}', holes);
    return ev.by_name ? sayWords('Locked by {who} · {date}', holes) : sayWords('Locked · {date}', holes);
  }
  /** the month's own line: its last trail row, else (a month locked before the trail) the lock's own moment; '' when nobody ever touched it */
  function whoLine(row, state, last) {
    if (last) return eventWords(last);
    var locked = state === 'soft_locked' || state === 'hard_locked';
    return locked && row && row.locked_at ? eventWords({ action: 'locked', to: state, at: row.locked_at, by_name: null }) : '';
  }
  /** why an open month still cannot be locked or reopened: a later month stays locked */
  function whoNote(row, state, last) {
    var locked = state === 'soft_locked' || state === 'hard_locked';
    if (locked || !row || !row.open_below_locked) return '';
    return sayWords(last && last.action === 'unlocked' ? 'Later months stay locked.' : 'A later month is locked.');
  }
  /** the month's line under its state and its whole history (newest first): { line, note, all } — line is '' when nobody ever touched the month; note says why an open month sits under locked ones */
  function whoOf(row, state) {
    var trail = (row && row.lock_trail) || [],
      last = trail[trail.length - 1] || null;
    return { line: whoLine(row, state, last), note: whoNote(row, state, last), all: trail.slice().reverse().map(eventWords) };
  }
  /** the month a Lock or Open again waits for, in the shop's month names ("July 2026"); '' when the server named none */
  function firstMonthName(part, monthNames) {
    var at = part && part.first;
    return at ? ((monthNames || [])[Number(at.period) - 1] || '') + ' ' + String(at.start_date || '').slice(0, 4) : '';
  }
  /** "Lock July 2026 first." / "Open September 2026 first." — the month a Lock or Open again waits for, in the shop's own month names (the list is in financial-year order, index = period - 1); the server's sentence when it names none */
  function whyOf(row, kind, monthNames) {
    var part = row && row[kind],
      name = firstMonthName(part, monthNames);
    if (!part || !part.why) return '';
    if (!name.trim()) return sayWords(part.why);
    if (kind === 'lock') return sayWords('Lock {month} first.', { month: name });
    return /closed for good/.test(part.why) ? sayWords(part.why) : sayWords('Open {month} first.', { month: name });
  }
  root.CBLockWords = { eventWords: eventWords, whoOf: whoOf, whyOf: whyOf, stateWord: stateWord };
})(typeof window !== 'undefined' ? window : globalThis);
