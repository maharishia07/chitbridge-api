'use strict';
/**
 * lib/books-store-pack.js — the ONE statement that moves a shop's rules version (pack pinning; split out of books-store.js, whose size row may not grow).
 * OWNER     cb-accounting · RISK money
 * OWNS      addPackHistory(db, entity, rows, version)
 * CALLED BY lib/books-pack-pin.js restamp (the audit row is written by the caller, books-store.logChange)
 * CARD      14-accounting/README
 */
/** append dated version rows to books_setting.pack_history and move the stamp to the newest, in the one statement (needs b914) */
async function addPackHistory(db, e, rows, version) {
  await db.query(`UPDATE books_setting SET pack_history = COALESCE(pack_history, '[]'::jsonb) || $2::jsonb, pack_version = $3, updated_at = now() WHERE entity_id = $1`, [e, JSON.stringify(rows), version]);
}
module.exports = { addPackHistory };
