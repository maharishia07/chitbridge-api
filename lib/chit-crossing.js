// @stage tested
// @stage-note How a chit write reaches the OTHER party's copy: the b50/b51/b52 definer (or its legacy fallback) and the per-entity message copies. Lifted unchanged from routes/chits.js with moveStatus.
// CARD 01-rail-core-the-chit/chit-crossing
// owns: crossing / crossingIn (run a delivery-agent definer inside withEntity, fall back before the migration), definersReady (the cached b50 probe), postMessageCopies (one message, a copy per audience entity).
// called by: routes/chits.js (send · messages · disputes) · lib/chit-move.js (the status move's timeline row and cancel messages).
// FLOW  caller's entity → definersReady (cached) → definer SQL, or the legacy fallback on the caller's own transaction
'use strict';
const { v4: uuidv4 } = require('uuid');
const { query, withEntity } = require('../db');
const cbLog = require('./logger');
const messageLimit = require('./message-limit'); // RAIL-106 — how long one message may be, checked where every message is written

// ── B1 RLS — the crossing helper ──────────────────────────────────────────────
// A few chit operations legitimately cross the entity boundary (log an event into every/selected participant,
// propagate a cancel/void, set the customer flag). Under RLS those are served by the b50/b51 SECURITY DEFINER
// "delivery-agent" fns. `crossing()` runs the definer inside withEntity(caller); if the delivery layer isn't
// applied yet (pre-b50), it runs a legacy direct-SQL fallback in its OWN transaction — so a missing-function
// error can't poison a shared tx, and the feature keeps working before/after the migration. Under FORCE without
// the fn the fallback fails closed (degraded, never a cross-tenant leak). Once b50 is applied the definer wins.
// Are the b50/b51/b52 delivery-agent fns installed? Latches true once seen; keeps re-probing while false, so it
// self-heals when the migration lands (no restart needed). A tenant-table-free probe -> the RLS guard stays silent.
let _definersReady = false;
/** are the b50/b51/b52 delivery-agent functions installed? (cached once true; false means the legacy fallback runs) */
async function definersReady() {
  if (_definersReady) return true;
  try {
    const probe = await query(
      `SELECT (to_regprocedure('chit_deliver(uuid,boolean,jsonb)') IS NOT NULL
           AND to_regprocedure('chit_log_targets(uuid,uuid[],text,uuid,text,text)') IS NOT NULL
           AND to_regprocedure('chit_participant_parity(uuid,uuid)') IS NOT NULL) AS ok`
    );
    _definersReady = !!(probe.rows[0] && probe.rows[0].ok);
  } catch (e) {
    cbLog.fellBack('chits definersReady: the read failed — carried on without it', e); /* leave false — fall back to legacy */
  }
  return _definersReady;
}

/** run a delivery-agent definer inside withEntity(entity); before the migration, its legacy fallback in its own transaction */
async function crossing(entity, definerSql, definerParams, fallback) {
  return await withEntity(entity, (db) => crossingIn(db, definerSql, definerParams, fallback));
}
/** crossing on a tx client the caller already holds, so the crossing write and the writes before it commit or roll back together */
async function crossingIn(db, definerSql, definerParams, fallback) {
  return (await definersReady()) ? await db.query(definerSql, definerParams) : await fallback(db);
}

/**
 * the deliver call as one runner (b155): the 10-arg form stamps line_id onto the copies it creates; the audience is the 9-arg form's, so a line cannot widen who sees anything.
 * → (runner) => the definer's answer. The 9-arg retry is ONLY for a chit-level message (see below).
 */
function deliverOf(args, line_id) {
  const call = (runner) => runner(`SELECT chit_message_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS created_at`, args.concat([line_id || null]));
  /* ⚠️ FALL BACK TO THE 9-ARG FORM ONLY WHEN NO LINE WAS NAMED. Code ships before the migration by standing
     order, so between this deploy and b155 the 10-arg function does not exist (42883). Retrying without it is
     right for a chit-level message and WRONG for a line-scoped one — that would post the message to the thread
     while silently losing which line it was about, which is worse than refusing it. */
  const deliver = async (runner) => {
    try {
      return await call(runner);
    } catch (e) {
      if (e && e.code === '42883' && !line_id) {
        return runner(`SELECT chit_message_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9) AS created_at`, args);
      }
      throw e;
    }
  };
  return deliver;
}

/**
 * b67: post a message as PER-ENTITY copies via the SECURITY DEFINER deliver fn (audience computed server-side:
 * internal → author only · external → all chit participants · dispute → the dispute roster). One logical message_id,
 * replicated per audience entity; reads are RLS-scoped to "my own copies". Pass a tx `db` client to stay atomic.
 */
async function postMessageCopies(msg, db) {
  const longer = messageLimit.tooLong(msg.message_text); // RAIL-106: the one limit, in the one writer: every door, one installation or many
  if (longer) throw longer;
  const message_id = msg.message_id || uuidv4(); /* RAIL-106: a message that arrived from another installation keeps the id it was sent with, so the same one twice is kept once */
  // ROOT FIX (reviewer 2026-07-13): the deliver definer must run with the sender's TRUSTED context set, so it can
  // verify the claimed sender = the caller (b50 pattern) instead of trusting the parameter. When no tx client is
  // passed, establish withEntity(sender) here (all callers pass sender = their authenticated entity_id).
  /* b155 — a message may name the LINE it is about. The audience is decided by the 9-arg form exactly as before;
     the 10-arg form only stamps line_id onto the copies it created, so this cannot widen who sees anything. */
  const args = [
    message_id,
    msg.chit_id,
    msg.sender_entity_id,
    msg.sender_display_name || null,
    msg.thread_type,
    msg.message_text,
    msg.msg_type || 'info',
    !!msg.is_dispute,
    msg.dispute_id || null
  ];
  const deliver = deliverOf(args, msg.line_id);
  const delivered = db ? await deliver((sql, params) => db.query(sql, params)) : await withEntity(msg.sender_entity_id, (client) => deliver((sql, params) => client.query(sql, params)));
  const out = { message_id, created_at: delivered.rows[0] && delivered.rows[0].created_at };
  /* ⭐ RAIL-106: an EXTERNAL message to a party on another installation is queued here, the one place every message is posted (not when a caller holds a transaction open: that one
     is not saved yet; not an internal note; not a dispute, which goes by its own event; not a message that itself arrived over CTP). Never throws. */
  if (!db) out.ctp = await require('./ctpreturn').onMessagePosted(msg.sender_entity_id, msg, out);
  return out;
}

module.exports = { definersReady, crossing, crossingIn, postMessageCopies };
