// @stage tested
// @stage-note the ONE transaction-scoped lock statement (PAY-FIX C3): pg_advisory_xact_lock(hashtext(key)) — tests/pay-fix.test.cjs
'use strict';
/**
 * lib/xact-lock.js — ONE HOLDER AT A TIME, UNTIL THE TRANSACTION ENDS.
 *
 * OWNS       the advisory-lock statement: SELECT pg_advisory_xact_lock(hashtext($1 || '|' || $2)) — the shop, then the key. Postgres releases it when the caller's
 *            transaction commits or rolls back — nothing here has to remember to unlock.
 * CALLED BY  lib/reward-store.lockOn (a customer's points balance) · lib/books-store.lockParty (a party's open items, C3:
 *            two payments recorded at once could both settle the same bill — the second read must wait for the first write).
 * FLOW       keys → sorted (two holders taking the same two keys never deadlock) → one statement each, on the caller's handle
 * CARD 16-finance/xact-lock
 */
/* the shop is $1 on every statement the books send (tests/books-store-sql: a second fence behind RLS) — the key is scoped to it */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext($1 || '|' || $2))";

/** take every key of this shop, in one order, on the caller's transaction handle — a second holder of any key waits here until the first commits */
async function lockKeys(db, entity_id, keys) {
  for (const key of keys.slice().sort()) await db.query(LOCK_SQL, [entity_id, key]);
}

module.exports = { lockKeys, LOCK_SQL };
