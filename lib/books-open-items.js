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
 *
 * SCOPE (l16-opendocs): the whole entity, or ONE control account as at a day — `opts` = { account: '$2::uuid', asOf: '$3::date' } (SQL fragments, each optional). The scope narrows the rows BEFORE the net, the links and the answer, so a document is open or not
 * as the rows of that account up to that day say; the same status seeds and the same closure over links, never a second filter (store.openItems calls this and nothing else).
 */
function rowsSql(param, opts) {
  const entityParam = param || '$1::uuid',
    o = opts || {},
    scope = (o.account ? ` AND x.account_id = ${o.account}` : '') + (o.asOf ? ` AND (x.doc_date IS NULL OR x.doc_date <= ${o.asOf})` : '');
  return `WITH RECURSIVE net AS (SELECT x.against_ref AS r, sum(x.amount_minor) AS n, bool_or(x.ref_kind = 'status') AS st FROM party_item x WHERE x.entity_id = ${entityParam}${scope} GROUP BY against_ref),
        link AS (SELECT DISTINCT x.ref AS a, x.against_ref AS b FROM party_item x WHERE x.entity_id = ${entityParam}${scope} AND x.ref <> x.against_ref),
        both_ways AS (SELECT a, b FROM link UNION ALL SELECT b, a FROM link),
        live(r) AS (SELECT r FROM net WHERE n <> 0 OR st UNION SELECT w.b FROM live l JOIN both_ways w ON w.a = l.r)
      SELECT x.item_id, x.party_id, x.account_id, x.side, x.ref, x.against_ref, x.ref_kind, x.kind, x.amount_minor, x.pending_minor, x.currency, x.due_date::text AS due_date, x.doc_date::text AS doc_date, x.status, x.reverses, x.reverses_kind, x.entry_id, x.payment_id, x.note, x.created_at
        FROM party_item x JOIN (SELECT DISTINCT r FROM live) l ON l.r = x.against_ref WHERE x.entity_id = ${entityParam}${scope}`;
}

module.exports = { rowsSql };
