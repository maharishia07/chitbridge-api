'use strict';
/**
 * lib/books-input-tax-unanswered.js — Q3 of ACC-355 (critic 18 Nov): a READ-ONLY list for the adviser of the input tax already posted while the buyer's registration was not answered.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      the one read: every standing entry that debited an input-tax ledger, while the shop's registration was NOT 'regular' and either still unknown or answered only AFTER the entry was posted;
 *           the figures are the entry's own (dr_minor on the input-tax ledgers, the line's currency): nothing is computed, corrected or posted here (no migration, no auto-correct).
 * CALLED BY routes/books.js (GET /input-tax-unanswered)
 * FLOW      registrationOfShop (the ONE reader) + country-setup profile (set_at = when the answer was last saved) → ONE page query over journal_entry / journal_line / ledger_account → rows
 * CARD      14-accounting/books-buyer-credit
 * WHY       before the one gate (lib/books-buyer-credit, engines v1.99.0) a purchase or expense claimed its input tax whatever the shop's registration; an entry posted then stays (books are INSERT-only).
 *           The adviser reads this list and decides: a reversal and re-post, or one journal, never an automatic correction (a lodged period is never moved by us). A shop that is registered ('regular') claimed
 *           rightly, so its list is empty. A shop that answered 'not registered' or 'composition' lists what was posted at or before its answer (set_at); a shop that has not answered lists every one.
 */
const isInputRole = "(a.role = 'gst_paid' OR a.role LIKE 'input\_%')";

/** the shop's own answer and the moment it was saved: { registration, answered_at } — registration is 'regular' | 'composition' | 'unregistered' | 'unknown' (nothing read = 'regular': the migration is not run, nobody was asked) */
async function answerOf(handle, entity) {
  const CS = require('./country-setup');
  const registration = (await CS.registrationOfShop(entity)) || 'regular';
  const profile = await CS.profile(handle, entity, { constitution: false }).catch(() => null);
  return { registration, answered_at: profile && profile.set_at ? profile.set_at : null };
}

/**
 * unanswered(handle, entity, { page, limit, currency }) → { registration, answered_at, rows: [{ entry_id, entry_no, posting_date, amount_minor, currency, party_id, party_name }], total, page, limit }
 * Sorted oldest first (the entry's own posting date, then number). A reversed entry and a reversal are not listed. One page query (the total rides on it), then ONE name read for the page's parties.
 */
async function unanswered(handle, entity, ask) {
  const { page, limit } = ask;
  const state = await answerOf(handle, entity);
  const out = { registration: state.registration, answered_at: state.answered_at, rows: [], total: 0, page, limit };
  if (state.registration === 'regular') return out;
  const found = await handle.query(
    `SELECT x.entry_id, x.entry_no, to_char(x.posting_date, 'YYYY-MM-DD') AS posting_date, SUM(l.dr_minor)::bigint AS amount_minor, MIN(l.currency) AS currency, COUNT(DISTINCT l.currency)::int AS currencies,
            (ARRAY_AGG(DISTINCT p.party_id) FILTER (WHERE p.party_id IS NOT NULL))[1] AS party_id, COUNT(*) OVER () AS total_rows
       FROM journal_entry x
       JOIN journal_line l ON l.entity_id = x.entity_id AND l.entry_id = x.entry_id AND l.dr_minor > 0
       JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id AND ${isInputRole}
       LEFT JOIN journal_line p ON p.entity_id = x.entity_id AND p.entry_id = x.entry_id AND p.party_id IS NOT NULL
      WHERE x.entity_id = $1 AND x.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
        AND ($2::timestamptz IS NULL OR x.created_at < $2::timestamptz)
      GROUP BY x.entry_id, x.entry_no, x.posting_date
      ORDER BY x.posting_date, x.entry_no
      LIMIT $3 OFFSET $4`,
    [entity, state.registration === 'unknown' ? null : state.answered_at, limit, (page - 1) * limit]
  );
  const names = await require('./books-daybook').partyNames(handle, entity, found.rows.map((row) => row.party_id).filter(Boolean));
  out.total = found.rows.length ? Number(found.rows[0].total_rows) : 0;
  out.rows = found.rows.map((row) => ({
    entry_id: row.entry_id,
    entry_no: row.entry_no,
    posting_date: row.posting_date,
    amount_minor: Number(row.amount_minor),
    currency: row.currencies > 1 ? '*mixed*' : row.currency,
    party_id: row.party_id || null,
    party_name: row.party_id && names.get(String(row.party_id)) ? names.get(String(row.party_id)).name || names.get(String(row.party_id)).nickname || null : null
  }));
  return out;
}

module.exports = { unanswered, answerOf };
