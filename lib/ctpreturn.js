'use strict';
// OWNS      the CTP RETURN PATH (RAIL-106, takes in RAIL-114): a change to a chit that already crossed reaches the party on the other installation · the queue (ctp_event_out) and its resend ·
//           the applier (a shadow of the other party's status row, our own copy of their message, a dispute raised / replied to / resolved there) · the "not yet confirmed" mark
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
 *  3. DISPUTES (Athi, 25 Oct: "the computation happens in only one place where it originates, rest of the places it just displays it as a record"). A dispute action — raise, a dispute message,
 *     resolve — is DECIDED only where the person acts, by the code that decides it on one installation (the dispute routes, lib/dispute-may, the rail engine). It then travels as an event
 *     (dispute_raise · dispute_message · dispute_resolve) and the receiving installation RECORDS it through the very writers the routes use (routes/chits recordRaise / recordResolve /
 *     postMessageCopies) as the remote party's stub; it never re-runs the permission decision. A dispute event is dispute-wide, so it goes ONCE PER INSTALLATION: to the roster's parties when the dispute
 *     is targeted, to every party elsewhere when it is chit-wide (the same audience a local dispute has).
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
/* the status moves that ring the other party (Athi, 25 Oct 11:15): accepted, rejected, cancelled — locally by moveStatus, on arrival by applyStatus */
const BELL_STATUSES = ['accepted', 'rejected', 'cancelled'];
/**
 * The push an arrived or local status move sends (F15, W14): a status in BELL_STATUSES rings; any other (in_progress, partial, completed …) is QUIET — it only writes the SSE stream so an open chit
 * repaints (web chitOnReturn); events.emit stores no bell row and the web shows no toast for it.
 */
const statusEvent = (status, by) => (BELL_STATUSES.indexOf(status) >= 0 ? { kind: 'status', status, who: by } : { kind: 'status', status, who: by, quiet: true });
const MESSAGE_MAX = require('./message-limit').MESSAGE_MAX_CHARS; /* an arrived event is held to the same limit as a message written here */
const ATTACH_TIMEOUT_MS = 90000; /* an event whose far side pulls a file waits longer for the answer; the pull is idempotent, so a timeout and a resend store it once */
const SHA256 = /^[0-9a-f]{64}$/;

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
      out.push({ entity_id: person.identity_id, bridge_id: person.bridge_id, display_name: person.display_name, installation_key: place.installation_key, inactive: !!place.inactive, is_sender: String(person.bridge_id) === String(headerRead.rows[0].sender_entity_bridge_id || '') });
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
async function queueChange(entity_id, chit_id, kind, payload, choose) {
  try {
    let parties = await remoteParties(entity_id, chit_id);
    if (choose) parties = choose(parties);
    if (!parties.length) return { queued: 0 };
    if (!(await queueReady())) {
      log.warn('ctp.return-not-queued', { entity_id, chit_id, kind, why: 'ctp_event_out is missing (b791 has not run)' });
      return { queued: 0, why: 'The change was saved here but could not be queued for the other side (the return path is not set up on this installation).' };
    }
    const body = typeof payload === 'function' ? await payload(parties) : payload;
    const sequence = await enqueue(entity_id, chit_id, kind, body, parties);
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
    copy: moved.copy || 'received', /* moveStatus moves the caller's RECEIVED copy; a withdrawal (void, cancelSentCopy) moves the SENT one */
    by_name: moved.by_name || null,
    note: moved.note || null,
    at: new Date().toISOString()
  });
}

/** the first answer of several that actually queued or said why (a route that tells more than one thing answers with one) */
const firstOf = (answers) => (answers || []).find((answer) => answer && (answer.queued || answer.why)) || { queued: 0 };

/** the void route asked the recipients to cancel (b195): the flag on their copy is set where they are, by the same stamp */
function onCancelRequested(entity_id, chit_id, request) {
  return queueChange(entity_id, chit_id, 'cancel_request', { by_name: request.by_name || null, reason: request.reason || null, at: new Date().toISOString() });
}

/** a recipient that was asked cancelled its copy (b197): the sender's flag "cancel confirmed" is set where the sender is */
function onCancelConfirmed(entity_id, chit_id, confirmation) {
  return queueChange(entity_id, chit_id, 'cancel_confirm', { by_name: confirmation.by_name || null, at: new Date().toISOString() }, (parties) => parties.filter((party) => party.is_sender));
}

/**
 * A file was put on a chit (POST /api/attachments, the one door): told BY REFERENCE (id, name, type, size, sha-256 — never the bytes; CTP-DESIGN §6 rule 3), once per installation. The party
 * elsewhere pulls the bytes over the CTP door (the question `attachment`, answered only to a party of that chit) and stores its own copy for each of its participants, as the upload does here.
 */
function onAttachment(entity_id, file) {
  return queueChange(
    entity_id,
    file.chit_id,
    'attachment',
    { attachment_id: file.attachment_id, name: file.name, mime: file.mime, size: file.size, sha256: file.sha256, message_id: file.message_id || null, line_index: file.line_index == null ? null : file.line_index, at: new Date().toISOString() },
    onePerInstallation
  );
}

/** a version was put forward (lib/chit-proposal propose): a priced pro-forma or change, or a buyer's request — told as it was issued, to every party on another installation (one event each, so each writes its own row) */
function onProposal(entity_id, chit_id, proposal) {
  return queueChange(entity_id, chit_id, 'proposal', Object.assign({}, proposal, { at: new Date().toISOString() }));
}

/** a version was accepted or rejected (lib/chit-proposal decide): told to every party on another installation, who apply the SAME stored version — nothing is recomputed there */
function onProposalDecided(entity_id, chit_id, decision) {
  return queueChange(entity_id, chit_id, 'proposal_decide', Object.assign({}, decision, { at: new Date().toISOString() }));
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
  return require('./ctptransport').send(place.endpoint, env, row.kind === 'attachment' ? { timeout: ATTACH_TIMEOUT_MS } : undefined);
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
    message_ids: rows.filter((row) => (row.kind === 'message' || row.kind === 'dispute_message') && row.message_id).map((row) => row.message_id)
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

/* ── disputes: told, not re-decided ─────────────────────────────────────────────────────────────────────── */
/** one party per installation (the first by bridge id): a dispute event is dispute-wide, so one envelope per installation is enough, and a stable choice keeps a dispute's events in ONE stream, in order */
function onePerInstallation(parties) {
  const first = new Map();
  for (const party of [...parties].sort((left, right) => String(left.bridge_id).localeCompare(String(right.bridge_id)))) if (!first.has(party.installation_key)) first.set(party.installation_key, party);
  return [...first.values()];
}
const among = (parties, ids) => parties.filter((party) => (ids || []).some((id) => String(id) === String(party.entity_id)));

/** identity_id → { bridge_id, display_name } for these ids (identities is not tenant-scoped) */
async function bridgesFor(ids) {
  const wanted = [...new Set(ids.filter(Boolean).map(String))];
  if (!wanted.length) return new Map();
  const found = await query('SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])', [wanted]);
  return new Map(found.rows.map((row) => [String(row.identity_id), { bridge_id: row.bridge_id, display_name: row.display_name }]));
}

/** a dispute is raised: the route has already decided who may, the scope and the roster; this tells the roster's installations (chit-wide: every party elsewhere) */
function onDisputeRaised(entity_id, chit_id, dispute) {
  const choose = (parties) => onePerInstallation(dispute.scope === 'chit_wide' ? parties : among(parties, dispute.partyIds));
  return queueChange(entity_id, chit_id, 'dispute_raise', async () => {
    const bridges = await bridgesFor([dispute.raiser_id, dispute.target_id].concat(dispute.roster.map((row) => row.entity_id)));
    const named = (id) => (id && bridges.get(String(id))) || null;
    return {
      dispute_id: dispute.dispute_id,
      category: dispute.category,
      reason: dispute.reason,
      scope: dispute.scope,
      mode: dispute.mode,
      answerable: dispute.answerable,
      parity_state: dispute.parity_state,
      via: dispute.via,
      evidence: dispute.evidence,
      actor_name: dispute.actor_name,
      raiser: named(dispute.raiser_id),
      target: named(dispute.target_id) && Object.assign({ target_name: dispute.target_name }, named(dispute.target_id)),
      roster: dispute.roster.map((row) => ({ bridge_id: (named(row.entity_id) || {}).bridge_id || null, display_name: row.display_name, role: row.role })),
      reason_message_id: dispute.reason_message_id,
      at: new Date().toISOString()
    };
  }, choose);
}

/** a dispute message is posted: to the roster's installations when the dispute is targeted (to_ids = its roster), to every party elsewhere when chit-wide (to_ids null) */
function onDisputeMessage(entity_id, chit_id, posted) {
  const choose = (parties) => onePerInstallation(posted.to_ids ? among(parties, posted.to_ids) : parties);
  return queueChange(
    entity_id,
    chit_id,
    'dispute_message',
    { dispute_id: posted.dispute_id || null, message_id: posted.message_id, message_text: posted.message_text, msg_type: posted.msg_type || 'info', sender_display_name: posted.sender_display_name || null, line_id: posted.line_id || null, at: new Date().toISOString() },
    choose
  );
}

/** a dispute is resolved (the route has checked who may): the roster's installations record it on their copy */
async function onDisputeResolved(entity_id, chit_id, resolution) {
  let rosterIds = null;
  if (resolution.scope !== 'chit_wide') {
    try {
      rosterIds = (await query('SELECT entity_id FROM chit_dispute_roster($1)', [resolution.dispute_id])).rows.map((row) => row.entity_id);
    } catch (e) {
      log.warn('ctp.return-roster-unreadable', { dispute_id: resolution.dispute_id, error: String((e && e.message) || e) });
    }
  }
  const choose = (parties) => onePerInstallation(rosterIds ? among(parties, rosterIds) : parties);
  return queueChange(entity_id, chit_id, 'dispute_resolve', async () => {
    const target = resolution.target_id ? (await bridgesFor([resolution.target_id])).get(String(resolution.target_id)) : null;
    return { dispute_id: resolution.dispute_id, target: target || null, resolution_note: resolution.resolution_note, category: resolution.category, actor_name: resolution.actor_name, resolver_name: resolution.resolver_name, resolve_message_id: resolution.resolve_message_id, at: new Date().toISOString() };
  }, choose);
}

/** before a dispute is raised: a party on another installation holds a shadow row here, so it is a participant the roster can name (chit_participants, the parity probe) */
async function ensureShadows(entity_id, chit_id) {
  try {
    for (const party of await remoteParties(entity_id, chit_id)) await ensureShadowRow(chit_id, party.entity_id, party.is_sender);
  } catch (e) {
    log.warn('ctp.return-shadow-failed', { entity_id, chit_id, error: String((e && e.message) || e) });
  }
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
  return APPLIERS[change.kind](incoming, change, party.remote, held.senderIsRemote);
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

const DISPUTE_KINDS = ['dispute_raise', 'dispute_message', 'dispute_resolve'];
const badSeq = (change) => !Number.isInteger(change.seq) || change.seq < 1;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

/** the check for each kind of event (a kind that is not here is not an event this installation knows) */
const SHAPE_CHECKS = {
  status: (change) => statusProblem(change),
  message: (change) => messageProblem(change),
  attachment: (change) => attachmentProblem(change),
  proposal: (change) => proposalProblem(change),
  proposal_decide: (change) => proposalProblem(change),
  cancel_request: (change) => cancelProblem(change),
  cancel_confirm: (change) => cancelProblem(change),
  dispute_raise: (change) => disputeProblem(change),
  dispute_message: (change) => disputeProblem(change),
  dispute_resolve: (change) => disputeProblem(change)
};

/** the shape of an event, or the sentence saying what is wrong with it */
function checkShape(change) {
  const known = Object.prototype.hasOwnProperty.call(SHAPE_CHECKS, change.kind);
  return known ? SHAPE_CHECKS[change.kind](change) : 'not an event this installation knows';
}
function cancelProblem(change) {
  return badSeq(change) ? 'a cancel event carries a whole-number sequence from 1' : null;
}
function statusProblem(change) {
  if (badSeq(change)) return 'a status event carries a whole-number sequence from 1';
  if (!STATUS_WORD.test(String(change.status || ''))) return 'a status event names a status';
  if (change.copy !== undefined && railStatus.COPIES.indexOf(change.copy) < 0) return 'a status event names the received or the sent copy';
  return null;
}
/** a proposal event: its sequence and id, then what it says (a decision, or a version with its round) */
function proposalProblem(change) {
  if (badSeq(change)) return 'a proposal event carries a whole-number sequence from 1';
  if (!UUID_SHAPE.test(String(change.proposal_id || ''))) return 'a proposal event carries the proposal’s id';
  return change.kind === 'proposal_decide' ? decisionProblem(change) : versionProblem(change);
}
const decisionProblem = (change) => (change.decision === 'accept' || change.decision === 'reject' ? null : 'a decision is accept or reject');
function versionProblem(change) {
  if (['pro_forma', 'change', 'request', 'terms'].indexOf(change.version) < 0) return 'a proposal says what it is: pro_forma, change, request or terms';
  return !Number.isInteger(change.round) || change.round < 1 ? 'a proposal carries its round' : null;
}
/** an attachment event: the file's identity first, then its description */
function attachmentProblem(change) {
  if (badSeq(change)) return 'an attachment event carries a whole-number sequence from 1';
  if (!UUID_SHAPE.test(String(change.attachment_id || ''))) return 'an attachment event carries the file’s id';
  if (!SHA256.test(String(change.sha256 || ''))) return 'an attachment event carries the file’s sha-256';
  return attachmentFileProblem(change);
}
function attachmentFileProblem(change) {
  if (!Number.isInteger(change.size) || change.size < 1) return 'an attachment event carries the file’s size';
  if (!hasText(change.name) || typeof change.mime !== 'string') return 'an attachment event carries the file’s name and type';
  return change.message_id && !UUID_SHAPE.test(String(change.message_id)) ? 'an attachment event names its message by id' : null;
}
/** a dispute event: its id, then the message / resolution / raise it carries */
function disputeProblem(change) {
  if (!UUID_SHAPE.test(String(change.dispute_id || ''))) return 'a dispute event carries its dispute id';
  if (change.kind === 'dispute_message') return messageProblem(change);
  if (change.kind === 'dispute_resolve') return hasText(change.resolution_note) ? null : 'a resolution carries its note';
  return raiseProblem(change);
}
function raiseProblem(change) {
  if (!hasText(change.reason) || change.reason.length > MESSAGE_MAX) return 'a dispute carries its reason';
  const raiserKnown = !!change.raiser && !!change.raiser.bridge_id;
  return raiserKnown && Array.isArray(change.roster) && change.category ? null : 'a dispute carries its raiser, its category and its roster';
}
function messageProblem(change) {
  if (!UUID_SHAPE.test(String(change.message_id || ''))) return 'a message event carries its message id';
  const text = change.message_text;
  if (typeof text !== 'string' || !text.trim() || text.length > MESSAGE_MAX) return 'a message event carries text of up to ' + MESSAGE_MAX + ' characters';
  return null;
}

/** a status the other installation decided: mirror it on the shadow of that party's row, once, newest wins */
async function applyStatus(incoming, change, remote) {
  const by = byOf(incoming, change, remote);
  /* the shadow first, the watermark second: a failure between them is retried and the mirror is idempotent; the other order would lose the event */
  const mirror = async () => {
    await withEntity(remote.identity_id, (db) => railStatus.mirror(db, remote.identity_id, incoming.chit_id, change.status, change.copy || 'received'));
    await ringBell(incoming, remote, statusEvent(change.status, by));
  };
  return applyOnce(incoming, change, remote, mirror, (db) =>
    /* the timeline row every participant gets in one database (moveStatus → chit_log_all), written on OUR copy */
    db.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, previous_status, new_status, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [incoming.chit_id, incoming.to.identity_id, 'status_' + change.status, remote.identity_id, by, change.previous_status || null, change.status, String(change.note || 'Status changed from ' + (change.previous_status || '—') + ' to ' + change.status + ' by ' + by).slice(0, 2000)]
    )
  );
}

/** who made the change, for the timeline row */
const byOf = (incoming, change, remote) => change.by_name || change.sender_display_name || incoming.from.display_name || remote.display_name || 'The other side';

/**
 * THE ONE WAY A STATE CHANGE IS APPLIED, once: an event older than (or equal to) the highest one applied for this (chit, remote party, local party) is acknowledged and ignored;
 * otherwise the idempotent `effect` runs, THEN the watermark moves and `writeLog(db)` (optional) writes the timeline row in the same transaction. Effect first, watermark second:
 * a failure between them is retried, and the other order would lose the event. → the door's answer
 *
 * A MESSAGE is the exception to "older is ignored" (opts.effectAlways): its effect is idempotent by message id, so an earlier message that arrives late is still kept; only its timeline row is
 * gated by the watermark. The effect then returns true when it changed something, and that counts as applied.
 */
async function applyOnce(incoming, change, remote, effect, writeLog, opts) {
  const local = incoming.to.identity_id;
  const last = await withEntity(local, (db) =>
    db.query('SELECT last_seq FROM ctp_event_in WHERE chit_id = $1 AND remote_entity_id = $2 AND entity_id = $3', [incoming.chit_id, remote.identity_id, local])
  );
  const stale = last.rows.length && Number(last.rows[0].last_seq) >= change.seq;
  if (stale && !(opts && opts.effectAlways)) return { ok: true, applied: false, why: 'older or repeated — ignored' };
  const changed = (await effect()) === true;
  const advanced = await withEntity(local, async (db) => {
    const advance = await db.query(
      `INSERT INTO ctp_event_in (chit_id, remote_entity_id, entity_id, last_seq) VALUES ($1, $2, $3, $4)
       ON CONFLICT (chit_id, remote_entity_id, entity_id) DO UPDATE SET last_seq = EXCLUDED.last_seq, applied_at = now()
         WHERE ctp_event_in.last_seq < EXCLUDED.last_seq
       RETURNING last_seq`,
      [incoming.chit_id, remote.identity_id, local, change.seq]
    );
    if (!advance.rowCount) return false;
    if (writeLog) await writeLog(db);
    return true;
  });
  const applied = advanced || changed;
  return { ok: true, applied, why: applied ? 'applied' : 'older or repeated — ignored' };
}

/** the sender asked us to cancel: the flag "cancel requested" on OUR copy, through the stamp the void route uses, once */
async function applyCancelRequest(incoming, change, remote, senderIsRemote) {
  if (!senderIsRemote) return no(409, 'CTP_EVENT_PARTY_MISMATCH', 'only the sender can ask for a cancel');
  if (!(await schema.hasColumn('chit_status', 'cancel_requested_at'))) return { ok: true, applied: false, why: 'the flag is not set up on this installation — ignored' };
  return applyOnce(incoming, change, remote, () => require('./chit-move').stampCancelRequested(incoming.to.identity_id, incoming.chit_id, change.by_name || remote.display_name, change.reason));
}

/** a recipient confirmed its cancel: the flag "cancel confirmed" on the SENDER's copy here (ours), once */
async function applyCancelConfirm(incoming, change, remote, senderIsRemote) {
  if (senderIsRemote) return no(409, 'CTP_EVENT_PARTY_MISMATCH', 'only a recipient confirms a cancel');
  if (!(await schema.hasColumn('chit_status', 'cancel_confirmed_at'))) return { ok: true, applied: false, why: 'the flag is not set up on this installation — ignored' };
  return applyOnce(incoming, change, remote, () => require('./chit-move').stampCancelConfirmed(incoming.to.identity_id, incoming.chit_id, change.by_name || remote.display_name));
}

/**
 * THE BELL, on the receiver (RAIL-106): what rings for an arrived change is what rings for a local one — lib/events.emit, { kind, id: chit, who, … }, to the people on the chit who are not the sender
 * (routes/chits does the same through events.emit / events.notifyAfter, which only waits for the response; emit needs no `res`). A message rings { kind: 'message' }; an accepted, rejected or
 * cancelled status { kind: 'status', status }; a dispute raised or resolved { kind: 'dispute', what }; a proposal { kind: 'proposal', what }. `only` narrows it to a roster. Never throws: a bell that
 * cannot ring must not undo what arrived.
 */
async function ringBell(incoming, remote, event, only) {
  try {
    const ids = only || (await withEntity(incoming.to.identity_id, (db) => db.query('SELECT entity_id FROM chit_participants($1)', [incoming.chit_id]))).rows.map((row) => row.entity_id);
    const here = [];
    for (const id of ids) if (String(id) !== String(remote.identity_id) && (await addressBook.resolve(id)).local !== false) here.push(id);
    if (here.length) require('./events').emit(here, Object.assign({ id: incoming.chit_id, who: null }, event));
  } catch (e) {
    log.warn('ctp.return-bell-failed', { chit_id: incoming.chit_id, error: String((e && e.message) || e) });
  }
}

/** a chit arrived over the wire (routes/ctp.js, after the copy is written): the same bell the local send rings for each recipient (routes/chits send → events.notifyAfter { kind: 'chit' }) */
function onChitArrived(recipient_id, chit_id, header) {
  try {
    require('./events').emit([recipient_id], { kind: 'chit', id: chit_id, who: (header && header.sender_entity_display_name) || null, note: (header && header.purpose) || null });
  } catch (e) {
    log.warn('ctp.return-bell-failed', { chit_id, error: String((e && e.message) || e) });
  }
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

/**
 * Our copies of a message that arrived, through the one posting function, once (the same message id twice is kept once). → true when it was posted just now, false when it was already held.
 * The poster must hold a row (the fan-out is by chit_status), and the shadow of the other party is that row.
 */
async function postArrived(incoming, change, remote, senderIsRemote, extra) {
  const to = incoming.to.identity_id;
  const have = await withEntity(to, (db) => db.query('SELECT 1 FROM chit_messages WHERE message_id = $1 AND entity_id = $2 LIMIT 1', [change.message_id, to]));
  if (have.rows.length) return false;
  await ensureShadowRow(incoming.chit_id, remote.identity_id, senderIsRemote);
  try {
    await require('./chit-crossing').postMessageCopies(
      Object.assign(
        {
          message_id: change.message_id,
          chit_id: incoming.chit_id,
          sender_entity_id: remote.identity_id,
          sender_display_name: byOf(incoming, change, remote),
          thread_type: 'external',
          message_text: change.message_text,
          msg_type: MSG_TYPES.indexOf(change.msg_type) >= 0 ? change.msg_type : 'info',
          line_id: UUID_SHAPE.test(String(change.line_id || '')) ? change.line_id : null,
          arrived: true /* ARRIVAL IS NOT A ROUTING DECISION: written here, never queued onward */
        },
        extra || {}
      )
    );
  } catch (e) {
    if (e && e.code === '23505') return false; /* the same event arrived twice at once */
    throw e;
  }
  return true;
}

/**
 * an external message from the other side: our copies of it (once), the bell, and the timeline row for THIS party. Every local party has its own event (one per remote party), so each
 * gets its own row — a second person here is no longer left without one (the message itself is held after the first event, the row is not).
 */
async function applyMessage(incoming, change, remote, senderIsRemote) {
  const by = byOf(incoming, change, remote);
  return applyOnce(
    incoming,
    change,
    remote,
    async () => {
      const posted = await postArrived(incoming, change, remote, senderIsRemote);
      if (posted) await ringBell(incoming, remote, { kind: 'message', who: by });
      return posted;
    },
    (db) =>
      db.query(`INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1, $2, 'message_sent', $3, $4, $5)`, [
        incoming.chit_id, incoming.to.identity_id, remote.identity_id, by, change.message_text.slice(0, 100)
      ]),
    { effectAlways: true }
  );
}

/** the entities that hold a copy of this dispute here (its roster) when it is targeted; null when it is chit-wide (then everyone on the chit is its audience) */
async function disputeAudience(raiser_or_party_id, chit_id, dispute_id) {
  const scope = await withEntity(raiser_or_party_id, (db) => db.query('SELECT scope FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1', [dispute_id, chit_id]));
  if (!scope.rows.length || scope.rows[0].scope === 'chit_wide') return null;
  return (await query('SELECT entity_id FROM chit_dispute_roster($1)', [dispute_id])).rows.map((row) => row.entity_id);
}
/**
 * a dispute message from the other side: our copies go to the dispute's roster here (chit_message_deliver), the bell rings the roster (or the chit, when chit-wide), and the timeline row is
 * written for the same audience through the definers the local route uses (chit_log_targets for a roster, chit_log_all for the whole chit) — every local party in it, not only the one the event was addressed to.
 */
async function applyDisputeMessage(incoming, change, remote, senderIsRemote) {
  const mine = await withEntity(remote.identity_id, (db) => db.query('SELECT 1 FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1', [change.dispute_id, incoming.chit_id]));
  if (!mine.rows.length) return no(404, 'CTP_EVENT_NO_DISPUTE', 'this installation holds no such dispute for that business');
  const by = byOf(incoming, change, remote);
  const audience = await disputeAudience(remote.identity_id, incoming.chit_id, change.dispute_id);
  const detail = change.message_text.slice(0, 100);
  return applyOnce(
    incoming,
    change,
    remote,
    async () => {
      const posted = await postArrived(incoming, change, remote, senderIsRemote, { is_dispute: true, dispute_id: change.dispute_id });
      if (posted) await ringBell(incoming, remote, { kind: 'message', who: by }, audience);
      return posted;
    },
    (db) =>
      audience
        ? db.query('SELECT chit_log_targets($1,$2,$3,$4,$5,$6)', [incoming.chit_id, audience, 'message_sent', remote.identity_id, by, detail])
        : db.query('SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)', [incoming.chit_id, 'message_sent', remote.identity_id, by, null, null, detail]),
    { effectAlways: true }
  );
}

/** bridge id → local identity row, for the bridge ids a dispute names (a party we hold no row for is simply not on a copy here) */
async function localByBridge(bridges) {
  const wanted = [...new Set(bridges.filter(Boolean).map(String))];
  if (!wanted.length) return new Map();
  const found = await query(`SELECT identity_id, bridge_id FROM identities WHERE bridge_id = ANY($1::text[]) AND identity_type = 'entity'`, [wanted]);
  return new Map(found.rows.map((row) => [String(row.bridge_id), row.identity_id]));
}

/** a dispute raised on another installation: recorded on OUR copy through the same writer the route uses, as the remote raiser; held already (same dispute id) = ignored */
async function applyDisputeRaise(incoming, change, remote, senderIsRemote) {
  if (String(change.raiser.bridge_id) !== String(incoming.from.bridge_id)) return no(409, 'CTP_EVENT_PARTY_MISMATCH', 'only the raiser’s own installation can tell us of its dispute');
  await ensureShadowRow(incoming.chit_id, remote.identity_id, senderIsRemote);
  const held = await withEntity(remote.identity_id, (db) => db.query('SELECT 1 FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1', [change.dispute_id, incoming.chit_id]));
  if (held.rows.length) return { ok: true, applied: false, why: 'already held — ignored' };
  const local = await localByBridge(change.roster.map((row) => row.bridge_id).concat([change.target && change.target.bridge_id]));
  const idOf = (bridge) => (String(bridge) === String(incoming.from.bridge_id) ? remote.identity_id : local.get(String(bridge)) || null);
  const roster = change.roster.map((row) => ({ entity_id: idOf(row.bridge_id), display_name: row.display_name, role: row.role }));
  const partyIds = roster.filter((row) => row.role === 'party' && row.entity_id).map((row) => row.entity_id);
  const chits = require('../routes/chits');
  try {
    await withEntity(remote.identity_id, (client) =>
      chits.recordRaise(client, {
        dispute_id: change.dispute_id, chit_id: incoming.chit_id, raiser_id: remote.identity_id, raiser_name: change.raiser.display_name || remote.display_name, actor_name: change.actor_name || change.raiser.display_name || 'The other side',
        target_id: change.target ? idOf(change.target.bridge_id) : null, target_name: change.target ? change.target.target_name || change.target.display_name : null,
        scope: change.scope, parity: { mode: change.mode, answerable: change.answerable, parity_state: change.parity_state }, via: change.via || 'chit', category: change.category, reason: change.reason,
        evidence: change.evidence || {}, roster, audience: [...new Set([remote.identity_id].concat(partyIds))], partyIds, reason_message_id: change.reason_message_id
      })
    );
  } catch (e) {
    if (e && e.code === '23505') return { ok: true, applied: false, why: 'already held — ignored' };
    throw e;
  }
  await ringBell(incoming, remote, { kind: 'dispute', what: 'raised', who: change.actor_name || change.raiser.display_name }, partyIds);
  return { ok: true, applied: true, why: 'applied' };
}

/** a dispute message from the other side: our copies of it go to the dispute's roster here (chit_message_deliver), under the same message id */

/** the party a resolution is aimed at, held here: { party } — { party: null } when it is for everyone — or { missing: true } when that party has no copy here */
async function resolveTarget(change) {
  if (!change.target) return { party: null };
  const found = (await localByBridge([change.target.bridge_id])).get(String(change.target.bridge_id)) || null;
  return found ? { party: found } : { missing: true };
}

/** the parties of the dispute that are still open (all of them, or only the target) */
async function openParties(change, targetParty) {
  const roster = await query('SELECT entity_id, role, status FROM chit_dispute_roster($1)', [change.dispute_id]);
  return roster.rows.filter((row) => row.role === 'party' && row.status === 'open' && (!targetParty || String(row.entity_id) === String(targetParty)));
}

/** only the raiser resolves a dispute, and this installation must hold it: the refusal, or null */
function resolverProblem(ownCopy) {
  if (!ownCopy.rows.length) return no(404, 'CTP_EVENT_NO_DISPUTE', 'this installation holds no such dispute for that business');
  return ownCopy.rows[0].role === 'raiser' ? null : no(409, 'CTP_EVENT_PARTY_MISMATCH', 'only the raiser can resolve a dispute');
}

/** a resolution made on the raiser's installation: recorded through the same writer; already resolved here = ignored */
async function applyDisputeResolve(incoming, change, remote) {
  const ownCopy = await withEntity(remote.identity_id, (db) => db.query('SELECT role, category FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1', [change.dispute_id, incoming.chit_id]));
  const problem = resolverProblem(ownCopy);
  if (problem) return problem;
  const target = await resolveTarget(change);
  if (target.missing) return { ok: true, applied: false, why: 'that party has no copy here — ignored' };
  if (!(await openParties(change, target.party)).length) return { ok: true, applied: false, why: 'already resolved — ignored' };
  const chits = require('../routes/chits');
  const out = await withEntity(remote.identity_id, (client) =>
    chits.recordResolve(client, {
      dispute_id: change.dispute_id, chit_id: incoming.chit_id, resolver_id: remote.identity_id, resolver_name: change.resolver_name || remote.display_name, actor_name: change.actor_name || change.resolver_name || 'The other side',
      targetParty: target.party, resolution_note: change.resolution_note, category: change.category || ownCopy.rows[0].category, resolve_message_id: change.resolve_message_id
    })
  );
  const here = [];
  for (const id of out.resolvedPartyIds || []) if ((await addressBook.resolve(id)).local !== false) here.push(id);
  chits.releaseAfterResolve({ allResolved: out.allResolved, resolvedPartyIds: here }, incoming.chit_id, []);
  await ringBell(incoming, remote, { kind: 'dispute', what: 'resolved', who: change.actor_name || change.resolver_name }, here);
  return { ok: true, applied: true, why: 'applied' };
}

/** the id of OUR copy of a file that arrived: derived from the sender's attachment id and the entity that holds it, so the same event applied twice stores it once */
function arrivedId(attachment_id, entity_id) {
  const bytes = require('crypto').createHash('sha1').update(String(attachment_id) + ':' + String(entity_id)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = bytes.toString('hex');
  return digits.slice(0, 8) + '-' + digits.slice(8, 12) + '-' + digits.slice(12, 16) + '-' + digits.slice(16, 20) + '-' + digits.slice(20, 32);
}

/** does a party of this chit live on the asking installation? (the chit's parties as ONE business's own header names them) */
async function hasPartyOn(owner_id, chit_id, installation_key) {
  const header = await withEntity(owner_id, (db) =>
    db.query('SELECT sender_entity_bridge_id, all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, owner_id])
  );
  const bridges = bridgesOf(header.rows[0]);
  if (!bridges.length) return false;
  const found = await query(`SELECT identity_id FROM identities WHERE bridge_id = ANY($1::text[]) AND identity_type = 'entity'`, [bridges]);
  for (const person of found.rows) {
    const place = await addressBook.resolve(person.identity_id);
    if (place.local === false && place.installation_key === installation_key) return true;
  }
  return false;
}

/**
 * THE ANSWER to the question `attachment` (the query door has already proved WHO is asking and that it holds a membership pass): the file, to a party of that chit only. Never to a stranger,
 * never an internal note's file, never above the size limit. A refusal is "not found" in words, so a stranger learns nothing about what exists.
 */
async function attachmentFor(asker_key, question) {
  const found = await sharedBlob(asker_key, question);
  if (found.why) return { ok: true, found: false, why: found.why };
  const blob = found.blob;
  const storage = require('./storage');
  const bytes = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data || '');
  if (bytes.length > storage.MAX_ATTACHMENT_BYTES) return { ok: true, found: false, why: 'the file is larger than the ' + storage.MAX_ATTACHMENT_BYTES / 1048576 + ' MB limit' };
  return { ok: true, found: true, name: blob.name, mime: blob.mime, size: bytes.length, sha256: require('crypto').createHash('sha256').update(bytes).digest('hex'), data_base64: bytes.toString('base64') };
}

/** the file asked for, when it may be shared with the asking installation: { blob } — or { why }, the words a stranger is told (never more than "not found") */
async function sharedBlob(asker_key, question) {
  const owner = await query(`SELECT identity_id FROM identities WHERE bridge_id = $1 AND identity_type = 'entity'`, [String(question.owner_bridge_id || '')]);
  if (!owner.rows.length) return { why: 'no such business here' };
  const owner_id = owner.rows[0].identity_id;
  if (!(await hasPartyOn(owner_id, question.chit_id, asker_key))) return { why: 'that file is not shared with your installation' };
  const blob = await require('./storage').getBlob(question.attachment_id, owner_id);
  if (!blob || String(blob.chit_id) !== String(question.chit_id)) return { why: 'no such file on that chit' };
  if (blob.message_id && (await isInternalNote(owner_id, blob.message_id))) return { why: 'that file is an internal note’s and is not shared' };
  return { blob };
}

/** is this message an internal note (visible to one business only)? */
async function isInternalNote(owner_id, message_id) {
  const note = await withEntity(owner_id, (db) => db.query('SELECT visibility_entity_id FROM chit_messages WHERE message_id = $1 AND entity_id = $2 LIMIT 1', [message_id, owner_id]));
  return !!(note.rows[0] && note.rows[0].visibility_entity_id);
}

/** the other installation told us of a file on a chit: pull it over the CTP door, check it is the file announced, and store OUR copy for each participant here (the upload's own writer) */
async function applyAttachment(incoming, change, remote) {
  const storage = require('./storage');
  if (change.size > storage.MAX_ATTACHMENT_BYTES) {
    return no(413, 'CTP_EVENT_TOO_LARGE', 'the file “' + change.name + '” is ' + Math.ceil(change.size / 1048576) + ' MB; the limit is ' + storage.MAX_ATTACHMENT_BYTES / 1048576 + ' MB, so it was not taken');
  }
  try {
    return await applyOnce(incoming, change, remote, () => pullAndStore(incoming, change, remote, storage));
  } catch (failure) {
    if (failure && failure.refusal) return failure.refusal;
    throw failure;
  }
}

/** an error that carries the door's refusal, so applyAttachment can answer it in words */
const arrivalRefusal = (status, code, reason) => Object.assign(new Error(reason), { refusal: no(status, code, reason) });

/** the message a file belongs to must have arrived first */
async function requireMessageHere(local, change) {
  if (!change.message_id) return;
  const message = await withEntity(local, (db) => db.query('SELECT 1 FROM chit_messages WHERE message_id = $1 AND entity_id = $2 LIMIT 1', [change.message_id, local]));
  if (!message.rows.length) throw arrivalRefusal(404, 'CTP_EVENT_NOT_YET', 'the message this file belongs to has not arrived here yet');
}

/** ask the far installation for the file and check it is the one announced (size and checksum) → its bytes */
async function fetchAnnounced(incoming, change, remote, storage) {
  const place = await addressBook.resolve(remote.identity_id);
  const installation = await query('SELECT domain FROM installation WHERE installation_key = $1', [incoming.from.installation_key]);
  const answer = await require('./ctpquery').ask(
    { domain: installation.rows[0] && installation.rows[0].domain },
    { want: 'attachment', attachment_id: change.attachment_id, chit_id: incoming.chit_id, owner_bridge_id: incoming.from.bridge_id },
    { resolvePeer: async (target) => ({ installation_key: incoming.from.installation_key, endpoint: place.endpoint, domain: target.domain }), timeout: ATTACH_TIMEOUT_MS }
  );
  if (!answer.ok || !answer.found) throw arrivalRefusal(502, 'CTP_EVENT_ATTACHMENT_UNREADABLE', 'could not fetch “' + change.name + '” from ' + incoming.from.installation_key + ': ' + (answer.why || 'no answer'));
  const buffer = Buffer.from(String(answer.data_base64 || ''), 'base64');
  const sha256 = require('crypto').createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== change.size || buffer.length > storage.MAX_ATTACHMENT_BYTES || sha256 !== change.sha256) {
    throw arrivalRefusal(502, 'CTP_EVENT_ATTACHMENT_UNREADABLE', '“' + change.name + '” did not arrive as announced (size or checksum differs), so it was not stored');
  }
  return buffer;
}

/** pull the announced file (once: a copy already held is left) and store OUR copy for each participant here, under ids derived from the sender's */
async function pullAndStore(incoming, change, remote, storage) {
  const local = incoming.to.identity_id;
  await requireMessageHere(local, change);
  const held = await withEntity(local, (db) => db.query('SELECT 1 FROM cb_attachment WHERE id = $1 LIMIT 1', [arrivedId(change.attachment_id, local)]));
  if (held.rows.length) return;
  const buffer = await fetchAnnounced(incoming, change, remote, storage);
  const participants = (await withEntity(local, (db) => db.query('SELECT entity_id FROM chit_participants($1)', [incoming.chit_id]))).rows.map((row) => row.entity_id);
  await storage.putForParticipants({
    chit_id: incoming.chit_id, message_id: change.message_id || null, line_index: change.line_index == null ? null : change.line_index, name: String(change.name).slice(0, 200), mime: String(change.mime).slice(0, 120),
    size: buffer.length, buffer, uploaded_by: remote.identity_id, participants, forEntity: null, idFor: (entity) => arrivedId(change.attachment_id, entity)
  });
}

/** words for a version that could not be applied here, as the door's refusal */
function proposalRefusal(failure) {
  if (!failure || !failure.refused) throw failure;
  if (failure.code === 'PROPOSAL_NOT_FOUND') return no(404, 'CTP_EVENT_NOT_YET', failure.message);
  return no(failure.status || 409, 'CTP_EVENT_CHANGE_NOT_APPLIED', failure.message);
}

/** a version (a priced pro-forma, a change, or a buyer's request) put forward on the other installation: kept on OUR copy exactly as it was issued — the invoice and money are the proposer's, never recomputed here */
async function applyProposal(incoming, change, remote) {
  const proposals = require('./chit-proposal');
  const by = byOf(incoming, change, remote);
  try {
    return await applyOnce(incoming, change, remote, async () => {
      const kept = await proposals.receive(incoming.to.identity_id, { identity_id: remote.identity_id, bridge_id: incoming.from.bridge_id, display_name: remote.display_name }, incoming.chit_id, change);
      await ringBell(incoming, remote, { kind: 'proposal', what: kept.what, who: by });
    });
  } catch (failure) {
    return proposalRefusal(failure);
  }
}

/** the other side accepted or rejected a version: the same stored version is applied to OUR copy (accept) or closed (reject); the decision was made, and checked for staleness, where the person acted */
async function applyProposalDecision(incoming, change, remote) {
  const proposals = require('./chit-proposal');
  const by = byOf(incoming, change, remote);
  try {
    return await applyOnce(incoming, change, remote, async () => {
      const done = await proposals.receiveDecision(incoming.to.identity_id, { identity_id: remote.identity_id, bridge_id: incoming.from.bridge_id, display_name: remote.display_name }, incoming.chit_id, change);
      if (done.applied) await ringBell(incoming, remote, { kind: 'proposal', what: done.what, who: by });
    });
  } catch (failure) {
    return proposalRefusal(failure);
  }
}

const APPLIERS = { status: applyStatus, message: applyMessage, dispute_raise: applyDisputeRaise, dispute_message: applyDisputeMessage, dispute_resolve: applyDisputeResolve, cancel_request: applyCancelRequest, cancel_confirm: applyCancelConfirm, attachment: applyAttachment, proposal: applyProposal, proposal_decide: applyProposalDecision };

module.exports = { statusEvent,
  remoteParties,
  queueChange,
  onStatusMoved,
  onProposal,
  onProposalDecided,
  onChitArrived,
  onAttachment,
  attachmentFor,
  onCancelRequested,
  onCancelConfirmed,
  firstOf,
  onMessagePosted,
  drain,
  sendOne,
  unconfirmed,
  answerOf,
  markOf,
  markMessages,
  onDisputeRaised,
  onDisputeMessage,
  onDisputeResolved,
  ensureShadows,
  apply,
  checkShape,
  backoff,
  UNCONFIRMED_WORDS,
  FAILED_WORDS,
  MAX_ATTEMPTS
};
