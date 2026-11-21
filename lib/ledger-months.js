/**
 * lib/ledger-months.js — the month bands of one ledger (ACC-381): per calendar month with activity, Σ Dr, Σ Cr and the running close, from the server.
 *
 * OWNER     cb-accounting
 * RISK      money (the bands must add up to the ledger's own totals)
 * OWNS      GET /api/books/ledger/:account `months` — [{ month 'YYYY-MM', debit_minor, credit_minor, closing_minor }] in minor units. One SQL over the same
 *           filters as the ledger's own totals (books-store.pageSums: account · party · range · period 0 left out when the opening already holds it), so the
 *           bands add up to the range's totals and the last closing IS closing_minor; never the loaded page added up (a paged read shows one page only).
 * CALLED BY routes/books.js (the ledger route). A month with no line is not listed; its closing is the previous band's.
 * FLOW      ledger route → monthBands (one SQL, the ledger's filters) → running close per month → months[] on the answer
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';

/** Σ Dr / Σ Cr per posting month over [from, to] for one ledger → [{ month, dr, cr }] oldest first */
async function monthSums(db, e, from, to, account_id, party_id, noOpening) {
  const queryResult = await db.query(
    `/* ledger-months */
     SELECT to_char(h.posting_date, 'YYYY-MM') AS month, SUM(l.dr_minor)::bigint AS dr, SUM(l.cr_minor)::bigint AS cr
       FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = $1
      WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date
        AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5)${noOpening ? ' AND h.period <> 0' : ''}
      GROUP BY 1 ORDER BY 1`,
    [e, from, to, account_id || null, party_id || null]
  );
  return queryResult.rows;
}

/** the bands: the opening carried through each month's Dr − Cr (pure) */
function bands(opening, rows) {
  let run = Number(opening) || 0;
  return rows.map((row) => {
    const debit = Number(row.dr) || 0,
      credit = Number(row.cr) || 0;
    run += debit - credit;
    return { month: row.month, debit_minor: debit, credit_minor: credit, closing_minor: run };
  });
}

module.exports = { monthSums, bands };
