'use strict';
/*
 * OWNS      the receipt of an ERP document (connector_receipt): which key identifies a document, the claim that makes one effect, the re-claim of a retry that must run again, the finish.
 * CALLED BY routes/connectors.js processErpDocument (POST /api/connectors/erp-ingest and the cockpit's erp-test) · tests/erp-ingest-idempotency.test.cjs
 * FLOW      identityOf (header key, else doc_ref, else the payload hash) → claimReceipt:
 *             INSERT 'pending' (one winner) → { claimed }
 *             a row exists → same key, other body → { conflict } (422) · 'failed', or 'pending' older than the stale limit → UPDATE back to 'pending' (one winner) → { claimed }
 *             'pending' and fresh → { in_progress } (409, the agent keeps the event) · otherwise → { duplicate } (the first receipt answers)
 *           finishReceipt writes the outcome. A crash after the claim leaves 'pending'; once it is stale the next retry claims it again, so no receipt is stuck.
 * CARD      28-platform-and-operations/connectors-routes · migrations b852 (idem_key) and b853 (drop the old unique)
 *
 * ⚠️ THE KEY ORDER (draft-ietf-httpapi-idempotency-key-header-08, Stripe idempotent requests): the caller's Idempotency-Key when sent; else the document's own doc_ref (with its doc_type, so an
 *    invoice and a credit note numbered alike are two documents); else the hash of the bytes. IDENTICAL BYTES WITHOUT A doc_ref COUNT AS ONE DOCUMENT: two real documents that are byte for byte the
 *    same must carry a doc_ref or a key. The same key with a different body is refused (conflict), never answered as a duplicate.
 * ⚠️ Before b852 has run there is no idem_key column: the door keys on the payload hash through the old unique index, as it always did (the failed-then-retry rule still holds).
 * ⚠️ The stale limit must stay far above one emit (a single database transaction): a pending receipt re-claimed while its first emit is only slow could emit twice.
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { withEntity } = require('../db');
const schema = require('./schema');
const { IN_PROGRESS_STALE_MINUTES } = require('../middleware/idempotency'); /* the one stale limit of an unfinished key (a live request ends in seconds) */

const MINUTE_MS = 60 * 1000;
const PENDING_STALE_MINUTES = IN_PROGRESS_STALE_MINUTES;
const KEY_PREFIX = { header: 'h:', doc_ref: 'd:', hash: 'p:' };

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

/** the key column a table has: idem_key after b852, else the payload hash alone */
const hasKeyColumn = () => schema.hasColumn('connector_receipt', 'idem_key');

/**
 * identityOf — how this receipt is found again: the column to match, the value in it, and where the key came from.
 * keyed is false before b852: only the payload hash can identify a document then.
 */
function identityOf({ keyed, idempotencyKey, docType, docRef, payloadHash }) {
  if (!keyed) return { column: 'payload_hash', value: payloadHash, source: 'hash' };
  if (idempotencyKey) return { column: 'idem_key', value: KEY_PREFIX.header + sha256(idempotencyKey), source: 'header' };
  if (docRef) return { column: 'idem_key', value: KEY_PREFIX.doc_ref + sha256(docType + '\n' + docRef), source: 'doc_ref' };
  return { column: 'idem_key', value: KEY_PREFIX.hash + payloadHash, source: 'hash' };
}

/** the first writer of this key wins; a loser gets no row back */
function insertPending(entityId, fields, identity, keyed) {
  const values = [fields.receipt_id, entityId, fields.actor_id, fields.doc_type, fields.doc_ref, fields.payload_hash];
  const keyColumn = keyed ? ', idem_key' : '';
  const keyParam = keyed ? ', $7' : '';
  if (keyed) values.push(identity.value);
  return withEntity(entityId, (client) =>
    client.query(
      `INSERT INTO connector_receipt (receipt_id, entity_id, actor_id, doc_type, doc_ref, payload_hash, outcome${keyColumn})
       VALUES ($1,$2,$3,$4,$5,$6,'pending'${keyParam}) ON CONFLICT DO NOTHING RETURNING receipt_id`,
      values
    )
  );
}

/** the receipt already held for this key */
async function readHeld(entityId, actorId, identity) {
  const held = await withEntity(entityId, (client) =>
    client.query(`SELECT receipt_id, outcome, chit_id, payload_hash, received_at FROM connector_receipt WHERE actor_id = $1 AND ${identity.column} = $2`, [actorId, identity.value])
  );
  return held.rows[0] || null;
}

/** a failed receipt, or a pending one nobody finished in time, goes back to pending for exactly one retry (the UPDATE has one winner) */
async function reclaim(entityId, actorId, identity, now) {
  const staleBefore = new Date(now.getTime() - PENDING_STALE_MINUTES * MINUTE_MS);
  const claimedRow = await withEntity(entityId, (client) =>
    client.query(
      `UPDATE connector_receipt SET outcome = 'pending', received_at = $3
        WHERE actor_id = $1 AND ${identity.column} = $2 AND (outcome = 'failed' OR (outcome = 'pending' AND received_at < $4))
        RETURNING receipt_id`,
      [actorId, identity.value, now, staleBefore]
    )
  );
  return claimedRow.rows[0] || null;
}

/**
 * claimReceipt — one claim per document:
 *   { state: 'claimed', receipt_id }   this caller emits
 *   { state: 'conflict' }              the same key came with a different body
 *   { state: 'unreadable' }            the receipt that blocked the insert cannot be read back: NOT a 2xx (the agent retries), never a 'duplicate' of nothing
 *   { state: 'in_progress' }           another caller holds it and is not stale yet: NOT a 2xx, or the agent would drop an event whose emit may still fail
 *   { state: 'duplicate', held }       already done: answer with the first receipt
 */
async function claimReceipt({ entityId, actorId, docType, docRef, payloadHash, idempotencyKey, now = new Date() }) {
  const keyed = await hasKeyColumn();
  const identity = identityOf({ keyed, idempotencyKey, docType, docRef, payloadHash });
  const fields = { receipt_id: uuidv4(), actor_id: actorId, doc_type: docType, doc_ref: docRef, payload_hash: payloadHash };
  const inserted = await insertPending(entityId, fields, identity, keyed);
  if (inserted.rows.length) return { state: 'claimed', receipt_id: fields.receipt_id };
  const held = await readHeld(entityId, actorId, identity);
  if (!held) return { state: 'unreadable' };
  if (held.payload_hash !== payloadHash) return { state: 'conflict' };
  const again = await reclaim(entityId, actorId, identity, now);
  if (again) return { state: 'claimed', receipt_id: again.receipt_id };
  if (held.outcome === 'pending' || held.outcome === 'failed') return { state: 'in_progress' }; /* 'failed' here = this caller lost the re-claim to another: that one is emitting now */
  return { state: 'duplicate', held };
}

/** the outcome of the emit: processed, logged or failed */
function finishReceipt(entityId, receiptId, outcome, chitId) {
  return withEntity(entityId, (client) => client.query(`UPDATE connector_receipt SET outcome = $1, chit_id = $2 WHERE receipt_id = $3`, [outcome, chitId, receiptId]));
}

module.exports = { claimReceipt, finishReceipt, identityOf, sha256, PENDING_STALE_MINUTES };
