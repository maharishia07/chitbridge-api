'use strict';
// lib/message-client-id.js — F5b: THE CLIENT MESSAGE ID that makes a retried chit message land once.
// OWNER  cb-rail
// RISK   an id not scoped to sender and chit lets one party plant or collide another's message id; a malformed id is refused 400, never guessed
// OWNS      F5b (1128): the optional client message id of POST /api/chits/:chit_id/messages — turned into the message's own id (scoped to the sender and the chit, so nobody can plant or collide an id) and the lookup that drops a duplicate
// CALLED BY routes/chits.js POST /:chit_id/messages
// FLOW      body.client_msg_id (a uuid the client makes once per message and sends again on a retry) → scopedId → heldAlready (my copy holds it?) → the first answer; else the id becomes the message_id the one writer posts with (postMessageCopies keeps msg.message_id)
// CARD      01-rail-core-the-chit/chit-crossing
const crypto = require('crypto');
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the id a client sent, or null when none; throws a 400-shaped error when it is present and not a uuid */
function clientIdOf(body) {
  const raw = body && body.client_msg_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_SHAPE.test(raw)) throw Object.assign(new Error('client_msg_id must be a uuid'), { status: 400, code: 'CLIENT_MSG_ID_INVALID' });
  return raw.toLowerCase();
}
/** the message id for (sender, chit, client id): a uuid-shaped hash, the same every time for the same three, different for any other sender or chit */
function scopedId(sender, chit, clientId) {
  const h = crypto.createHash('sha256').update(['msg', String(sender), String(chit), clientId].join('|')).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}
/** does MY copy of this chit's thread already hold this message id → the first answer's fields, or null */
async function heldAlready(db, entity, chit, messageId) {
  const found = await db.query('SELECT message_id, thread_type, message_text, created_at FROM chit_messages WHERE message_id = $1 AND entity_id = $2 AND chit_id = $3 LIMIT 1', [messageId, entity, chit]);
  return found.rows[0] || null;
}
module.exports = { clientIdOf, scopedId, heldAlready };
