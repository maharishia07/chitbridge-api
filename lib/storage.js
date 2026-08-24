// Platform-INDEPENDENT attachment storage (StorageAdapter).
// PER-ENTITY COPIES (mailing model, b66): every participant owns its OWN row (entity_id), so deletes are independent
// and nothing is shared across entities. cb_attachment is RLS-enforced — ALL access runs inside withEntity(entity).
// Default 'db' adapter keeps blobs in Postgres; swap to S3/Azure/GCS via STORAGE_ADAPTER — callers only see opaque ids.
const { query, withEntity } = require('../db');
const objectStore = require('./storage-object');

let _ready = null;
/**
 * ⚠️ DOES `object_key` EXIST YET? (b159). Checked once, because SELECTing a column that is not there is an ERROR,
 * not a null — so a plain `SELECT …, object_key` would take every attachment read down on any deployment where the
 * migration has not run. The API deploys before the migration by design, so that window is real, not theoretical.
 */
let _hasKey = null;
async function hasObjectKey() {
  if (_hasKey !== null) return _hasKey;
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cb_attachment' AND column_name = 'object_key' LIMIT 1`);
    _hasKey = r.rowCount > 0;
  } catch (e) { _hasKey = false; }
  return _hasKey;
}

/**
 * ⭐⭐ THE READ IS SHAPE-TOLERANT, PERMANENTLY — not transitionally.
 *
 * A row written by the 'db' adapter holds bytes in `data` and no key. A row written by the object adapter holds a
 * key and no bytes. Both shapes are valid forever, because rows written before a switch must stay readable after
 * it. If this ever assumes one shape, every attachment stored before the flag flipped becomes unreadable on the
 * day it flips — a silent, total loss of exactly the evidence this product exists to hold.
 */
async function hydrate(row) {
  if (!row) return row;
  if (row.data == null && row.object_key) row.data = await objectStore.get(row.object_key);
  return row;
}
function ensureTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    // Least-privilege role (cb_app) cannot CREATE; the table is provisioned by migration b65 (+ b66 adds entity_id/RLS).
    // Only CHECK existence here — never attempt DDL when it already exists (that itself raises permission-denied).
    const chk = await query(`SELECT to_regclass('public.cb_attachment') AS t`);
    if (chk.rows[0] && chk.rows[0].t) return;
    try {
      await query(`CREATE TABLE IF NOT EXISTS cb_attachment (
        id uuid primary key default gen_random_uuid(), entity_id uuid, chit_id uuid, message_id uuid, line_index int,
        name text, mime text, size int, data bytea, uploaded_by uuid, created_at timestamptz default now())`);
      await query(`CREATE INDEX IF NOT EXISTS cb_attachment_entity_chit_idx ON cb_attachment(entity_id, chit_id)`);
      await query(`CREATE INDEX IF NOT EXISTS cb_attachment_entity_msg_idx  ON cb_attachment(entity_id, message_id)`);
    } catch (e) { console.warn('[storage] cb_attachment not present and auto-create failed (run migrations b65+b66 as admin):', e.message); }
  })();
  return _ready;
}

// ── db adapter ──
const dbAdapter = {
  // REPLICATE one row per participant entity (each owns its own copy). `participants` = distinct entity_ids;
  // `forEntity` = the uploader, whose row id is returned (the id its own client will reference). Each insert runs
  // inside withEntity(entity) so the RLS WITH CHECK (entity_id = current_entity) passes for that participant's copy.
  async putForParticipants({ chit_id, message_id, line_index, name, mime, size, buffer, uploaded_by, participants, forEntity }) {
    await ensureTable();
    /**
     * ⭐ TO OBJECT STORAGE ONLY WHEN EXPLICITLY TURNED ON AND ACTUALLY CONFIGURED. Both conditions, deliberately:
     * a half-set env (flag on, credentials missing) must fall back to the database rather than fail an upload.
     * Losing a document because a variable was mistyped is not an acceptable failure mode for this table.
     */
    const toObject = (process.env.STORAGE_ADAPTER === 'object') && objectStore.configured() && await hasObjectKey();
    const seen = new Set(); let myId = null;
    for (const ent of (participants || [])) {
      if (!ent || seen.has(ent)) continue; seen.add(ent);
      const r = await withEntity(ent, (db) => db.query(
        `INSERT INTO cb_attachment (entity_id, chit_id, message_id, line_index, name, mime, size, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ent, chit_id || null, message_id || null, (line_index == null ? null : line_index), name, mime, size,
         toObject ? null : buffer, uploaded_by || null]));
      const rowId = r.rows[0].id;
      if (toObject) {
        /**
         * ⚠️ ONE OBJECT PER PARTICIPANT — the bytes are REPLICATED, not shared. See storage-object.js: dedup needs
         * a refcount, and a refcount bug means one party's delete destroys another party's evidence.
         *
         * ⚠️ AND THE OBJECT IS WRITTEN BEFORE THE KEY IS RECORDED. If the write fails, the row is deleted and the
         * upload errors — an attachment row whose bytes never landed is a broken promise, and in a dispute an
         * empty file that downloads cleanly is worse than an error, because the error gets investigated.
         */
        const key = objectStore.objectKey(ent, rowId);
        try {
          await objectStore.put(key, buffer, mime);
          await withEntity(ent, (db) => db.query(`UPDATE cb_attachment SET object_key = $1 WHERE id = $2`, [key, rowId]));
        } catch (e) {
          await withEntity(ent, (db) => db.query(`DELETE FROM cb_attachment WHERE id = $1`, [rowId])).catch(() => {});
          throw e;
        }
      }
      if (ent === forEntity) myId = rowId;
    }
    return myId;   // the uploader's own copy id (null if forEntity wasn't in participants)
  },

  /**
   * T2.2 / T3.10 · the SAME replication, but INSIDE a caller-supplied transaction.
   *
   * putForParticipants opens one transaction per participant, so it can only run AFTER the chit is committed — which
   * forced a bad choice: return 200 with `documents_stored:false` (a chit asserting evidence nobody holds), or 500 on
   * a submission that already exists. The review was right that the PREMISE was the defect.
   *
   * RLS is satisfied the same way, just differently scoped: the FORCE-RLS `WITH CHECK (entity_id = current_setting)`
   * only needs `app.current_entity` to be correct AT THE MOMENT OF THE INSERT, and set_config(..., true) is
   * TRANSACTION-LOCAL — so switching it per participant inside one transaction is exactly as valid as one
   * transaction each, and now the documents commit or roll back WITH the chit. No partial state, no orphan bytes,
   * no chit referencing a proof that was never stored.
   *
   * The caller must restore its own entity context afterwards if it does more work in the same transaction.
   */
  /**
   * ⚠️⚠️ THIS PATH STAYS ON THE DATABASE EVEN WHEN STORAGE_ADAPTER='object', AND THAT IS DELIBERATE.
   *
   * Its whole purpose is that the documents commit or roll back WITH the chit — no partial state, no orphan bytes,
   * no chit referencing a proof that was never stored. An object store has no part in a Postgres transaction: if
   * the transaction rolls back after the object is written, the object survives as an orphan; if the object write
   * fails mid-transaction, the whole chit fails for a reason unrelated to the chit.
   *
   * So the two paths differ ON PURPOSE and the result is a MIXED table — some rows with bytes, some with keys.
   * That is exactly why `hydrate()` reads both shapes permanently rather than transitionally. Making this path
   * object-backed needs a two-phase write (object first, key recorded in the transaction, orphan sweep for
   * failures) and that is its own piece of work, not a line change here.
   */
  async putForParticipantsInTx(client, { chit_id, message_id, line_index, name, mime, size, buffer, uploaded_by, participants, forEntity }) {
    const seen = new Set(); let myId = null;
    for (const ent of (participants || [])) {
      if (!ent || seen.has(ent)) continue; seen.add(ent);
      await client.query(`SELECT set_config('app.current_entity', $1, true)`, [String(ent)]);
      const r = await client.query(
        `INSERT INTO cb_attachment (entity_id, chit_id, message_id, line_index, name, mime, size, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ent, chit_id || null, message_id || null, (line_index == null ? null : line_index), name, mime, size, buffer, uploaded_by || null]);
      if (ent === forEntity) myId = r.rows[0].id;
    }
    return myId;
  },
  // reads are ALWAYS scoped to the caller's own entity (RLS + explicit context)
  async getBlob(id, entity_id) {
    await ensureTable();
    const key = await hasObjectKey();
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT name, mime, size, data, chit_id, message_id, entity_id${key ? ', object_key' : ''}
         FROM cb_attachment WHERE id = $1`, [id]));
    /* RLS decided whether this row is visible; only THEN are the bytes fetched. The object store never sees a
       request for something the caller was not already entitled to read. */
    return hydrate(r.rows[0] || null);
  },
  /**
   * ⭐ `db` IS OPTIONAL, AND IT IS WORTH A SECOND OF EVERY CHIT OPEN. Measured 2026-08-23 with `?timing=1`:
   * opening a chit spends `main_read` 2421ms · `one_shot` 1076ms · `attachments` **1074ms** — and those
   * constants are round trips, not queries. One `withEntity` is BEGIN + set_config + statement + COMMIT, so
   * this four-column SELECT of at most a handful of rows cost a full transaction on its own.
   *
   * ⚠️ The chit read's own comment said dragging this into its transaction would "couple a blob read to the
   * chit's own read for no round-trip saving". Both halves were wrong: `data` is not selected, so nothing here
   * is a blob read, and the saving is an entire transaction. A caller already inside one passes its handle.
   */
  async listForChit(chit_id, entity_id, db) {
    await ensureTable();
    const SQL = `SELECT id, name, mime, size, line_index FROM cb_attachment
                  WHERE chit_id = $1 AND message_id IS NULL ORDER BY created_at`;
    if (db) return (await db.query(SQL, [chit_id])).rows;
    const r = await withEntity(entity_id, (d) => d.query(SQL, [chit_id]));
    return r.rows;
  },
  async listForMessages(message_ids, entity_id) {
    await ensureTable();
    if (!message_ids || !message_ids.length) return [];
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT id, name, mime, size, message_id FROM cb_attachment
        WHERE message_id = ANY($1) ORDER BY created_at`, [message_ids]));
    return r.rows;
  },
  async meta(id, entity_id) {
    await ensureTable();
    const r = await withEntity(entity_id, (db) => db.query(`SELECT id, chit_id, message_id, entity_id FROM cb_attachment WHERE id = $1`, [id]));
    return r.rows[0] || null;
  }
};

const adapter = dbAdapter;   // STORAGE_ADAPTER selects the backend; only 'db' is implemented today
module.exports = { ensureTable, ...adapter, STORE: (process.env.STORAGE_ADAPTER || 'db') };
