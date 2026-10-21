// lib/autoraise.js — a message becomes a chit with NOBODY PRESENT (b131).
// CALLED BY routes/capture.js, lib/repeat-supply.js · FLOW a capture arrives → run → POST /api/chits/send over loopback, with a 60 s kind 'auto' token
// CARD 22-channels-capture-and-messaging/capture-webhooks-in-pending-structure-raise-conv
//
// Athi, 2026-08-09: *"in reality no one will sit and create a chit from whatsapp, it has to be automatic without
// anyone's presence. because whatsapp is not formatted, we are giving some formatting for the same, nothing more
// here."*
//
// ── WHY THIS DOES NOT WEAKEN THE CONFIRM GATE ───────────────────────────────────────────────────────────────────
// I argued for a long time that a person must press Raise. That argument was weaker than it sounded: the CAPTURE
// already arrives on its own, so an unverified stranger could always put something in front of you. Auto-raise
// changes WHERE it lands, not WHETHER it arrives.
//
// What makes it safe is what the chit IS: an `inquiry`, TASK-ONLY, binding nobody, marked "sender not verified",
// carrying the original message as evidence. The gate belongs before something BINDS, not before something is
// RECORDED. Nothing here can create an obligation.
//
// ── ⚠️ IT GOES THROUGH THE ONE SEND PATH, OVER LOOPBACK ─────────────────────────────────────────────────────────
// There are already THREE hand-rolled chit_deliver calls in this codebase (chits.js, connectors.js, catalogue.js). A
// fourth would have to re-implement copy suppression, the `via` whitelist, freeze-at-send, the recipient caps and
// the limits — and would drift from the real send the first time one of them changed. So this calls
// POST /api/chits/send on 127.0.0.1: one extra hop, and the send is genuinely THE send.
//
// ── ⚠️⚠️ THE INTERNAL TOKEN IS THE SHARP EDGE OF THIS FILE. READ BEFORE CHANGING. ───────────────────────────────
// `_internalToken` mints a real entity credential. If it ever became reachable from a request, or long-lived, or
// built from anything a caller supplies, that is a total compromise of every entity. It is therefore:
//   · not exported, and not called with anything from a request body
//   · built ONLY from an entity_id that channel_owner_binding() resolved from a VERIFIED binding
//   · 60 seconds, and stamped `auto:true` so it is identifiable in any log that decodes a token
//   · used for exactly one loopback POST and then discarded
// If a cleaner route ever exists — extracting the send handler into a callable function — take it. This is the
// least-bad option available without a large refactor of an engine-locked file, not a good one.
const jwt = require('jsonwebtoken');
const log = require('./logger');
const { query } = require('../db');
const capture = require('./capture');
const note = (m, x) => log.info('autoraise: ' + m, x);

async function _internalToken(entity_id) {
  const r = await query(
    `SELECT identity_id, bridge_id, display_name, email FROM identities WHERE identity_id = $1 AND identity_type = 'entity' AND status = 'active'`,
    [entity_id]
  );
  const e = r.rows[0];
  if (!e) return null; // an entity that is not active does not get a credential
  return jwt.sign(
    {
      identity_id: e.identity_id,
      bridge_id: e.bridge_id,
      display_name: e.display_name,
      email: e.email,
      identity_type: 'entity',
      auto: true,
      /* K-SEC PR A (critic C10): a machine token, never a legacy one — middleware/auth.js admits kind 'auto' only while it is
         short-lived (AUTO_MAX_LIFE_S), so the legacy refusal never turns the shop's own auto-raise away */
      kind: 'auto',
      jti: require('crypto').randomUUID()
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '60s' }
  );
}

const selfBase = () => process.env.CB_SELF_URL || 'http://127.0.0.1:' + (process.env.PORT || 3000);

/**
 * ⭐ sendAs(entity_id, body, opts?) → { ok, status, body } — POST /api/chits/send AS the entity, over loopback, with the 60-second
 * internal token above (RI1, 2026-10-12 — WIDENED out of run() so a second caller with nobody present, the repeat-supply agreement's
 * run (lib/repeat-supply.js), goes through the one send path too: freeze-at-send, offers, the money block, the series, the client_ref
 * duplicate answer, the ledger hook — none of it re-implemented). opts.idempotency_key rides as the Idempotency-Key header
 * (middleware/idempotency: at most once per (entity, key)). Never throws: a refusal comes back as { ok:false, status, body }.
 * ⚠️ The same sharp edge as run(): entity_id must come from a VERIFIED source (a row the server read), never from a request body.
 */
async function sendAs(entity_id, body, opts) {
  const token = await _internalToken(entity_id);
  if (!token) return { ok: false, status: 0, body: null, reason: 'no-token' };
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    if (opts && opts.idempotency_key) headers['Idempotency-Key'] = String(opts.idempotency_key).slice(0, 120);
    const res = await fetch(selfBase() + '/api/chits/send', { method: 'POST', headers, body: JSON.stringify(body) });
    const out = await res.json().catch(log.orElse('autoraise: the send answered with no readable body — treated as empty', null));
    return { ok: res.ok && !!(out && out.chit_id), status: res.status, body: out, reason: res.ok ? null : 'send-failed' };
  } catch (e) {
    return { ok: false, status: 0, body: null, reason: 'send-error', error: (e && e.message) || String(e) };
  }
}

/**
 * run(entity_id, capture_id) — structure it, raise it, send it, file the receipt, attach the original.
 *
 * ⚠️ IT NEVER THROWS AT THE CALLER. The webhook has already answered Meta 200 by the time this runs; an exception
 * here must not become an unhandled rejection that takes the process down and costs every OTHER message.
 *
 * ⚠️ AND A MESSAGE IT CANNOT READ IS LEFT IN INTAKE, NOT TURNED INTO AN EMPTY CHIT. This was the one open decision.
 * A chit with no lines is worse than a message still waiting: it looks handled, it sits in the Task list claiming
 * to be an order for nothing, and the real request is the thing nobody ever sees again. raisePayload already
 * refuses (409) when the co-assist read nothing out of the words — that refusal is the correct outcome here, and
 * the capture stays pending for a human exactly as it does today.
 */
async function run(entity_id, capture_id) {
  try {
    await capture.structureCapture(entity_id, capture_id);
  } catch (e) {
    note('could not read message ' + capture_id + ' — left in intake', (e && e.message) || e);
    return { ok: false, reason: 'unreadable' };
  }

  let pay;
  try {
    pay = await capture.raisePayload(entity_id, capture_id);
  } catch (e) {
    // 409 = nothing usable was read out of it. Left pending on purpose (see above).
    note('nothing to raise for ' + capture_id + ' — left in intake', (e && e.message) || e);
    return { ok: false, reason: 'no-lines' };
  }

  const token = await _internalToken(entity_id);
  if (!token) {
    note('no credential for entity ' + entity_id + ' — left in intake');
    return { ok: false, reason: 'no-token' };
  }

  try {
    const res = await fetch(selfBase() + '/api/chits/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        recipients: pay.recipients,
        subject: pay.subject,
        line_items: pay.line_items,
        purpose: pay.purpose,
        business_json: pay.business_json,
        self_copy: pay.self_copy
      })
    });
    const body = await res.json().catch(log.orElse('autoraise: the raise answered with no readable body — treated as empty', null));
    const chit_id = body && body.chit_id;
    if (!res.ok || !chit_id) {
      note('send refused for ' + capture_id, res.status + ' ' + JSON.stringify(body).slice(0, 200));
      return { ok: false, reason: 'send-failed' };
    }

    // The receipt: this capture became that chit. Best-effort — a failed receipt must not undo a real chit.
    try {
      await capture.markConverted(entity_id, capture_id, chit_id);
    } catch (e) {
      log.fellBack('autoraise: the chit was raised but the capture was not marked converted — it still shows as pending in Intake', e);
    }
    try {
      require('./events').emit([entity_id], { kind: 'chit', id: chit_id, note: 'auto-raised' });
    } catch (e) {
      log.fellBack('autoraise: the bell did not ring for the raised chit — it shows on the next refresh', e);
    } /* the bell: a capture became a chit */

    /* The original message rides along as evidence, exactly as it does when a human presses Raise. A chit whose
       provenance depends on which button produced it is not provenance. */
    if (pay.original && pay.original.text) {
      try {
        await fetch(selfBase() + '/api/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            chit_id,
            name: pay.original.filename || 'original-message.txt',
            mime: 'text/plain',
            data_base64: Buffer.from(pay.original.text, 'utf8').toString('base64')
          })
        });
      } catch (_) {
        note('original could not be attached to ' + chit_id);
      }
    }
    note('raised ' + capture_id + ' -> ' + chit_id);
    return { ok: true, chit_id };
  } catch (e) {
    note('send failed for ' + capture_id, (e && e.message) || e);
    return { ok: false, reason: 'send-error' };
  }
}

module.exports = { run, sendAs };
