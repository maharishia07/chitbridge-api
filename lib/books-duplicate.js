'use strict';
/**
 * lib/books-duplicate.js — what a repeated source_ref answers: the first entry, and (BA-F-01) whether the books have since reversed it.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      answerOf(seen, day) → the duplicate answer of lib/books duplicateAnswer
 * CALLED BY lib/books.js duplicateAnswer
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * FLOW      the stored entry under the reference (books-store entryBySource, with reversal_entry_no) ──▶ { ok, duplicate: true, entry_id, entry_no, posting_date [, reversed, reversal_entry_no, note] }
 * One entry per reference, ever (journal_entry_src_uq): a reference whose entry was reversed cannot post again, so the answer SAYS it was reversed and the page never reads "already posted" as "in the books".
 */
const answerOf = (seen, day) =>
  Object.assign(
    { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: day },
    seen.reversal_entry_no
      ? { reversed: true, reversal_entry_no: seen.reversal_entry_no, note: 'Entry ' + seen.entry_no + ' was posted under this reference and has since been reversed (' + seen.reversal_entry_no + '). The reference cannot post again: send the line under a new reference.' }
      : {}
  );
module.exports = { answerOf };
