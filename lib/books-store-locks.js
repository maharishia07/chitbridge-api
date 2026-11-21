/**
 * books-store-locks.js — three small store helpers that live apart because books-store.js's size row may not grow (the text is moved, not changed).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      hasTrading (has the shop posted past its opening) · fxLock (the shop's fx-rate advisory lock) · lockSourceRef (one poster of a source_ref at a time)
 * CALLED BY lib/books-store.js (imported and re-exported: every caller still asks the store)
 * FLOW      db handle from withEntity → one statement (a read, or an advisory lock held to the end of the transaction) → nothing written
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * ⚠️ Nothing here writes journal_entry / journal_line / account_balance / party_item: the ONE journal writer stays lib/books-store.js (tests/books-writer.test.cjs).
 */
'use strict';
/** hasTrading(db, e) → has the shop posted anything past its opening balances? Opening journals are period 0 (periodFigures above); any journal in a month (period 1 and up) means the books are running — the "go-live" line after which only the owner changes the opening (DECISIONS 19 Nov, Bookkeeper) */
const hasTrading = async (db, e) => (await db.query('SELECT 1 FROM journal_entry WHERE entity_id = $1 AND period > 0 LIMIT 1', [e])).rows.length > 0;
/** FX1 race guard: a rate write takes the shop's fx lock EXCLUSIVE and a rate read (fxRateOn) takes it SHARED, both to the end of their transaction — a posting that reads a day's rate and a correction of that rate can no longer interleave (the read waits for the committed correction, or the correction waits for the posting's commit). No-op outside a transaction. */
const fxLock = (db, e, shared) => db.query(`SELECT pg_advisory_xact_lock${shared ? '_shared' : ''}(hashtext($1))`, ['fx_rate:' + e]);
/** R12a: ONE POSTER OF A source_ref AT A TIME — taken before the same-ref read so a racer reads the committed winner, never an empty gap */
const lockSourceRef = (db, e, source_ref) => require('./xact-lock').lockKeys(db, e, ['src|' + source_ref]);
module.exports = { hasTrading, fxLock, lockSourceRef };
