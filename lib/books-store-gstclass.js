/**
 * books-store-gstclass.js — the tax of the entries that ALSO carry a line on given ledger roles (split out of books-store.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      taxOfEntriesWith(db, e, from, to, taxRole, roles) → { net_minor }
 * CALLED BY lib/books-period-taxed.js addTaxedRows (AU BAS G10: the GST of the capital purchases, read from the posted journal, never recomputed)
 * FLOW      db handle from withEntity → ONE statement over the window's entries → the net of their tax-role lines
 * CARD      14-accounting/README
 * A read only: the net (Dr − Cr) of the lines on `taxRole` of the entries in a date range that also have a line on one of `roles`. A reversal carries the same lines the other way, so it nets the posting away.
 * ⚠ the SQL is proved on the in-memory twin here and on a real Postgres by the S41 integration job, not on the laptop.
 */
'use strict';
/** the net (Dr − Cr) of the entity's `taxRole` lines over the entries posted in the date range that also carry a line on one of `roles` (opening entries left out) → { net_minor } */
async function taxOfEntriesWith(db, e, from, to, taxRole, roles) {
  const result = await db.query(
    `SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0)::bigint AS net_minor
       FROM journal_entry h
       JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id
       JOIN ledger_account a ON a.account_id = l.account_id AND a.role = $4
      WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.is_opening IS NOT TRUE
        AND EXISTS (SELECT 1 FROM journal_line c JOIN ledger_account b ON b.account_id = c.account_id
                     WHERE c.entry_id = h.entry_id AND c.entity_id = h.entity_id AND b.role = ANY($5::text[]))`,
    [e, from, to, taxRole, roles]
  );
  return { net_minor: Number((result.rows[0] || {}).net_minor || 0) };
}
/**
 * ACC-417: the Dr and Cr totals of the entity's `taxRole` lines over the entries of the given EVENT TYPES (the pack's returns.adjustments.events: credit note, return, purchase return, write-off), opening entries left out.
 * The event type is stored on every entry, so old entries read too. → { dr_minor, cr_minor }
 */
async function taxOfEvents(db, e, from, to, taxRole, events) {
  const result = await db.query(
    `SELECT COALESCE(SUM(l.dr_minor), 0)::bigint AS dr_minor, COALESCE(SUM(l.cr_minor), 0)::bigint AS cr_minor
       FROM journal_entry h
       JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id
       JOIN ledger_account a ON a.account_id = l.account_id AND a.role = $4
      WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.is_opening IS NOT TRUE AND h.event_type = ANY($5::text[])`,
    [e, from, to, taxRole, events]
  );
  const row = result.rows[0] || {};
  return { dr_minor: Number(row.dr_minor || 0), cr_minor: Number(row.cr_minor || 0) };
}
module.exports = { taxOfEntriesWith, taxOfEvents };
