'use strict';
// OWNS      the CTP RETURN PATH (RAIL-106, takes in RAIL-114): a change to a chit that already crossed reaches the party on the other installation · the queue (ctp_event_out) and its resend ·
//           the applier (a shadow of the other party's status row, our own copy of their message) · the "not yet confirmed" mark · the refusal of a dispute across installations
// CALLED BY routes/chits.js (moveStatus, postMessageCopies, the dispute and message routes, GET /:chit_id, GET /:chit_id/messages) · routes/ctp.js (the door applies an event) · tools/ctp-return.cjs (the resend)
// FLOW      change saved locally → remoteParties (header bridge ids → ctpaddress.resolve) → enqueue (seq per chit and sender) → drain: envelope.buildEvent → ctptransport.send → accepted | retry later
//           door: same checks as a delivery → apply(event) → mirror the status (rail-status) / post the message (postMessageCopies) onto OUR rows, older or repeated ignored      CARD 05-ctp-and-cross-installation/ctp-return-path
/**
 * ── ⭐⭐⭐ THE RETURN PATH — Athi, 25 Oct 2026: "either one installation or multiple installations, it has to behave the same way" (DECISIONS.md 2026-10-25 09:10) ──────────
 *
 *  1. SHADOW COPY. A change travels as a SIGNED EVENT envelope through the existing door (lib/ctpenvelope buildEvent; POST /api/ctp/deliver, same peer, signature and membership checks).
 *     The receiver applies it to ITS OWN rows: a shadow of the other party's chit_status row and its own copy of an external message, so every reader works unchanged.
 *     Nobody writes into another database. Nothing owned crosses: a status word and an external message, which both parties see by definition.
 *  2. QUEUE AND SAY SO. The change is saved locally FIRST, then queued, and resent until the far side accepts. The sequence runs per (chit, sending party); an older or repeated
 *     STATUS event is acknowledged and ignored (last writer wins, by seq). A MESSAGE is idempotent on its message_id instead (an earlier message that arrives late must still be kept).
 *     Until accepted the sender's own copy says "not yet confirmed to the other side" (unconfirmed(): GET /:chit_id → ctp_unconfirmed, GET /:chit_id/messages → ctp_unconfirmed per message).
 *  3. DISPUTES AFTER. Raising a dispute (or a dispute message) on a chit with a party on another installation is REFUSED in words (CTP_CROSS_DISPUTE), never kept local silently.
 *
 * ⚠️ NOTHING IS FORWARDED. An accepted event is applied here and ends here (apply never emits), the same rule as mint.deliver's `arrived`.
 * ⚠️ THE FAST PATH COSTS NOTHING: with no installation hosted elsewhere, remoteParties answers [] after one memoised Map lookup (ctpaddress.remoteInstallations), before any query.
 * ⚠️ A CRASH BETWEEN THE LOCAL SAVE AND THE QUEUE LOSES THE EVENT (the decision says save locally first). The gap is one statement wide; the answer to the caller carries `ctp.queued: 0`
 *    when the queue write itself failed, so a person is told and not left to assume.
 */
const { query, withEntity } = require('../db');
const log = require('./logger');
const schema = require('./schema');
const addressBook = require('./ctpaddress');
const envelope = require('./ctpenvelope');
const railStatus = require('./rail-status');

/** the sentence the screen shows beside a change the other installation has not confirmed */
const UNCONFIRMED_WORDS = 'Not yet confirmed to the other side';
const FAILED_WORDS = 'Could not be confirmed to the other side';
const MAX_ATTEMPTS = 40; /* with the backoff below: about ten hours of trying, then the row says so and stops */
const BACKOFF_FIRST_S = 30;
const BACKOFF_MAX_S = 900;
const STATUS_WORD = /^[a-z_]{2,30}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_TYPES = ['info', 'query', 'action', 'risk', 'assumption', 'issue', 'dependency', 'decision'];
const MESSAGE_MAX = 20000;

/** the bridge ids named on a header: the sender and every recipient */
function bridgesOf(row) {
  const out = new Set();
  if (row && row.sender_entity_bridge_id) out.add(String(row.sender_entity_bridge_id));
  for (const recipient of Array.isArray(row && row.all_recipients) ? row.all_recipients : []) if (recipient && recipient.bridge_id) out.add(String(recipient.bridge_id));
  return [...out];
}

/**
 * The parties of this chit that live on ANOTHER installation, as seen from `entity_id`'s own header (the sender and the recipients, by bridge id; a bridge id is the only name
 * that means the same on both installations). [] when nothing is hosted elsewhere (no query is made) or the header cannot be read.
 * @returns {Promise<Array<{entity_id, bridge_id, display_name, installation_key, inactive}>>}
 */
async function remoteParties(entity_id, chit_id) {
  const remote = await addressBook.remoteInstallations();
  if (!remote || !remote.size) return [];
  const headerRead = await withEntity(entity_id, (db) =>
    db.query('SELECT sender_entity_bridge_id, all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id])
  );
  const bridges = bridgesOf(headerRead.rows[0]);
  if (!bridges.length) return [];
  const found = await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE bridge_id = ANY($1::text[]) AND identity_type = 'entity'`, [bridges]);
  const out = [];
  for (const person of found.rows) {
    if (String(person.identity_id) === String(entity_id)) continue;
    const place = await addressBook.resolve(person.identity_id);
    if (place.local === false) {
      out.push({ entity_id: person.identity_id, bridge_id: person.bridge_id, display_name: person.display_name, installation_key: place.installation_key, inactive: !!place.inactive });
    }
  }
  return out;
}

/** is the queue there (b791)? Cached by lib/schema. Before it runs nothing is queued and the product behaves as it did. */
const queueReady = () => schema.hasTable('ctp_event_out');

/** queue one change for every remote party, in the changer's own context; the sequence is shared by the rows of one change. → the seq */
async function enqueue(entity_id, chit_id, kind, payload, parties) {
  return withEntity(entity_id, async (db) => {
    /* one stream per (chit, sender): two changes at once must not take the same number */
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [chit_id + ':' + entity_id]);
    const next = await db.query('SELECT coalesce(max(seq), 0) + 1 AS seq FROM ctp_event_out WHERE chit_id = $1 AND from_entity_id = $2', [chit_id, entity_id]);
    const sequence = Number(next.rows[0].seq);
    const event = JSON.stringify(Object.assign({ kind, seq: sequence }, payload));
    for (const party of parties) {
      await db.query(
        `INSERT INTO ctp_event_out (chit_id, from_entity_id, seq, kind, event, to_entity_id, to_bridge_id, to_installation_key)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [chit_id, entity_id, sequence, kind, event, party.entity_id, party.bridge_id, party.installation_key]
      );
    }
    return sequence;
  });
}

/**
 * Queue a change for the other installation(s) and try once now, in the background. Never throws: a failure to queue is logged AND said in the answer.
 * @returns {Promise<{queued:number, seq?:number, why?:string}>} queued 0 and no `why` = nothing is on another installation (the common case)
 */
async function queueChange(entity_id, chit_id, kind, payload) {
  try {
    const parties = await remoteParties(entity_id, chit_id);
    if (!parties.length) return { queued: 0 };
    if (!(await queueReady())) {
      log.warn('ctp.return-not-queued', { entity_id, chit_id, kind, why: 'ctp_event_out is missing (b791 has not run)' });
      return { queued: 0, why: 'The change was saved here but could not be queued for the other side (the return path is not set up on this installation).' };
    }
    const sequence = await enqueue(entity_id, chit_id, kind, payload, parties);
    kick();
    return { queued: parties.length, seq: sequence };
  } catch (e) {
    log.warn('ctp.return-not-queued', { entity_id, chit_id, kind, error: String((e && e.message) || e) });
    return { queued: 0, why: 'The change was saved here but could not be queued for the other side. Tell the operator.' };
  }
}

/** moveStatus calls this once the move is written (and not for a bill step, which is the holder's own). → queueChange's answer */
function onStatusMoved(entity_id, chit_id, moved) {
  return queueChange(entity_id, chit_id, 'status', {
    status: moved.status,
    previous_status: moved.previous_status || null,
    copy: 'received', /* moveStatus moves the caller's RECEIVED copy; the sender's withdrawal is a message (cancelSentCopy) */
    by_name: moved.by_name || null,
    note: moved.note || null,
    at: new Date().toISOString()
  });
}

/** postMessageCopies calls this once an EXTERNAL, non-dispute message is saved. An internal note never goes; a dispute is refused before it is written. */
function onMessagePosted(entity_id, msg, result) {
  if (!msg || !msg.chit_id || msg.thread_type !== 'external' || msg.is_dispute || msg.arrived) return Promise.resolve({ queued: 0 });
  return queueChange(entity_id, msg.chit_id, 'message', {
    message_id: result.message_id,
    message_text: msg.message_text,
    msg_type: msg.msg_type || 'info',
    sender_display_name: msg.sender_display_name || null,
    line_id: msg.line_id || null,
    at: new Date().toISOString()
  });
}

/* ── the resend ─────────────────────────────────────────────────────────────────────────────────────────── */
let draining = false;
/** try once now, in the background, after a change is queued (not under test; the resend job is the safety net) */
function kick() {
  if (process.env.NODE_ENV === 'test' || draining) return;
  setImmediate(() => drain({ limit: 20 }).catch((e) => log.warn('ctp.return-drain-failed', { error: String((e && e.message) || e) })));
}

const backoff = (attempts) => Math.min(BACKOFF_MAX_S, BACKOFF_FIRST_S * Math.pow(2, Math.min(attempts, 10)));

/** what the far installation said to this queued event: a refusal in words when it cannot be sent at all, else the transport's receipt */
async function receiptFor(row) {
  const place = await addressBook.resolve(row.to_entity_id);
  if (place.local !== false) return { accepted: false, permanent: true, why: 'that business is no longer on another installation, so there is nothing to send' };
  if (place.inactive) return { accepted: false, why: 'installation ' + place.installation_key + ' is suspended or retired here' };
  const from = await require('./mint').senderAddress(row.from_entity_id);
  const env = envelope.buildEvent(from, { bridge_id: row.to_bridge_id }, { chit_id: row.chit_id, event: Object.assign({}, row.event, { seq: Number(row.seq) }) });
  return require('./ctptransport').send(place.endpoint, env);
}

/** send one queued event; record the outcome on its row. → 'accepted' | 'still' | 'failed' */
async function sendOne(row) {
  const receipt = await receiptFor(row);
  const attempts = Number(row.attempts || 0) + 1;
  const state = stateAfter(receipt, attempts);
  await withEntity(row.from_entity_id, (db) =>
    db.query(
      `UPDATE ctp_event_out
          SET status = $2, attempts = $3, last_error = $4, accepted_at = CASE WHEN $2 = 'accepted' THEN now() ELSE accepted_at END,
              next_try_at = now() + ($5::text || ' seconds')::interval
        WHERE id = $1`,
      [row.id, state, attempts, receipt.accepted ? null : String(receipt.why || 'no answer').slice(0, 500), String(receipt.accepted ? 0 : backoff(attempts))]
    )
  );
  return state === 'pending' ? 'still' : state;
}

/** where a queued event stands after an attempt: accepted | failed (retries spent, or it can never be sent) | pending (try again) */
function stateAfter(receipt, attempts) {
  if (receipt.accepted) return 'accepted';
  return receipt.permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
}

/**
 * The resend: the oldest waiting event of each (chit, sender, remote party) that is due, oldest first. tools/ctp-return.cjs runs this on a timer.
 * @returns {Promise<{tried:number, accepted:number, still:number, failed:number}>}
 */
async function drain(opts) {
  const out = { tried: 0, accepted: 0, still: 0, failed: 0 };
  if (draining || !(await queueReady())) return out;
  draining = true;
  try {
    /* a stream's later events wait for its head: after the head is accepted the next is due at once, so keep going while anything moved */
    for (let round = 0; round < 25 && (await drainRound(out, (opts && opts.limit) || 50)); round++);
  } finally {
    draining = false;
  }
  return out;
}

/** one pass over what is due; adds to `out`. → true when something was accepted (so the next of its stream may be due) */
async function drainRound(out, limit) {
  const dueRows = await query('SELECT * FROM ops.f_ctp_event_due($1)', [limit]);
  let moved = false;
  for (const row of dueRows.rows) {
    out.tried++;
    let result = 'still';
    try {
      result = await sendOne(row);
    } catch (e) {
      log.warn('ctp.return-send-failed', { id: row.id, error: String((e && e.message) || e) });
    }
    out[result]++;
    moved = moved || result === 'accepted';
  }
  return moved;
}

/* ── the mark on the sender's own copy ──────────────────────────────────────────────────────────────────── */
/**
 * What of MY changes on this chit the other side has not confirmed. null = nothing waiting (the common case; no query when nothing is hosted elsewhere).
 * → { count, since, failed, why, words, message_ids[] }   words = the sentence to show; failed = retries are spent and the operator must look
 */
async function unconfirmed(entity_id, chit_id) {
  const remote = await addressBook.remoteInstallations();
  if (!remote || !remote.size || !(await queueReady())) return null;
  const waiting = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT kind, status, created_at, last_error, event->>'message_id' AS message_id
         FROM ctp_event_out WHERE chit_id = $1 AND from_entity_id = $2 AND status <> 'accepted' ORDER BY seq, id`,
      [chit_id, entity_id]
    )
  );
  return waiting.rows.length ? summary(waiting.rows) : null;
}

/** the mark from the rows still waiting */
function summary(rows) {
  const failed = rows.some((row) => row.status === 'failed');
  const withError = rows.find((row) => row.last_error);
  return {
    count: rows.length,
    since: rows[0].created_at,
    failed,
    why: withError ? withError.last_error : null,
    words: failed ? FAILED_WORDS : UNCONFIRMED_WORDS,
    message_ids: rows.filter((row) => row.kind === 'message' && row.message_id).map((row) => row.message_id)
  };
}

/** the answer of a route that changed something: `{ ctp }` when a party elsewhere was told or could not be, else nothing (so a one-installation answer is exactly what it always was) */
const answerOf = (queued) => (queued && (queued.queued || queued.why) ? { ctp: queued } : {});

/** the part of GET /:chit_id that carries the mark: `{ ctp_unconfirmed }` or nothing */
const markOf = (mark) => (mark ? { ctp_unconfirmed: { count: mark.count, since: mark.since, failed: mark.failed, why: mark.why, words: mark.words } } : {});

/** stamp the sentence on each of my messages the other side has not confirmed (GET /:chit_id/messages) */
function markMessages(rows, mark) {
  if (!mark || !mark.message_ids.length) return;
  const waiting = new Set(mark.message_ids);
  for (const row of rows) if (waiting.has(String(row.message_id))) row.ctp_unconfirmed = mark.failed ? FAILED_WORDS : UNCONFIRMED_WORDS;
}

/* ── disputes after (decision 3) ────────────────────────────────────────────────────────────────────────── */
/**
 * null when the chit has no party on another installation. Otherwise the refusal to answer with (409, CTP_CROSS_DISPUTE) in words:
 * a dispute is a co-held object with a lifecycle both sides act on, and it does not cross yet. Never kept local silently.
 */
async function crossDisputeRefusal(entity_id, chit_id) {
  const parties = await remoteParties(entity_id, chit_id);
  if (!parties.length) return null;
  const names = parties.map((party) => party.display_name || party.bridge_id).join(', ');
  const where = [...new Set(parties.map((party) => party.installation_key))].join(', ');
  return {
    status: 409,
    code: 'CTP_CROSS_DISPUTE',
    body: {
      error: 'Not raised',
      message:
        'This chit has a party on another installation (' + names + ' on ' + where + '), and disputes do not cross installations yet, so nothing was raised or saved. ' +
        'Say it in a message instead, or ask them to raise it on their side.',
      hint: 'Messages and status changes do cross. A dispute will, once it has been proved on two installations.'
    }
  };
}

/* ── the applier (the receiving door) ───────────────────────────────────────────────────────────────────── */
const no = (status, code, reason) => ({ ok: false, status, code, why: reason });

/**
 * Apply one event the door has already verified (peer known, signature, membership, crossing). Writes only OUR rows.
 * @param incoming { chit_id, event, from:{bridge_id, installation_key, display_name}, to:{identity_id} }  to = the local party the envelope named, resolved by the door from its bridge id
 * @returns {Promise<{ok:true, applied:boolean, why:string}|{ok:false, status, code, why}>}
 */
async function apply(incoming) {
  const change = incoming.event || {};
  const shapeProblem = checkShape(change);
  if (shapeProblem) return no(400, 'CTP_EVENT_BAD', shapeProblem);
  const party = await remotePartyOf(incoming.from);
  if (!party.ok) return party;
  const held = await holdsChit(incoming);
  if (!held.ok) return held;
  return change.kind === 'status' ? applyStatus(incoming, change, party.remote) : applyMessage(incoming, change, party.remote, held.senderIsRemote);
}

/** WHO is the party on the other side: a stub row here, found by the bridge id the envelope names — and it must be a party of THAT installation. → { ok, remote } | a refusal */
async function remotePartyOf(from) {
  const stub = await query(`SELECT identity_id, display_name FROM identities WHERE bridge_id = $1 AND identity_type = 'entity'`, [String((from || {}).bridge_id || '')]);
  if (!stub.rows.length) return no(404, 'CTP_EVENT_PARTY_UNKNOWN', 'no business here stands for ' + ((from || {}).bridge_id || 'the sender') + ' — add it by its address first');
  const place = await addressBook.resolve(stub.rows[0].identity_id);
  if (place.local !== false || place.installation_key !== from.installation_key) {
    return no(409, 'CTP_EVENT_PARTY_MISMATCH', 'that business is not one of ' + from.installation_key + '’s here, so it cannot speak for it');
  }
  return { ok: true, remote: stub.rows[0] };
}

/** the local party must hold the chit, and the sender must be one of its parties — a peer cannot write onto a chit it is not on. → { ok, senderIsRemote } | a refusal */
async function holdsChit(incoming) {
  const local = incoming.to.identity_id;
  const held = await withEntity(local, (db) =>
    db.query('SELECT sender_entity_bridge_id, all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [incoming.chit_id, local])
  );
  if (!held.rows.length) return no(404, 'CTP_EVENT_NO_CHIT', 'this business holds no copy of that chit');
  const bridge = String(incoming.from.bridge_id);
  if (bridgesOf(held.rows[0]).indexOf(bridge) < 0) return no(409, 'CTP_EVENT_PARTY_MISMATCH', 'the sender is not a party to that chit');
  return { ok: true, senderIsRemote: String(held.rows[0].sender_entity_bridge_id || '') === bridge };
}

/** the shape of an event, or the sentence saying what is wrong with it */
function checkShape(change) {
  if (change.kind === 'status') return statusProblem(change);
  if (change.kind === 'message') return messageProblem(change);
  return 'not an event this installation knows';
}
function statusProblem(change) {
  if (!Number.isInteger(change.seq) || change.seq < 1) return 'a status event carries a whole-number sequence from 1';
  if (!STATUS_WORD.test(String(change.status || ''))) return 'a status event names a status';
  if (change.copy !== undefined && railStatus.COPIES.indexOf(change.copy) < 0) return 'a status event names the received or the sent copy';
  return null;
}
function messageProblem(change) {
  if (!UUID_SHAPE.test(String(change.message_id || ''))) return 'a message event carries its message id';
  const text = change.message_text;
  if (typeof text !== 'string' || !text.trim() || text.length > MESSAGE_MAX) return 'a message event carries text of up to ' + MESSAGE_MAX + ' characters';
  return null;
}

/** a status the other installation decided: mirror it on the shadow of that party's row, once, newest wins */
async function applyStatus(incoming, change, remote) {
  const to = incoming.to.identity_id;
  const last = await withEntity(to, (db) =>
    db.query('SELECT last_seq FROM ctp_event_in WHERE chit_id = $1 AND remote_entity_id = $2 AND entity_id = $3', [incoming.chit_id, remote.identity_id, to])
  );
  if (last.rows.length && Number(last.rows[0].last_seq) >= change.seq) return { ok: true, applied: false, why: 'older or repeated — ignored' };
  /* the shadow first, the watermark second: a failure between them is retried and the mirror is idempotent; the other order would lose the event */
  await withEntity(remote.identity_id, (db) => railStatus.mirror(db, remote.identity_id, incoming.chit_id, change.status, change.copy || 'received'));
  const advanced = await recordApplied(incoming, change, remote);
  return { ok: true, applied: advanced, why: advanced ? 'applied' : 'older or repeated — ignored' };
}

/** the message fan-out is by chit_status (chit_message_deliver) and the poster must hold a row: the shadow of the other party is that row (a sender's is 'sent', a recipient's 'received') */
function ensureShadowRow(chit_id, remote_entity_id, senderIsRemote) {
  return withEntity(remote_entity_id, (db) =>
    db.query(
      `INSERT INTO chit_status (chit_id, entity_id, current_status, direction) VALUES ($1, $2, $3, $4)
       ON CONFLICT (chit_id, entity_id, direction) DO NOTHING`,
      [chit_id, remote_entity_id, senderIsRemote ? 'delivered' : 'pending', senderIsRemote ? 'sent' : 'received']
    )
  );
}

/** move the watermark to this event and write the timeline row — in one transaction, and only if this event is newer than what is held. → true when it advanced */
function recordApplied(incoming, change, remote) {
  const local = incoming.to.identity_id;
  return withEntity(local, async (db) => {
    const advance = await db.query(
      `INSERT INTO ctp_event_in (chit_id, remote_entity_id, entity_id, last_seq) VALUES ($1, $2, $3, $4)
       ON CONFLICT (chit_id, remote_entity_id, entity_id) DO UPDATE SET last_seq = EXCLUDED.last_seq, applied_at = now()
         WHERE ctp_event_in.last_seq < EXCLUDED.last_seq
       RETURNING last_seq`,
      [incoming.chit_id, remote.identity_id, local, change.seq]
    );
    if (!advance.rowCount) return false;
    /* the timeline row every participant gets in one database (moveStatus → chit_log_all), written on OUR copy */
    const by = change.by_name || incoming.from.display_name || remote.display_name || 'The other side';
    const detail = String(change.note || 'Status changed from ' + (change.previous_status || '—') + ' to ' + change.status + ' by ' + by).slice(0, 2000);
    await db.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, previous_status, new_status, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [incoming.chit_id, local, 'status_' + change.status, remote.identity_id, by, change.previous_status || null, change.status, detail]
    );
    return true;
  });
}

/** an external message from the other side: our own copy of it, through the one posting function; the same message id twice is kept once */
async function applyMessage(incoming, change, remote, senderIsRemote) {
  const to = incoming.to.identity_id;
  const have = await withEntity(to, (db) => db.query('SELECT 1 FROM chit_messages WHERE message_id = $1 AND entity_id = $2 LIMIT 1', [change.message_id, to]));
  if (have.rows.length) return { ok: true, applied: false, why: 'already held — ignored' };
  await ensureShadowRow(incoming.chit_id, remote.identity_id, senderIsRemote);
  const by = change.sender_display_name || incoming.from.display_name || remote.display_name || 'The other side';
  try {
    await require('../routes/chits').postMessageCopies({
      message_id: change.message_id,
      chit_id: incoming.chit_id,
      sender_entity_id: remote.identity_id,
      sender_display_name: by,
      thread_type: 'external',
      message_text: change.message_text,
      msg_type: MSG_TYPES.indexOf(change.msg_type) >= 0 ? change.msg_type : 'info',
      line_id: UUID_SHAPE.test(String(change.line_id || '')) ? change.line_id : null,
      arrived: true /* ARRIVAL IS NOT A ROUTING DECISION: written here, never queued onward */
    });
  } catch (e) {
    if (e && e.code === '23505') return { ok: true, applied: false, why: 'already held — ignored' }; /* the same event arrived twice at once */
    throw e;
  }
  await withEntity(to, (db) =>
    db.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
      [incoming.chit_id, to, remote.identity_id, by, change.message_text.slice(0, 100)]
    )
  );
  return { ok: true, applied: true, why: 'applied' };
}

module.exports = {
  remoteParties,
  queueChange,
  onStatusMoved,
  onMessagePosted,
  drain,
  sendOne,
  unconfirmed,
  answerOf,
  markOf,
  markMessages,
  crossDisputeRefusal,
  apply,
  checkShape,
  backoff,
  UNCONFIRMED_WORDS,
  FAILED_WORDS,
  MAX_ATTEMPTS
};
