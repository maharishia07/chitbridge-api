'use strict';
// OWNS      the ONE definition of "the open documents of a shop" as party_item rows (rowsSql): what dues, ageing and the cash view need, and none of a settled history
// CALLED BY lib/books-practice.js (practice health); the same rows are what Receivables / Payables / Who owes whom read when they stop reading every row ever written (finance's /dues lane widens THIS, never a second filter)
// FLOW      entity → live documents (net of their rows is not nothing, or a status row) → closed over their allocation links, both ways → the rows of those documents
// CARD      16-finance/collections-and-dues
// MR        better: a new, small module (the one definition) instead of a second WHERE in each reader
/**
 * 5-YEAR GROWTH (l16-scale) · THE OPEN DOCUMENTS OF A SHOP, as party_item rows: the SQL of a SELECT (the entity as `param`, e.g. '$1::uuid') that answers every row of every document that still matters to dues, ageing and cash —
 * and none of a settled history. A document (a bill, a payment, a cheque) is LIVE when its rows do not net to nothing (money left, or a payment not fully applied) or when it carries a status row (a cheque step, a dispute);
 * the rows linked to a live document by an allocation are live too, then those documents' other links, to the end, so both ends of every allocation are live or neither (a pair is never split — the engine refuses a lone half; a row is read by the document it is against). A bill and the payment that settled it,
 * both netting to nothing and linked to nothing live, are not read. The ENGINE then runs on these rows exactly as on all of them: netOpen / dues / the cash view answer the same, because a document netting to nothing adds nothing
 * to any bucket, any owed total or any unapplied credit (proved against the full set in tests/open-items.test.cjs).
 */
function rowsSql(param) {
  const p = param || '$1::uuid';
  return `WITH RECURSIVE net AS (SELECT against_ref AS r, sum(amount_minor) AS n, bool_or(ref_kind = 'status') AS st FROM party_item WHERE entity_id = ${p} GROUP BY against_ref),
        link AS (SELECT DISTINCT ref AS a, against_ref AS b FROM party_item WHERE entity_id = ${p} AND ref <> against_ref),
        both_ways AS (SELECT a, b FROM link UNION ALL SELECT b, a FROM link),
        live(r) AS (SELECT r FROM net WHERE n <> 0 OR st UNION SELECT w.b FROM live l JOIN both_ways w ON w.a = l.r)
      SELECT item_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency, due_date::text AS due_date, doc_date::text AS doc_date, status, reverses, reverses_kind, entry_id, payment_id, created_at
        FROM party_item WHERE entity_id = ${p} AND against_ref IN (SELECT r FROM live)`;
}

module.exports = { rowsSql };
