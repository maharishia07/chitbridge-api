'use strict';
/**
 * lib/party-grant-view.js — WHAT A FIRM SEAT READS OF A CLIENT'S PARTIES UNDER A BOOKS GRANT (CON-165, Athi 27 Nov: "firms can see client customers read-only").
 * OWNS      the allow-list of keys a party row keeps for a grant reader · the cut of a list answer and of one record.
 * CALLED BY routes/crm.js (GET /parties and GET /parties/:id, only when req.acting_for_grant is set by middleware/books-grant).
 * FLOW      the route reads the rows as the member (crm.list / crm.one, READ ONLY) → cutParty keeps the allow-listed keys → the answer.
 * CARD      11-crm-and-marketing/crm-parties
 * ⚠️ AN ALLOW-LIST, NOT A DELETE-LIST: the consent every grant was given under says the firm cannot see customer or supplier phone numbers or bank details (lib/books-grants-contract.js),
 *    so phone, e-mail, sign-in contact, consent rows, follow-ups, points, notes and walk-in phones are never kept. A new party key is born cut until it is listed here.
 */
const KEEP = ['party_id', 'display_name', 'name', 'nickname', 'legal_name', 'party_no', 'kind', 'roles', 'state_code', 'city', 'status', 'tax_ids', 'terms', 'dues', 'last_activity', 'overdue', 'late', 'on_rail'];
const CUSTOMER_KEEP = ['segment', 'txn_count', 'last_txn_at', 'customer_type'];
const SUPPLIER_KEEP = ['category', 'supply_kind', 'preferred'];
const pick = (from, keys) => keys.reduce((out, key) => (from && from[key] !== undefined ? Object.assign(out, { [key]: from[key] }) : out), {});

/** one party row as a grant reader sees it */
function cutParty(party) {
  const out = pick(party, KEEP);
  if (party.customer) out.customer = pick(party.customer, CUSTOMER_KEEP);
  if (party.supplier) out.supplier = pick(party.supplier, SUPPLIER_KEEP);
  if (party.lead) out.lead = { stage: party.lead.stage };
  return out;
}
/** the answer of GET /parties: the page and its envelope, the cut rows, no walk-ins (bare phone numbers with no party), every action refused with the one sentence */
function cutList(listed, may) {
  return { parties: listed.parties.map(cutParty), walk_ins: [], count: listed.count, total: listed.total, page: listed.page, limit: listed.limit, next: listed.next, truncated: listed.truncated, alerts: listed.alerts, may };
}
/** the answer of GET /parties/:id: the cut row, nothing the owner keeps about the person */
function cutRecord(party, mergedFrom, may) {
  return Object.assign(cutParty(party), { merged_from: mergedFrom || null, may });
}
/** CON-165: the relationships lists (/api/relationships/customers and /suppliers) are the party PICKERS of the books screens: the same cut, by their own allow-lists (ids, names, numbers, terms, tax ids, dues; no contact, no groups, no notes, no offers) */
const CUSTOMER_ROW_KEEP = ['customer_list_id', 'customer_identity_id', 'display_name', 'nickname', 'legal_name', 'party_no', 'segment', 'txn_count', 'last_txn_at', 'customer_type', 'on_rail', 'state_code', 'tax_ids', 'credit_days', 'credit_limit_minor', 'balance_minor', 'oldest_due', 'cost_hidden'];
const SUPPLIER_ROW_KEEP = ['supplier_list_id', 'supplier_entity_id', 'display_name', 'legal_name', 'party_no', 'category', 'preferred', 'on_rail', 'state_code', 'tax_ids', 'credit_days', 'credit_limit_minor', 'balance_minor', 'oldest_due', 'cost_hidden'];
const cutRows = (rows, keep) => (rows || []).map((row) => pick(row, keep));
/** the answer of a relationships list under a grant: the cut rows inside the one pager envelope the route already built (key = customers | suppliers) */
function cutRelations(answer, key) {
  const keep = key === 'customers' ? CUSTOMER_ROW_KEEP : SUPPLIER_ROW_KEEP;
  return Object.assign({}, answer, { [key]: cutRows(answer[key], keep), groups_migrated: undefined });
}
/** the query keys a grant reader may send; any other (with=consent, view=leads) is dropped */
const QUERY_KEEP = ['q', 'page', 'limit'];
const WHY = "You are reading this client's parties. Only the client can change them.";
const readOnlyMay = () => ({ write: { may: false, code: 'read_only', why: WHY }, remove: { ok: false, code: 'OWNER_ONLY', why: WHY }, assign: { ok: false, code: 'CHIT_NOT_PERMITTED', why: WHY } });
module.exports = { CUSTOMER_ROW_KEEP, SUPPLIER_ROW_KEEP, cutRelations, KEEP, QUERY_KEEP, cutParty, cutList, cutRecord, readOnlyMay, WHY };
