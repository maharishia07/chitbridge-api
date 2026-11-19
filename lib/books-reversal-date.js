'use strict';
/**
 * lib/books-reversal-date.js — H-h2-003: a person's reversal never lands AHEAD of the shop's day.
 * OWNS      notAhead(setting, orig, entryEvent, when) → `when`, or a refusal in words (code REVERSAL_MONTH_LOCKED) · the ONE future rule it asks is books-hooks.dayOf + the same "later than tomorrow" test as books.futureGate
 * CALLED BY lib/books.js writeReversal (the one reversal writer)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * FLOW      writeReversal dates the reversal in the original's month, else on the first open day → when that day is still ahead of the shop's day (a typed journal that far ahead is refused) the owner's or a firm's reversal is refused, nothing posted; automatic reversals (a cancelled bill, a bounced cheque) keep the first open day.
 * ⚠️ Law is not a switch: this changes when a correction may be dated, never what a reversal is.
 */
const CLOCK = require('./shop-clock');
const E = require('./books-engines');

/** the refusal object books.refuse builds, made here so books.js does not grow */
function notAhead(setting, orig, entryEvent, when) {
  if (entryEvent.owner !== true || !when.moved) return when;
  const today = require('./books-hooks').dayOf(CLOCK.now(), setting);
  if (!today || when.date <= E.addDays(today, 1)) return when;
  const err = new Error('That entry is in a locked month and the next open month starts on ' + when.date + ', which has not come yet. Open the locked month again (with a reason), then reverse ' + orig.entry_no + '.');
  err.code = 'REVERSAL_MONTH_LOCKED';
  err.status = 422;
  err.refused = true;
  throw err;
}
module.exports = { notAhead };
