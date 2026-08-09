// lib/capture.js — the CAPTURE pipeline. An inbound message (WhatsApp/email/web/…) becomes a PENDING capture; the AI
// structures it into a draft; a human confirms; the confirmed draft is sent as a chit via the PROVEN /api/chits/send
// path (the human-confirm gate stays exactly there). This module owns the capture queue only — it never creates a chit
// directly (that would replicate the chit_deliver machinery). Per-entity, WITH RLS. See SPEC-capture-connector.md.
const { withEntity } = require('../db');

function _missing(e) { const err = new Error('Capture not migrated yet (b104).'); err.status = 503; err.code = 'CAPTURE_STORE_MISSING'; return (e && (e.code === '42P01' || e.code === '42703')) ? err : e; }
const CHANNELS = ['whatsapp', 'email', 'web', 'sms', 'other'];

// record an inbound message as a pending capture (the untrusted raw text is stored, not yet a chit).
async function createCapture(entity_id, { channel, sender_ref, sender_name, subject, raw_text, media_refs, to_ref, provider_msg_id }) {
  const ch = CHANNELS.includes(String(channel)) ? channel : 'other';
  const text = String(raw_text || '').trim();
  if (!text) { const e = new Error('raw_text required'); e.status = 400; throw e; }
  /**
   * ⚠️ A REDELIVERY IS NOT A NEW ORDER (b129). Providers retry: Meta re-sends a webhook it believes failed, and
   * that retry is indistinguishable from the customer sending the same words again — except by the provider's own
   * message id, which is stable across retries and different for a genuinely repeated message.
   *
   * Without this a human working the intake inbox sees two identical requests, converts both in good faith, and
   * the shop ships twice. So a duplicate returns the EXISTING capture rather than erroring: from the provider's
   * point of view the delivery succeeded, which is what stops it retrying again.
   */
  if (provider_msg_id) {
    try {
      const dup = await withEntity(entity_id, (c) => c.query(
        `SELECT id, channel, sender_ref, sender_name, subject, raw_text, status, created_at
           FROM capture WHERE entity_id = $1 AND channel = $2 AND provider_msg_id = $3 LIMIT 1`,
        [entity_id, ch, String(provider_msg_id)]));
      if (dup.rows[0]) return Object.assign(dup.rows[0], { duplicate: true });
    } catch (_) { /* pre-b129 → fall through and insert as before */ }
  }
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      /* ⚠️ to_ref = WHICH OF OUR LINES they wrote to. The webhook has always known it (metadata.display_phone_number)
         and threw it away. Without it a reply cannot be sent FROM the number the customer messaged — and with two
         bound numbers, guessing which of your businesses is talking to a customer is not acceptable. (b126) */
      `INSERT INTO capture (entity_id, channel, sender_ref, sender_name, subject, raw_text, media_refs, to_ref, provider_msg_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id, channel, sender_ref, sender_name, subject, raw_text, status, created_at`,
      [entity_id, ch, sender_ref || null, sender_name || null, subject || null, text.slice(0, 8000),
       JSON.stringify(Array.isArray(media_refs) ? media_refs.slice(0, 20) : []), to_ref || null,
       provider_msg_id ? String(provider_msg_id) : null]));
    return r.rows[0];
  } catch (e) {
    /* ⚠️ The unique index is the real guard — the SELECT above races against a simultaneous redelivery, and two
       retries arriving together would both find nothing and both insert. On a collision, return what won. */
    if (e && e.code === '23505' && provider_msg_id) {
      try {
        const dup = await withEntity(entity_id, (c) => c.query(
          `SELECT id, channel, sender_ref, sender_name, subject, raw_text, status, created_at
             FROM capture WHERE entity_id = $1 AND channel = $2 AND provider_msg_id = $3 LIMIT 1`,
          [entity_id, ch, String(provider_msg_id)]));
        if (dup.rows[0]) return Object.assign(dup.rows[0], { duplicate: true });
      } catch (_) {}
    }
    throw _missing(e);
  }
}

async function listPending(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT id, channel, sender_ref, sender_name, subject, raw_text, media_refs, status, structured, chit_id, to_ref, created_at
       FROM capture WHERE entity_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 200`, [entity_id]));
    return { captures: r.rows };
  } catch (e) { if (_missing(e).status === 503) return { captures: [], note: 'capture not migrated (b104)' }; throw e; }
}

async function getCapture(entity_id, id) {
  const r = await withEntity(entity_id, (c) => c.query('SELECT * FROM capture WHERE id = $1 AND entity_id = $2', [id, entity_id]));
  return r.rows[0] || null;
}

// AI-structure a capture (invoked → proposes). Saves + returns the structured draft; the human still confirms at send.
async function structureCapture(entity_id, id) {
  const cap = await getCapture(entity_id, id);
  if (!cap) { const e = new Error('Capture not found'); e.status = 404; throw e; }
  const ai = require('./ai');
  /**
   * ⚠️ A PHOTOGRAPHED ORDER IS STILL AN ORDER (b126/b127). A customer who sends a picture of a handwritten list
   * has told us exactly as much as one who typed it — the difference is ours to bridge, not theirs.
   *
   * So: if the capture carries images and we can actually fetch them, read them with the vision skill. If we
   * cannot — no WHATSAPP_TOKEN, media expired, not an image — fall back to the text skill unchanged. The photo
   * still sits on the capture for a human to open, which is the honest degrade: a picture we could not read is
   * not a message we lost.
   */
  let images = [];
  try { images = await require('./whatsapp-media').imagesFor(cap, 4); } catch (_) { images = []; }
  const skill = images.length ? 'photo-to-chit' : 'message-to-chit';
  const out = await ai.invokeSkill(entity_id, skill, {
    channel: cap.channel, from: cap.sender_ref || cap.sender_name || '', message: cap.raw_text,
    ...(images.length ? { images } : {}) });
  const structured = (out && out.data) || null;
  if (structured) {
    await withEntity(entity_id, (c) => c.query('UPDATE capture SET structured = $1::jsonb, updated_at = now() WHERE id = $2 AND entity_id = $3',
      [JSON.stringify(structured), id, entity_id]));
  }
  return { capture_id: id, structured, note: out && out.note, usage: out && out.usage };
}

// mark a capture converted once the human has sent the chit via /api/chits/send (chit_id passed back).
async function markConverted(entity_id, id, chit_id) {
  const r = await withEntity(entity_id, (c) => c.query(
    `UPDATE capture SET status = 'converted', chit_id = $1, updated_at = now()
     WHERE id = $2 AND entity_id = $3 AND status = 'pending' RETURNING id, status, chit_id`, [chit_id || null, id, entity_id]));
  if (!r.rows[0]) { const e = new Error('Capture not found or already handled'); e.status = 404; throw e; }
  return r.rows[0];
}

async function dismissCapture(entity_id, id) {
  const r = await withEntity(entity_id, (c) => c.query(
    `UPDATE capture SET status = 'dismissed', updated_at = now() WHERE id = $1 AND entity_id = $2 AND status = 'pending' RETURNING id, status`, [id, entity_id]));
  if (!r.rows[0]) { const e = new Error('Capture not found or already handled'); e.status = 404; throw e; }
  return r.rows[0];
}

module.exports = { createCapture, listPending, getCapture, structureCapture, markConverted, dismissCapture, CHANNELS };
