'use strict';
// OWNS      postMessage(db, { subject_type, subject_id | chit_id, ... }): the ONE writer of a message, whatever it is about (a chit's thread, a mark's thread, a firm's own note) · blankFlagThread (a removed note's replies lose their words) · logMessageSent (a chit message's timeline line)
// CALLED BY routes/chits.js POST /:chit_id/messages · lib/review-mark.js (reply) · lib/private-flag.js (a reply on a "My firm" note, and its removal). The product-enquiry reader (routes/catalogue.js enquiry) becomes a second caller later (MARK-AND-QUERY 6.1).
// FLOW      'chit': the per-entity copies (lib/chit-crossing postMessageCopies) then, for an external message, the timeline line, all on the caller's transaction → { message_id, created_at }.
//           'flag' (b877): ONE copy in the WRITER's own organisation, thread_type 'internal', written by ONE statement that selects the open "My firm" note it answers (no row selected = refused); no CTP, no inbox, no e-mail, no copy in the client's entity. The person is stamped by the database (chit_messages_stamp_person).
//           'mark': ONE copy in the subject owner's entity through the DB function review_mark_post (it checks the writer in SQL); NO CTP, NO chit_message_deliver, NO logMessageSent, NO level ladder: a Query never leaves the installation.
// CARD      01-rail-core-the-chit/chit-crossing
const { postMessageCopies, crossingIn } = require('./chit-crossing');

/** an EXTERNAL message's timeline line, on the tx that posted its copies: every participant's timeline (chit_log_all,
 *  validated: the caller must be a participant), or a dispute reply's roster only (chit_log_targets). Fallback = the legacy
 *  per-participant loop when b50 isn't applied. RAIL-136 (d): one tx with the copies, so a failed timeline write leaves no
 *  message behind and a retry posts it once. */
async function logMessageSent(db, { chit_id, entity_id, display_name, message_text, roster }) {
  if (roster) {
    // a dispute reply: the roster only (chit_log_targets, validated like the dispute raise/resolve notices)
    await crossingIn(
      db,
      `SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`,
      [chit_id, roster, 'message_sent', entity_id, display_name, message_text.slice(0, 100)],
      async (db) => {
        for (const pid of roster) {
          await db.query(
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
            [chit_id, pid, entity_id, display_name, message_text.slice(0, 100)]
          );
        }
      }
    );
  } else {
    await crossingIn(
      db,
      `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
      [chit_id, 'message_sent', entity_id, display_name, null, null, message_text.slice(0, 100)],
      async (db) => {
        // DISTINCT entity: a self-chit has two copies under one entity — log once per entity, not per copy.
        const participants = await db.query(`SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1`, [chit_id]);
        for (const p of participants.rows) {
          await db.query(
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
            [chit_id, p.entity_id, entity_id, display_name, message_text.slice(0, 100)]
          );
        }
      }
    );
  }
}

/** a mark's reply: one copy, written by the definer that re-checks the writer in SQL (never by a direct insert: the table's own policy cannot tell the owner's copy from the reviewer's under a door) */
async function postMarkMessage(db, spec) {
  const found = await db.query('SELECT message_id, created_at FROM review_mark_post($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::uuid)', [
    spec.subject_id,
    spec.sender_entity_id,
    spec.sender_display_name || null,
    spec.message_text,
    spec.msg_type || 'info',
    spec.via_kind,
    spec.via_id == null ? null : String(spec.via_id),
    spec.by_policy || null,
    spec.message_id || null
  ]);
  return { message_id: found.rows[0].message_id, created_at: found.rows[0].created_at };
}

/**
 * a reply on a firm's own note: no definer. The firm writes its OWN organisation's row (rls_entity), the statement selects the note it answers (an open note shared with the organisation, in the writer's own organisation),
 * and chit_messages_subject_ck refuses anything else (b877: flag, internal, sender = entity). No row selected = the thread is not there to answer: a refusal the caller words (the same for "not found" and "not yours").
 */
async function postFlagMessage(db, spec) {
  const found = await db.query(
    `INSERT INTO chit_messages (message_id, entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id)
     SELECT gen_random_uuid(), f.entity_id, NULL, 'flag', f.thread_id, f.entity_id, $2::text, 'internal', NULL, $3::text, 'info', false, NULL
       FROM private_flag f
      WHERE f.thread_id = $1::uuid AND f.entity_id = $4::uuid AND f.kind = 'note' AND f.visibility = 'org' AND f.state = 'open'
     RETURNING message_id, created_at`,
    [spec.subject_id, spec.sender_display_name || '', spec.message_text, spec.sender_entity_id]
  );
  if (!found.rows.length) throw Object.assign(new Error('postMessage: no open note to answer'), { code: 'MESSAGE_FLAG_NOT_OPEN' });
  return { message_id: found.rows[0].message_id, created_at: found.rows[0].created_at };
}

/** a removed note loses its replies' words, in the same transaction as the removal (message_text is NOT NULL: the words become ''); who and when stay (the row stays). → the number of replies blanked */
async function blankFlagThread(db, threadId, entityId) {
  const done = await db.query(`UPDATE chit_messages SET message_text = '' WHERE subject_type = 'flag' AND subject_id = $1::uuid AND entity_id = $2::uuid AND message_text <> ''`, [threadId, entityId]);
  return done.rowCount;
}

/**
 * postMessage(db, spec) → { message_id, created_at }. spec.subject_type: 'chit' (default), 'mark' or 'flag'.
 * chit: { chit_id, sender_entity_id, sender_display_name, thread_type, message_text, msg_type, is_dispute, dispute_id, line_id, timeline: { display_name, roster } | absent }
 * mark: { subject_id (the thread), sender_entity_id, sender_display_name, message_text, msg_type, via_kind, via_id }
 * flag: { subject_id (the note's thread_id), sender_entity_id (the writer's own organisation), sender_display_name, message_text }
 */
async function postMessage(db, spec) {
  const kind = spec.subject_type || 'chit';
  if (kind === 'mark') return postMarkMessage(db, spec);
  if (kind === 'flag') return postFlagMessage(db, spec);
  if (kind !== 'chit') throw Object.assign(new Error('postMessage: unknown subject_type ' + kind), { code: 'MESSAGE_SUBJECT_UNKNOWN' });
  const posted = await postMessageCopies(spec, db);
  if (spec.thread_type === 'external') {
    await logMessageSent(db, { chit_id: spec.chit_id, entity_id: spec.sender_entity_id, display_name: (spec.timeline || {}).display_name, message_text: spec.message_text, roster: (spec.timeline || {}).roster });
  }
  return posted;
}

module.exports = { postMessage, blankFlagThread, logMessageSent };
