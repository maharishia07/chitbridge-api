'use strict';
/**
 * lib/once.js — THE ONE WAY A REQUEST NAMES ITS DOCUMENT (API-COL-15 finding 2, 18 Nov 2026).
 * OWNS      refFor(req, body) → the reference a journal / payment is posted under: the body's client_ref, else the held Idempotency-Key as `idem:<key>`, else null.
 * CALLED BY routes/books.js (POST /entries, /write-off, /payments).
 * WHY       middleware/idempotency.js claims the key, the writer commits the journal and the answer is recorded in THREE transactions. A 5xx or a crash after the
 *           commit drops the key, and the retry posted again unless the body carried a client_ref. Feeding the journal's source_ref from the held key lets the
 *           EXISTING unique index (journal_entry_src_uq: entity_id, source_ref) and books_payment (entity_id, client_ref) refuse the second post in the writer's own
 *           transaction: the retry answers 200 duplicate:true. No second dedupe, no new table.
 * ⚠️ A body client_ref always wins (the till, the bank page and the web forms keep their own refs, byte for byte). A key longer than 70 characters is hashed so the 80-character slice
 *    the writers apply never cuts two different keys to one ref. req.idempotencyHeld is the key as the pass scoped it (entity, `as <person> `, `for <shop> `), set only by the gate.
 * CARD      28-platform-and-operations/api-standard
 */
const crypto = require('crypto');

const REF_MAX = 80;
const KEY_PART_MAX = 70;

/** the held key as a ref part: itself when short, else a 40-character hash of it */
const keyPart = (key) => (key.length <= KEY_PART_MAX - 5 ? key : crypto.createHash('sha256').update(key).digest('hex').slice(0, 40));

/** refFor(req, body?) → the client ref to post under, or null when the body names none and no key is held */
function refFor(req, body) {
  const given = (body || req.body || {}).client_ref;
  if (given) return String(given).slice(0, REF_MAX);
  const held = req && req.idempotencyHeld;
  return held ? 'idem:' + keyPart(String(held)) : null;
}

module.exports = { refFor };
