// Platform-INDEPENDENT attachment storage (StorageAdapter).
// PER-ENTITY COPIES (mailing model, b66): every participant owns its OWN row (entity_id), so deletes are independent
// and nothing is shared across entities. cb_attachment is RLS-enforced — ALL access runs inside withEntity(entity).
// Default 'db' adapter keeps blobs in Postgres; swap to S3/Azure/GCS via STORAGE_ADAPTER — callers only see opaque ids.
const { query, withEntity } = require('../db');

let _ready = null;
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
    const seen = new Set(); let myId = null;
    for (const ent of (participants || [])) {
      if (!ent || seen.has(ent)) continue; seen.add(ent);
      const r = await withEntity(ent, (db) => db.query(
        `INSERT INTO cb_attachment (entity_id, chit_id, message_id, line_index, name, mime, size, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ent, chit_id || null, message_id || null, (line_index == null ? null : line_index), name, mime, size, buffer, uploaded_by || null]));
      if (ent === forEntity) myId = r.rows[0].id;
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
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT name, mime, size, data, chit_id, message_id, entity_id FROM cb_attachment WHERE id = $1`, [id]));
    return r.rows[0] || null;
  },
  async listForChit(chit_id, entity_id) {
    await ensureTable();
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT id, name, mime, size, line_index FROM cb_attachment
        WHERE chit_id = $1 AND message_id IS NULL ORDER BY created_at`, [chit_id]));
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
