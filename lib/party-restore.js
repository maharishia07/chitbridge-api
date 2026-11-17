'use strict';
/**
 * OWNS      the way back from removeParty: a deleted party's list rows un-hidden on both lists
 * CALLED BY lib/local-identity (addCustomer) · routes/relationships (POST /suppliers)
 * FLOW      restore(conn, owner, party_id) → lib/schema hasColumn('customer_list', 'hidden_at') → UPDATE both lists → how many rows came back
 * CARD      11-crm-and-marketing/crm-parties
 *
 * Kept out of lib/party-live.js on purpose: party-live holds the live-row predicate that the till's DB-free customer-groups reader shares (tests/till-shippable), and this one asks the
 * database (lib/schema), so it lives beside it, not in it.
 */

/**
 * restore(conn, owner, party_id) → how many list rows came back (0 = the party was not deleted). CRM-247 (ATHI-DECISIONS): a NAME match to a deleted party brings the
 * SAME party back, with its bills, journal lines and timeline, instead of a second party with the same name (a phone-only match still adds a new one). It undoes
 * removeParty (lib/crm.js) on both lists, and nothing else. Called on ANY list conflict (a live name match too: then nothing matches and it returns 0), so before b276 (no hidden_at column) it asks lib/schema first and returns 0, never a 42703 that would abort the caller's transaction.
 */
async function restore(conn, owner, party_id) {
  if (!(await require('./schema').hasColumn('customer_list', 'hidden_at'))) return 0;
  let back = 0;
  for (const [table, col] of [['customer_list', 'customer_identity_id'], ['supplier_list', 'supplier_entity_id']]) {
    const moved = await conn.query(`UPDATE ${table} SET hidden_at = NULL WHERE owner_entity_id = $1 AND ${col} = $2 AND hidden_at IS NOT NULL RETURNING 1`, [owner, party_id]);
    back += moved.rows.length;
  }
  return back;
}

module.exports = { restore };
