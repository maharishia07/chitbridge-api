// OWNS      the ONE wording of the note a late-posted line carries: "<narration> — <Month> locked" (a line dated in a locked month, posted on the first day of the next open one, its own date kept as doc_date).
// CALLED BY lib/books.js composeEntry (every entry the owner or the accountant moved with if_locked: 'next_open' — POST /events and POST /payments alike).
// FLOW      narration + the line's own day → noted() → the narration the journal row stores; the web reads the two dates back ("posted 1 Oct 2026 (September locked)").
// CARD      16-finance/bank-reconciliation-and-bank-rail
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** the note for the month a day falls in: "September locked" ('' when the day is not a day) */
function wordsOf(iso) {
  const month = MONTHS[Number(String(iso || '').slice(5, 7)) - 1];
  return month ? month + ' locked' : '';
}
/** the narration with the note after it; one note only (a page that already added it is left as it is) */
function noted(narration, iso) {
  const note = wordsOf(iso),
    text = String(narration || '').trim();
  if (!note || text.slice(-note.length) === note) return text || null;
  return text ? text + ' — ' + note : note;
}
/** YEARCLOSE: a correction of a closed year that lands in the open one (when.moved, another financial year) says so: "<narration> — Prior-period correction (FY 2023-24)"; one note only */
function priorPeriod(narration, originalFy, when) {
  const text = String(narration || '').trim();
  if (!when || !when.moved || !originalFy || !when.fy || String(originalFy) === String(when.fy)) return text || null;
  const note = 'Prior-period correction (FY ' + originalFy + ')';
  return text.includes(note) ? text : text ? text + ' — ' + note : note;
}
/** "28 Nov" from a YYYY-MM-DD day ('' when it is not one) */
function shortDay(iso) {
  const month = MONTHS[Number(String(iso || '').slice(5, 7)) - 1];
  return month ? Number(String(iso).slice(8, 10)) + ' ' + month.slice(0, 3) : '';
}
/**
 * AC-F-02 (walk AC 1129; Xero / QuickBooks lock-date practice): a document dated in a locked month is posted on the first open day, and says so in words:
 * "Dated 28 Nov; November is locked, so it is in the books on 1 Dec". ONE sentence for every view that shows the posted day (the entry's note, the Dues row,
 * the VAT return note). '' when the day did not move or either day is not a day.
 */
function movedWords(docIso, postedIso) {
  const was = shortDay(docIso),
    now = shortDay(postedIso),
    month = MONTHS[Number(String(docIso || '').slice(5, 7)) - 1];
  if (!was || !now || !month || String(docIso).slice(0, 10) === String(postedIso).slice(0, 10)) return '';
  return 'Dated ' + was + '; ' + month + ' is locked, so it is in the books on ' + now;
}
/** the narration with the moved sentence after it; one sentence only */
function notedMoved(narration, docIso, postedIso) {
  const note = movedWords(docIso, postedIso),
    text = String(narration || '').trim();
  if (!note || text.includes(note)) return text || null;
  return text ? text + ' — ' + note : note;
}
module.exports = { wordsOf, noted, priorPeriod, movedWords, notedMoved };
