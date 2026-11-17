/**
 * books-store-packs.js — the handover packs' rows: last · insert · list · one · acknowledge (split out of books-store.js, whose size row may not grow; the SQL text is moved, not changed).
 * OWNER     cb-accounting
 * RISK      data
 * OWNS      lastPack · insertPack · packs · pack · ackPack
 * CALLED BY lib/books-store.js (re-exported: lib/books-pack.js and the routes still ask the store)
 * FLOW      db handle from withEntity → one statement on books_pack → the row
 * CARD      16-finance/books-store
 * ⚠️ Nothing here writes journal_entry / journal_line / account_balance / party_item: the ONE journal writer stays lib/books-store.js (tests/books-writer.test.cjs).
 */
'use strict';
/* ── the handover packs ─────────────────────────────────────────────────────────────────────────────────────── */
async function lastPack(db, e) {
  const queryResult = await db.query(`SELECT pack_id, sha256 FROM books_pack WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [e]);
  return queryResult.rows[0] || null;
}
/** record one handover pack (its hash and what it holds) → { pack_id, created_at } */
async function insertPack(db, e, newPack) {
  const queryResult = await db.query(
    `INSERT INTO books_pack (pack_id, entity_id, kind, fiscal_year, period, created_by, sha256, prev_sha256, manifest, storage_path, delivered_at, delete_after)
                            VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9, now(), $10) RETURNING pack_id, created_at`,
    [
      e,
      newPack.kind,
      newPack.fiscal_year || null,
      newPack.period == null ? null : newPack.period,
      newPack.by || null,
      newPack.sha256,
      newPack.prev_sha256 || null,
      JSON.stringify(newPack.manifest),
      newPack.storage_path || null,
      newPack.delete_after || null,
      newPack.pack_id
    ]
  );
  return queryResult.rows[0];
}
async function packs(db, e) {
  const queryResult = await db.query(
    `SELECT pack_id, kind, fiscal_year, period, created_at, sha256, prev_sha256, storage_path, delivered_at, acknowledged_at, acknowledged_by, delete_after
                              FROM books_pack WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [e]
  );
  return queryResult.rows;
}
async function pack(db, e, id) {
  const queryResult = await db.query(`SELECT * FROM books_pack WHERE entity_id = $1 AND pack_id = $2`, [e, id]);
  return queryResult.rows[0] || null;
}
async function ackPack(db, e, id, by) {
  const queryResult = await db.query(
    `UPDATE books_pack SET acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, $3)
                             WHERE entity_id = $1 AND pack_id = $2 RETURNING acknowledged_at`,
    [e, id, by || null]
  );
  return queryResult.rows[0] || null;
}

module.exports = { lastPack, insertPack, packs, pack, ackPack };
