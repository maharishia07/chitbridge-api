// @stage tested
// @stage-note RAIL-187 — the ONE reading of "who receives a dispute's message": the dispute's roster, or the whole chit when it is chit-wide. Lifted from routes/chits.js POST /:chit_id/messages so a file on that message is scoped by the same rule, not a copy of it.
// CARD 01-rail-core-the-chit/chit-crossing
// owns: audienceOf (the dispute's audience as the party asking sees it: a roster of entity ids, the wide flag, or "not a party").
// called by: routes/chits.js (the dispute message's timeline + bell) · routes/attachments.js (a file on a dispute message).
// FLOW  my copy of the dispute (RLS: a row proves I am a party AND the dispute is on this chit) → scope → chit_dispute_roster (the definer chit_message_deliver also decides by)
'use strict';
const { withEntity } = require('../db');
const cbLog = require('./logger');

/**
 * Who receives a message posted into a dispute, seen by `entity_id`.
 * → null when entity_id is no party to that dispute on that chit · { wide: true } for a chit-wide dispute (the audience is the whole chit) ·
 *   { wide: false, ids } the roster plus the asker. FAILS CLOSED: a roster that cannot be read is the asker alone.
 */
async function audienceOf(entity_id, chit_id, dispute_id) {
  const party = await withEntity(entity_id, (db) => db.query(`SELECT scope FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 AND entity_id = $3 LIMIT 1`, [dispute_id, chit_id, entity_id]));
  if (!party.rows.length) return null;
  if ((party.rows[0].scope || 'targeted') === 'chit_wide') return { wide: true, ids: null };
  let ids = [entity_id];
  try {
    const roster = await withEntity(entity_id, (db) => db.query(`SELECT entity_id, role, status FROM chit_dispute_roster($1)`, [dispute_id]));
    ids = [...new Set([entity_id].concat(roster.rows.map((item) => String(item.entity_id))))];
  } catch (e) {
    cbLog.fellBack('dispute-audience: the roster read failed — carried on with the asker alone', e);
  }
  return { wide: false, ids };
}

module.exports = { audienceOf };
