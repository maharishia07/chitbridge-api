/**
 * lib/offrail-itc.js — V-F-07 (walk V): THE OFF-RAIL PURCHASES' INPUT TAX AS A RETURN ENTRY.
 * OWNER     cb-accounting
 * RISK      money
 * FLOW      the month ledger rows -> the posted tax heads of the off-rail purchases -> one received-purchase entry for the return
 * OWNS      reading the input tax the month's off-rail purchases posted (POST /api/books/events: an expense with a bill, the bank sheet's input_tax_minor; they have NO chit) and giving it to
 *           the month's ledger as ONE received purchase, so GSTR-3B 4(A)(5) and /api/tax/ledger agree with the books (they said 0 beside Input IGST 180.00). Nothing is computed here: the
 *           posted lines are read (postedByRole); a blocked credit posted to cost, so it is not in them. The entry is flagged expense_itc, as ACC-269's (no lines; gstr3b adds it by head).
 * CALLED BY lib/tax-copy.js ledgerFor (the one reader of the month's rows).
 * CARD      14-accounting/gst-returns
 */
'use strict';
const { withEntity } = require('../db');
const { fromMinor } = require('./books-cashflow'); // the api's one minor -> major

/**
 * the input tax the month's off-rail purchases posted, in ONE query: sum (dr - cr) of the unreversed `ev:expense:` entries' lines on the input ROLES given, posted in [from, to). Same rules as
 * books-store.inputTaxOfChits: a reversal posted before `to` takes the entry away, a later one does not. → { <role>: minor } (nothing, or a net credit, is absent).
 */
async function postedByRole(db, shopId, roles, from, to) {
  const found = await db.query(
    `SELECT a.role, SUM(l.dr_minor - l.cr_minor) AS minor
       FROM journal_entry x JOIN journal_line l ON l.entry_id = x.entry_id AND l.entity_id = x.entity_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE x.entity_id = $1 AND x.source_ref LIKE 'ev:expense:%' AND x.reverses_entry_id IS NULL AND a.role = ANY($2::text[])
        AND to_char(x.posting_date, 'YYYY-MM-DD') >= $3 AND to_char(x.posting_date, 'YYYY-MM-DD') < $4
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id AND to_char(r.posting_date, 'YYYY-MM-DD') < $4)
      GROUP BY 1`,
    [shopId, roles, from, to]
  );
  const out = {};
  found.rows.forEach((row) => {
    if (Number(row.minor) > 0) out[row.role] = Number(row.minor);
  });
  return out;
}
/** the pack's input-tax ledger roles by head (the pack's taxLedgers[head].input) */
const rolesOf = (pack) => ['cgst', 'sgst', 'igst', 'cess'].filter((head) => (pack.taxLedgers[head] || {}).input).map((head) => ({ head, role: pack.taxLedgers[head].input }));

/**
 * entriesOf(pack, shopId, month, span, shopParty) → [] or [the one entry]: `pack` is the country pack that reads input tax from the books (tax-copy.expenseItcPack; null = none, so []), `span` { from, to } the month's
 * days ('YYYY-MM-DD', `to` exclusive), `shopParty` the shop as a party. One query for the month.
 */
async function entriesOf(pack, shopId, month, span, shopParty) {
  const wanted = pack ? rolesOf(pack) : [];
  if (!wanted.length) return [];
  const posted = await withEntity(shopId, (db) => postedByRole(db, shopId, wanted.map((item) => item.role), span.from, span.to));
  const byHead = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  wanted.forEach((item) => {
    byHead[item.head] = fromMinor(posted[item.role] || 0, pack.currency);
  });
  if (!(byHead.cgst + byHead.sgst + byHead.igst + byHead.cess > 0)) return [];
  const invoice = { currency: pack.currency, DocDtls: { Typ: 'INV', No: 'offrail-' + month }, ValDtls: { AssVal: 0, CgstVal: byHead.cgst, SgstVal: byHead.sgst, IgstVal: byHead.igst, CesVal: byHead.cess }, ItemList: [] };
  const supplier = { LglNm: 'Purchases and expenses entered in the books', RegType: 'regular', Country: shopParty && shopParty.Country, entity_id: null };
  return [{ chit_id: 'offrail-' + month, direction: 'received', sells: false, me: shopParty, seller: supplier, invoice, provisional: false, expense_itc: true, day: span.from, period_of_record: month, prior_period: null }];
}

module.exports = { entriesOf };
