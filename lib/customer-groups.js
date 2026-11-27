// OWNS      which customer groups a viewer carries in a seller's own customer_list (segment or customer:<id>), and which offers those groups may honestly be promised
// FLOW      (seller, viewer) ──▶ groupsOf reads the seller's customer_list with SEGMENT_SQL ──▶ offersFor(offers, groups) ──▶ the offers this viewer may see
/**
 * customer-groups.js — WHAT THE SELLER'S CUSTOMER LIST SAYS ABOUT A VIEWER, as the groups an offer may name.
 *
 * Athi, 2026-09-06: "assume Chola Auto Care is the registered customer of tallytest — can he pass additional off through the
 * link? … so each customer gets a personalised discount." An offer may say "Only for" a GROUP (the customer list's own
 * segments — new · regular · high_value · inactive) or ONE customer ('customer:<identity_id>'). This module answers, for a
 * (seller, viewer) pair, which of those names the viewer carries — read from the seller's OWN customer_list, so it is the
 * seller's word about their customer, never the buyer's claim about themselves (the precondition catalogue-view's
 * visibility tiers insist on). Not on the list → [] → no customer-only offer applies. The public storefront has no viewer
 * and never sees these offers (catalogue-view liveOffers).
 *
 *   SEGMENT_SQL              the one expression both GET /relationships/customers and this reader compute the segment with
 *   groupsOf({ seller_id, viewer_id, withEntity })  → ['customer:<id>', '<segment>'] or []
 *   offersFor(offers, groups) → the offers this viewer may honestly be promised (no customer_group, or one of theirs)
 
 * CALLED BY lib/catalogue-view.js, lib/crm-groups.js, lib/offers-live.js, routes/relationships.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * CARD 07-offers-pricing-and-combos/customer-groups-and-customer-only-offers
 */
'use strict';
const SEGMENTS = ['high_value', 'regular', 'new', 'inactive'];
/**
 * ⭐ THE SEGMENT, in ONE expression. high_value (PLAN Q3, provisional): the shop's top PCT % of customers by their last 12
 * months of BILLS, with at least MIN bills; the owner's override (segment_override) still wins. The value is READ from the
 * Ledger's own rows (party_item: a bill opens +), never a second sum of sales — so it needs the Ledger on; with it off
 * nobody is high_value by rule. `$1` must be the shop (every caller already binds it). A missing party_item (before b273)
 * is 42P01 — callers fall back to SEGMENT_SQL_BASE (below), never fail.
 */
function segmentSql(opt) {
  const o = opt || {};
  const pct = Math.min(100, Math.max(1, Math.floor(Number(o.pct)) || 10)),
    min = Math.max(1, Math.floor(Number(o.minBills)) || 3);
  return `COALESCE(cl.segment_override,
                CASE WHEN cl.customer_identity_id IN (
                       SELECT r.party_id FROM (
                         SELECT pi.party_id, COUNT(*) AS bills,
                                RANK() OVER (ORDER BY SUM(pi.amount_minor) DESC) AS rk, COUNT(*) OVER () AS n
                           FROM party_item pi
                          WHERE pi.entity_id = $1 AND pi.side = 'receivable' AND pi.ref_kind = 'bill' AND pi.amount_minor > 0
                            AND COALESCE(pi.doc_date, pi.created_at::date) >= (CURRENT_DATE - INTERVAL '12 months')
                          GROUP BY pi.party_id) r
                        WHERE r.bills >= ${min} AND r.rk <= CEIL(r.n * ${pct} / 100.0))
                          THEN 'high_value'
                     WHEN cl.last_txn_at < NOW() - INTERVAL '90 days' THEN 'inactive'
                     WHEN cl.txn_count >= 3 THEN 'regular'
                     ELSE 'new' END)`;
}
const SEGMENT_SQL_BASE = `COALESCE(cl.segment_override,
                CASE WHEN cl.last_txn_at < NOW() - INTERVAL '90 days' THEN 'inactive'
                     WHEN cl.txn_count >= 3 THEN 'regular'
                     ELSE 'new' END)`;
const SEGMENT_SQL = segmentSql();
/** a group name as stored: trimmed, single-spaced, ≤ 40 chars; letters · digits · space · - · & · / */
function cleanName(n) {
  const t = String(n == null ? '' : n)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return /^[\p{L}\p{N} &/-]+$/u.test(t) ? t : '';
}
function cleanGroups(arr) {
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((item) => {
    const c = cleanName(item);
    if (c && out.indexOf(c) < 0) out.push(c);
  });
  return out.slice(0, 20);
}
async function groupsOf({ seller_id, viewer_id, withEntity }) {
  if (!seller_id || !viewer_id || String(seller_id) === String(viewer_id)) return [];
  const one = async (withGroups, seg) =>
    withEntity(seller_id, (db) =>
      db.query(
        `SELECT ${seg} AS segment${withGroups ? ', cl.groups' : ''} FROM customer_list cl WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id = $2 LIMIT 1`,
        [seller_id, viewer_id]
      )
    );
  try {
    /* no party_item yet (42P01) → the segment without high_value; no groups column (42703) → segments only */
    const ask = async (g) => {
      try {
        return await one(g, SEGMENT_SQL);
      } catch (e) {
        if (e && e.code === '42P01') return one(g, SEGMENT_SQL_BASE);
        throw e;
      }
    };
    let r;
    try {
      r = await ask(true);
    } catch (e) {
      if (e && e.code === '42703') r = await ask(false);
      else throw e;
    } /* the groups column not migrated yet → segments only */
    const row = r.rows[0];
    if (!row) return [];
    /* ⭐ NAMED GROUPS (decision 2, 2026-09-06): each group the seller placed this customer in, as 'group:<name>' — the value an offer's "Only for" stores */
    const named = (Array.isArray(row.groups) ? row.groups : []).map((item) => 'group:' + String(item));
    return ['customer:' + String(viewer_id), String(row.segment)].concat(named);
  } catch (_) {
    return [];
  } /* no table, no row, no migration → not a customer → no extra promise */
}
/** the seller's group names (every name any customer is in), and whether the column exists */
async function namesOf({ seller_id, withEntity }) {
  try {
    const r = await withEntity(seller_id, (db) =>
      db.query(`SELECT DISTINCT unnest(groups) AS name FROM customer_list WHERE owner_entity_id = $1 ORDER BY 1`, [seller_id])
    );
    return { names: r.rows.map((x) => x.name).filter(Boolean), migrated: true };
  } catch (e) {
    return { names: [], migrated: !(e && e.code === '42703') ? false : false };
  }
}
function offersFor(offers, groups) {
  const gs = (Array.isArray(groups) ? groups : []).map(String);
  return (offers || []).filter((item) => !item.customer_group || gs.indexOf(String(item.customer_group)) >= 0);
}
/**
 * ONE-CUSTOMER (1138) · THE ONE READER OF "IS X A CUSTOMER OF THIS SHOP". A party may be both supplier and customer (ACC-new-1): it is a customer of the shop when it is on
 * customer_list AND (not also a supplier, OR the shop has sent it a sales bill). Every place that decides the role uses this and nothing else: the customers list and Home count
 * (CUSTOMER_ROLE_SQL), and the send step that files a receiver (receiverBecomesCustomer, which asks rail-actions.receiverIsCustomer for the chit's DIRECTION, so the rule stays one).
 * tests/one-customer-1138.test.cjs fails when another module writes its own supplier/customer predicate.
 */
const SALES_BILLS = ['invoice', 'credit_note', 'debit_note']; /* the documents a shop ISSUES AS THE SELLER: receiving one makes the receiver a customer, even when it is also a supplier */
const SALES_BILLS_SQL = SALES_BILLS.map((x) => `'${x}'`).join(', ');
/** the owner has SENT this party a sales bill (a draft is not sent); $1 = the owner, cl.customer_identity_id = the party */
const SENT_A_SALES_BILL_SQL = `EXISTS (SELECT 1 FROM chit_header ch WHERE ch.entity_id = $1 AND ch.sender_entity_id = $1 AND ch.direction = 'sent' AND ch.sent_at IS NOT NULL AND ch.role <> 'Draft'
           AND ch.purpose IN (${SALES_BILLS_SQL}) AND ch.all_recipients @> jsonb_build_array(jsonb_build_object('entity_id', cl.customer_identity_id::text)))`;
/** a row of the owner's customer_list that counts as a CUSTOMER: not a supplier, or a supplier the owner has billed ($1 = the owner; alias cl = customer_list) — GET /relationships/customers and the Home count */
const CUSTOMER_ROLE_SQL = `(NOT EXISTS (SELECT 1 FROM supplier_list sl WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = cl.customer_identity_id) OR ${SENT_A_SALES_BILL_SQL})`;
/** the send step's question: does this SENT chit file `receiverId` as a customer of the sender? (db is the sender's withEntity client) → boolean
 *  the chit's direction first (a buyer's order never makes its seller a customer), then the supplier gate: a supplier becomes a customer only through a sales bill */
async function receiverBecomesCustomer(db, sendState, receiverId) {
  if (!require('./rail-actions').receiverIsCustomer(sendState)) return false;
  const sender = sendState.sender_id;
  const isSupplier = await db.query('SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2', [sender, receiverId]);
  return isSupplier.rows.length === 0 || SALES_BILLS.includes(String(sendState.purpose || ''));
}

/** a shop is never its own customer or supplier: chits it sent to itself (recipients [{self:true}], the books' own expense source chits) put its own id on the list; party reads leave that row out, as lib/crm.rows does ($1 = the owner) */
const NOT_SELF_CUSTOMER_SQL = 'cl.customer_identity_id <> $1';
const NOT_SELF_SUPPLIER_SQL = 'sl.supplier_entity_id <> $1';

/** replace a LIVE customer's group set (CRM-247: a deleted customer matches no row, so the route answers 404 like a stranger) → the pg result (0 or 1 row) */
const setGroups = (db, owner, customer_list_id, groups) =>
  db.query(`UPDATE customer_list SET groups = $1 WHERE customer_list_id = $2 AND owner_entity_id = $3 AND ${require('./party-live').liveSql('customer_list')} RETURNING customer_list_id, groups`, [
    groups,
    customer_list_id,
    owner
  ]);

module.exports = { setGroups, CUSTOMER_ROLE_SQL, SALES_BILLS, receiverBecomesCustomer, NOT_SELF_CUSTOMER_SQL, NOT_SELF_SUPPLIER_SQL, SEGMENTS, SEGMENT_SQL, SEGMENT_SQL_BASE, segmentSql, groupsOf, offersFor, namesOf, cleanGroups, cleanName };
