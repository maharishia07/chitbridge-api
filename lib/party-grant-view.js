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
/** the query keys a grant reader may send; any other (with=consent, view=leads) is dropped */
const QUERY_KEEP = ['q', 'page', 'limit'];
const WHY = "You are reading this client's parties. Only the client can change them.";
const readOnlyMay = () => ({ write: { may: false, code: 'read_only', why: WHY }, remove: { ok: false, code: 'OWNER_ONLY', why: WHY }, assign: { ok: false, code: 'CHIT_NOT_PERMITTED', why: WHY } });
module.exports = { KEEP, QUERY_KEEP, cutParty, cutList, cutRecord, readOnlyMay, WHY };
