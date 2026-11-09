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
 * owns: the live-row predicate
 * called by: lib/books-store (partyOn) · lib/memberships · lib/crm-groups · lib/local-identity · lib/crm-leads · routes/relationships (customer groups)
 * // CARD 11-crm-and-marketing/crm-parties
 */

/** SQL: this list row (alias `alias`) is still one of the shop's parties — not deleted */
const liveSql = (alias) => `to_jsonb(${alias})->>'hidden_at' IS NULL`;

module.exports = { liveSql };
