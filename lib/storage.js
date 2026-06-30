// Platform-INDEPENDENT attachment storage (StorageAdapter).
// Default 'db' adapter keeps blobs in Postgres; swap to S3 / Azure Blob / GCS / in-house by setting
// STORAGE_ADAPTER and adding an impl below — callers only ever deal with an opaque attachment id.
const { query } = require('../db');

let _ready = null;
function ensureTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS cb_attachment (
      id          uuid primary key default gen_random_uuid(),
      chit_id     uuid,
      message_id  uuid,
      line_index  int,
      name        text,
      mime        text,
      size        int,
      data        bytea,
      uploaded_by uuid,
      created_at  timestamptz default now()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS cb_attachment_chit_idx ON cb_attachment(chit_id) WHERE message_id IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS cb_attachment_msg_idx  ON cb_attachment(message_id)`);
  })();
  return _ready;
}

// ── db adapter ──
const dbAdapter = {
  async put({ chit_id, message_id, line_index, name, mime, size, buffer, uploaded_by }) {
    await ensureTable();
    const r = await query(
      `INSERT INTO cb_attachment (chit_id, message_id, line_index, name, mime, size, data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [chit_id || null, message_id || null, (line_index == null ? null : line_index), name, mime, size, buffer, uploaded_by || null]);
    return r.rows[0].id;
  },
  async getBlob(id) {
    await ensureTable();
    const r = await query(`SELECT name, mime, size, data, chit_id, message_id FROM cb_attachment WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },
  async listForChit(chit_id) {
    await ensureTable();
    const r = await query(
      `SELECT id, name, mime, size, line_index FROM cb_attachment
        WHERE chit_id = $1 AND message_id IS NULL ORDER BY created_at`, [chit_id]);
    return r.rows;
  },
  async listForMessages(message_ids) {
    await ensureTable();
    if (!message_ids || !message_ids.length) return [];
    const r = await query(
      `SELECT id, name, mime, size, message_id FROM cb_attachment
        WHERE message_id = ANY($1) ORDER BY created_at`, [message_ids]);
    return r.rows;
  },
  async meta(id) {
    await ensureTable();
    const r = await query(`SELECT id, chit_id, message_id FROM cb_attachment WHERE id = $1`, [id]);
    return r.rows[0] || null;
  }
};

// STORAGE_ADAPTER selects the backend; only 'db' is implemented today. S3/Azure/GCS plug in here later
// (same interface), and nothing else in the app changes.
const adapter = dbAdapter;

module.exports = { ensureTable, ...adapter, STORE: (process.env.STORAGE_ADAPTER || 'db') };
