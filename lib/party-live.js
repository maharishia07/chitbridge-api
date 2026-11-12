// @stage tested
// @stage-note [CB CRM] CRM-247/248: the ONE place that knows a party is DELETED (removed from the shop's parties).
'use strict';
/**
 * lib/party-live.js — WHAT "DELETED" MEANS FOR A PARTY, ONCE.
 *
 * A party is deleted when `hidden_at` is set on its list row (lib/crm.js removeParty, "Remove from my parties", Q10): a SOFT delete — the row,
 * the bills, the journal lines and the timeline stay, and nothing else about the party changes. There is no stage and no deleted_at.
 * A party is LIVE on a list while that list's row has no hidden_at. Deleted = it has list rows and none of them is live.
 * ⚠️ `hidden_at` is read through to_jsonb, like every other reader of b276's column (lib/crm.js): before the column exists nothing is hidden, never a 42703.
 *
 * Every door that WRITES about a party, and every matcher that looks a party up by phone, asks THIS fragment (books-store.partyOn is the
 * door lookup; memberships · crm-groups · local-identity.customerByPhone · crm-leads import are the other readers) — no door re-spells it.
 * Reads of history are not asked: a deleted party's statement, bills and timeline stay readable to the owner (the route says what it hides).
 *
 * owns: the live-row predicate · its mirror (hiddenSql) · restore (the way back from removeParty)
 * FLOW  liveSql(alias) → the SQL each reader appends to its list-row read
 * called by: lib/books-store (partyOn) · lib/memberships · lib/crm-groups · lib/local-identity · lib/crm-leads · routes/relationships (customer groups)
 * // CARD 11-crm-and-marketing/crm-parties
 */

/** SQL: this list row (alias `alias`) is still one of the shop's parties — not deleted */
const liveSql = (alias) => `to_jsonb(${alias})->>'hidden_at' IS NULL`;

/** SQL: this list row (alias `alias`) is DELETED — the mirror of liveSql, never a second spelling of the column */
const hiddenSql = (alias) => `to_jsonb(${alias})->>'hidden_at' IS NOT NULL`;

/**
 * restore(conn, owner, party_id) → how many list rows came back (0 = the party was not deleted). CRM-247 (ATHI-DECISIONS): a NAME match to a deleted party brings the
 * SAME party back, with its bills, journal lines and timeline, instead of a second party with the same name (a phone-only match still adds a new one). It undoes
 * removeParty (lib/crm.js) on both lists, and nothing else. Only called after a read found a hidden row, so the column is there (never a 42703).
 */
async function restore(conn, owner, party_id) {
  let back = 0;
  for (const [table, col] of [['customer_list', 'customer_identity_id'], ['supplier_list', 'supplier_entity_id']]) {
    const moved = await conn.query(`UPDATE ${table} SET hidden_at = NULL WHERE owner_entity_id = $1 AND ${col} = $2 AND hidden_at IS NOT NULL RETURNING 1`, [owner, party_id]);
    back += moved.rows.length;
  }
  return back;
}

/** the keys an add's answer carries when a NAME brought a deleted party back: the code the client branches on, and the sentence (spread AFTER `message`, so it replaces "added"); nothing when it was a new add */
const restoredAnswer = (restored, name) => (restored ? { restored: true, message: name + ' was on your list before and had been removed. They are back, with their old record.' } : {});

module.exports = { liveSql, hiddenSql, restore, restoredAnswer };
