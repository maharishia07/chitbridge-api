// lib/whatsapp-out.js — NOTIFY BACK. A chit's status change reaches the customer on the channel they wrote in on.
//
// SPEC-capture-connector.md: "channel → CAPTURE → AI STRUCTURE → HUMAN CONFIRM → CHIT on rail → notify back to
// channel." Inbound has been live since b123/b124; this is the return leg. See migration b126.
//
// ── ⚠️ A REPLY IS A NOTICE, NOT THE RECORD ──────────────────────────────────────────────────────────────────────
// The chit is the record. A WhatsApp message saying "accepted" is a courtesy copy for someone who lives in
// WhatsApp, and if the two ever disagree the chit is right. So this never writes back onto the chit, and a send
// that fails must never fail the chit operation that triggered it.
//
// ── ⚠️ META'S 24-HOUR WINDOW IS A RULE, NOT A RATE LIMIT ────────────────────────────────────────────────────────
// Free-form text may only be sent within 24 hours of the customer's last inbound message. Outside it, ONLY a
// pre-approved template may be sent, and we have none registered. So outside the window this REFUSES and records
// why, rather than posting something Meta will reject — a queued message that silently never arrives is worse
// than an honest "not sent", because the shop believes the customer was told.
const { withEntity } = require('../db');

const GRAPH = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v21.0';
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Outbound needs its OWN credential — the inbound app secret cannot send. */
function canSend() { return !!process.env.WHATSAPP_TOKEN; }

/**
 * Is this recipient inside the customer-service window? Measured from the LAST inbound we hold from them, which
 * is the only evidence we have of when they last wrote.
 *
 * ⚠️ Absent evidence is treated as OUTSIDE the window, never inside. Guessing "probably fine" here means sending a
 * message Meta rejects — or worse, bills as a business-initiated conversation nobody authorised.
 */
async function windowOpen(entity_id, to_ref) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT MAX(created_at) AS last_in FROM capture
        WHERE entity_id = $1 AND channel = 'whatsapp' AND sender_ref = $2`, [entity_id, to_ref]));
    const last = r.rows[0] && r.rows[0].last_in;
    if (!last) return { open: false, reason: 'no inbound message from this number — the 24-hour window is closed' };
    const age = Date.now() - new Date(last).getTime();
    if (age > WINDOW_MS) return { open: false, reason: 'their last message was over 24 hours ago; only a pre-approved template may be sent, and none is registered' };
    return { open: true, last };
  } catch (e) { return { open: false, reason: 'could not read the inbound history' }; }
}

/**
 * The single template every status update rides in. ⚠️ ONE, deliberately: each template needs its own Meta
 * approval, and a business waiting on five approvals to get one message out will ship none of them. The status
 * sentence travels as the parameter.
 */
const TEMPLATE_FOR_STATUS = 'order_status_update';

/** The binding for the line we are sending FROM — it carries the per-number template approvals. */
async function _bindingFor(entity_id, from_ref) {
  if (!from_ref) return null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT id, address, templates FROM channel_binding
        WHERE entity_id = $1 AND channel = 'whatsapp' AND lower(address) = lower($2) LIMIT 1`, [entity_id, from_ref]));
    return r.rows[0] || null;
  } catch (e) { return null; }
}

/** Record every attempt, including the ones we decline. A notification never attempted is not one that failed. */
async function _log(entity_id, row) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `INSERT INTO channel_outbound (entity_id, chit_id, capture_id, channel, from_ref, to_ref, body, status, reason, provider_msg_id)
       VALUES ($1,$2,$3,'whatsapp',$4,$5,$6,$7,$8,$9) RETURNING id, status, reason`,
      [entity_id, row.chit_id || null, row.capture_id || null, row.from_ref || null, row.to_ref,
       row.body || null, row.status, row.reason || null, row.provider_msg_id || null]));
    return r.rows[0];
  } catch (e) { return { status: row.status, reason: row.reason, note: 'not logged (b126 not migrated?)' }; }
}

/**
 * notify — send `text` to `to_ref` from the line they wrote to, if the window allows it.
 *
 * Returns a RESULT, never throws. Callers are chit operations that must not be affected by whether a courtesy
 * message got out.
 */
async function notify(entity_id, { to_ref, from_ref, provider_ref, text, chit_id, capture_id }) {
  if (!to_ref || !text) return { status: 'refused', reason: 'nothing to send' };
  if (!canSend()) return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'refused', reason: 'WHATSAPP_TOKEN is not set — outbound is not configured' });
  if (!provider_ref) return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'refused', reason: 'the binding has no provider_ref (phone_number_id) — cannot address a send' });

  /**
   * ⚠️ INSIDE THE WINDOW → FREE TEXT. OUTSIDE → A TEMPLATE, OR NOTHING (b128).
   *
   * Outside Meta's 24 hours a free-form message is simply rejected, so the only way to say anything is a template
   * the business has had approved on THEIR account. Approval is per-WABA: our having written the template, or
   * another business having had theirs approved, says nothing about whether this number may send it. So the flag
   * is read off the binding, and an absent flag means NO.
   *
   * ⚠️ THIS IS THE ONLY PATH THAT SPENDS ON SOMEBODY WHO IS NOT TALKING TO US. Inside the window the customer
   * just wrote in; outside it, a template send is a business-initiated conversation and is billed as one. That is
   * why it takes an explicit per-number approval rather than being on by default.
   */
  const win = await windowOpen(entity_id, to_ref);
  let payload;
  if (win.open) {
    payload = { messaging_product: 'whatsapp', to: String(to_ref).replace(/^\+/, ''), type: 'text',
                text: { preview_url: false, body: String(text).slice(0, 4000) } };
  } else {
    const tpl = require('./whatsapp-templates');
    const binding = await _bindingFor(entity_id, from_ref);
    if (!binding || !tpl.approvedOn(binding, TEMPLATE_FOR_STATUS)) {
      return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'refused',
        reason: win.reason + ' — and "' + TEMPLATE_FOR_STATUS + '" is not approved on this number, so nothing can be sent' });
    }
    payload = tpl.buildSend(to_ref, TEMPLATE_FOR_STATUS, [text]);
    if (!payload) return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'refused', reason: 'no such template' });
  }

  try {
    const res = await fetch(GRAPH + '/' + encodeURIComponent(provider_ref) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN },
      body: JSON.stringify(payload),
    });
    let j = null; try { j = await res.json(); } catch (_) {}
    if (!res.ok) {
      const why = (j && j.error && j.error.message) || ('provider returned ' + res.status);
      return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'failed', reason: why });
    }
    const id = j && j.messages && j.messages[0] && j.messages[0].id;
    return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'sent', provider_msg_id: id });
  } catch (e) {
    return _log(entity_id, { chit_id, capture_id, from_ref, to_ref, body: text, status: 'failed', reason: (e && e.message) || 'send failed' });
  }
}

/**
 * notifyChitStatus — the thing Athi asked for: "your order has been accepted", back on WhatsApp.
 *
 * ⚠️ IT ONLY SPEAKS WHEN THE CHIT CAME FROM A CHANNEL. A chit composed in the app has no customer waiting on
 * WhatsApp, and messaging a number that never wrote to us is unsolicited contact. The capture→chit link recorded
 * at send time (b104) is what makes this safe: no capture, no reply.
 */
async function notifyChitStatus(entity_id, chit_id, status, subject) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT c.id, c.sender_ref, c.to_ref, b.provider_ref
         FROM capture c
    LEFT JOIN channel_binding b
           ON b.entity_id = c.entity_id AND b.channel = 'whatsapp'
          AND lower(b.address) = lower(COALESCE(c.to_ref, ''))
        WHERE c.entity_id = $1 AND c.chit_id = $2 AND c.channel = 'whatsapp'
        LIMIT 1`, [entity_id, chit_id]));
    const cap = r.rows[0];
    if (!cap || !cap.sender_ref) return null;          // not from a channel — nothing to reply to, and that is fine
    const said = SAY[status];
    if (!said) return null;                             // a status with no customer-facing meaning stays internal
    return await notify(entity_id, { to_ref: cap.sender_ref, from_ref: cap.to_ref, provider_ref: cap.provider_ref,
      text: said(subject), chit_id, capture_id: cap.id });
  } catch (e) { return null; }
}

/**
 * ⚠️ WHAT WE SAY, AND WHAT WE DO NOT.
 * Only statuses that mean something to the person who sent the message get a reply. An internal reassignment or a
 * read receipt is not their business, and a channel that narrates every internal step trains people to ignore it.
 * The wording states what happened and never promises what has not been agreed.
 */
const SAY = {
  accepted:    (s) => `Your request${s ? ' "' + s + '"' : ''} has been accepted. We will confirm the details shortly.`,
  in_progress: (s) => `Your request${s ? ' "' + s + '"' : ''} is being worked on.`,
  completed:   (s) => `Your request${s ? ' "' + s + '"' : ''} is complete. Thank you.`,
  rejected:    (s) => `We are sorry — your request${s ? ' "' + s + '"' : ''} could not be accepted. Please reply here if you would like to discuss it.`,
  cancelled:   (s) => `Your request${s ? ' "' + s + '"' : ''} has been cancelled.`,
};

module.exports = { notify, notifyChitStatus, windowOpen, canSend, SAY, WINDOW_MS };
