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
module.exports = { wordsOf, noted };
