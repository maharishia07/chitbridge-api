/**
 * books-store-late.js — the ONE read of tax entries posted after a tax close (ONE-FIGURE RC2; a store file of its own: books-store.js may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      lateTaxEntries(db, e, from, to, after, taxRoles, settleRoles)
 * CALLED BY lib/books-period-taxed.js changedSinceClose
 * FLOW      the close entry's created_at → entries dated in the period, posted after it, with a tax line and another line → carried rows
 * CARD      14-accounting/README
 * created_at is the transaction start: a SIGNAL, not proof (a transaction that began before the close and committed after it is missed; it never flags falsely).
 * Read only. Nothing is worked out here: rows are carried, minor units.
 */
'use strict';
/**
 * the entries dated inside a tax period that were POSTED AFTER its close (created_at later than the close entry's) and carry a line on a tax ledger and a line on something else (a sale, a purchase, a return —
 * not a set-off or a payment, which are tax + money only). → [{ entry_id, dr_minor, cr_minor }] (the tax lines, net per entry)
 */
async function lateTaxEntries(db, e, from, to, after, taxRoles, settleRoles) {
  const result = await db.query(
    `WITH win AS MATERIALIZED (SELECT h.entry_id FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.created_at > $4::timestamptz AND h.is_opening IS NOT TRUE OFFSET 0),
     ln AS MATERIALIZED (SELECT l.entry_id, l.dr_minor, l.cr_minor, a.role FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id WHERE l.entity_id = $1 AND l.entry_id = ANY(ARRAY(SELECT entry_id FROM win)))
     SELECT entry_id, COALESCE(SUM(dr_minor) FILTER (WHERE role = ANY($5::text[])), 0)::bigint AS dr_minor, COALESCE(SUM(cr_minor) FILTER (WHERE role = ANY($5::text[])), 0)::bigint AS cr_minor
       FROM ln GROUP BY entry_id HAVING bool_or(role = ANY($5::text[])) AND NOT bool_and(role = ANY($6::text[]))`,
    [e, from, to, after, taxRoles, settleRoles]
  );
  return result.rows;
}
module.exports = { lateTaxEntries };
