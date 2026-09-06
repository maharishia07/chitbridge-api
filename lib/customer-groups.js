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
 */
'use strict';
const SEGMENTS = ['high_value', 'regular', 'new', 'inactive'];
const SEGMENT_SQL = `COALESCE(cl.segment_override,
                CASE WHEN cl.last_txn_at < NOW() - INTERVAL '90 days' THEN 'inactive'
                     WHEN cl.txn_count >= 3 THEN 'regular'
                     ELSE 'new' END)`;
/** a group name as stored: trimmed, single-spaced, ≤ 40 chars; letters · digits · space · - · & · / */
function cleanName(n) { const t = String(n == null ? '' : n).replace(/\s+/g, ' ').trim().slice(0, 40); return /^[\p{L}\p{N} &\/-]+$/u.test(t) ? t : ''; }
function cleanGroups(arr) { const out = []; (Array.isArray(arr) ? arr : []).forEach((g) => { const c = cleanName(g); if (c && out.indexOf(c) < 0) out.push(c); }); return out.slice(0, 20); }
async function groupsOf({ seller_id, viewer_id, withEntity }) {
  if (!seller_id || !viewer_id || String(seller_id) === String(viewer_id)) return [];
  const one = async (withGroups) => withEntity(seller_id, (db) => db.query(
    `SELECT ${SEGMENT_SQL} AS segment${withGroups ? ', cl.groups' : ''} FROM customer_list cl WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id = $2 LIMIT 1`,
    [seller_id, viewer_id]));
  try {
    let r; try { r = await one(true); } catch (e) { if (e && e.code === '42703') r = await one(false); else throw e; }   /* the groups column not migrated yet → segments only */
    const row = r.rows[0]; if (!row) return [];
    /* ⭐ NAMED GROUPS (decision 2, 2026-09-06): each group the seller placed this customer in, as 'group:<name>' — the value an offer's "Only for" stores */
    const named = (Array.isArray(row.groups) ? row.groups : []).map((g) => 'group:' + String(g));
    return ['customer:' + String(viewer_id), String(row.segment)].concat(named);
  } catch (_) { return []; }   /* no table, no row, no migration → not a customer → no extra promise */
}
/** the seller's group names (every name any customer is in), and whether the column exists */
async function namesOf({ seller_id, withEntity }) {
  try {
    const r = await withEntity(seller_id, (db) => db.query(`SELECT DISTINCT unnest(groups) AS name FROM customer_list WHERE owner_entity_id = $1 ORDER BY 1`, [seller_id]));
    return { names: r.rows.map((x) => x.name).filter(Boolean), migrated: true };
  } catch (e) { return { names: [], migrated: !(e && e.code === '42703') ? false : false }; }
}
function offersFor(offers, groups) {
  const gs = (Array.isArray(groups) ? groups : []).map(String);
  return (offers || []).filter((o) => !o.customer_group || gs.indexOf(String(o.customer_group)) >= 0);
}
module.exports = { SEGMENTS, SEGMENT_SQL, groupsOf, offersFor, namesOf, cleanGroups, cleanName };
