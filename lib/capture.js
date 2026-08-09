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

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  raisePayload — a message becomes a REQUEST addressed to the entity, carrying where it came from.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-09: *"what we need is creating a chit and send it to the entity as a request."*
 *
 * This is a better shape than walking Compose, and the reason is worth writing down: walking Compose has the
 * BUSINESS authoring the customer's request, in the customer's voice, and the customer never sees it. What actually
 * happened is that someone outside asked for something. A request that says so — and says who asked, on which line,
 * in which message — is the honest record.
 *
 * ── ⚠️ THE CUSTOMER IS NOT A RECIPIENT, AND MUST NOT BE ────────────────────────────────────────────────────────
 * /api/chits/send resolves every recipient to a live platform entity and 404s a name that does not resolve. A
 * WhatsApp number is not an entity. That gate is right and is not worked around here: the sender is the ORIGIN of
 * the request, not a party to it, and origins belong in provenance. Inventing a shadow entity for every stranger
 * who messages a business would put unverified identities on the rail, which is the one thing the rail is for.
 *
 * So the chit is authored by the ENTITY (whose channel it is, whose credentials it is), addressed to ITSELF, and
 * the stranger is recorded in `business_json.via`.
 *
 * ── ⚠️ IT RETURNS A PAYLOAD. IT DOES NOT CREATE A CHIT. ────────────────────────────────────────────────────────
 * There is exactly one send path and it is /api/chits/send. Minting here would fork chit_deliver — the divergence
 * this module's header already refuses. The caller posts this payload to the one send, then calls /convert. So the
 * human confirm gate is untouched: a person still presses the button that sends.
 *
 * ── ⚠️ PROVENANCE IS STAMPED FROM THE CAPTURE ROW, NEVER FROM THE CALLER ───────────────────────────────────────
 * `via` is built here, from what the webhook actually recorded. A provenance block the client composes is a claim
 * about itself; one read off the stored row is a record. They are not the same evidence and only one is worth
 * putting on a chit.
 */
async function raisePayload(entity_id, id) {
  const cap = await getCapture(entity_id, id);
  if (!cap) { const e = new Error('Capture not found'); e.status = 404; throw e; }
  if (cap.status !== 'pending') { const e = new Error('That message has already been handled'); e.status = 409; throw e; }
  const s = cap.structured || null;
  if (!s) { const e = new Error('Read the message first — a request needs lines, and nothing has read them yet'); e.status = 409; throw e; }
  const line_items = (s.line_items || []).map((l) => {
    const qty = l.qty == null ? 1 : Number(l.qty) || 0;
    const price = Number(l.rate != null ? l.rate : l.price) || 0;
    return { particulars: String(l.particulars || l.description || 'item').slice(0, 200), quantity: qty, price, total: qty * price };
  }).slice(0, 50);
  if (!line_items.length) { const e = new Error('Nothing was read out of that message that could be requested'); e.status = 409; throw e; }
  const who = cap.sender_name || cap.sender_ref || 'an unknown sender';
  return {
    // ⚠️ `inquiry`, NOT `order`. Nobody has agreed to anything. An inbound request that entered the ledger as an
    //    order would be an obligation minted by a stranger's message, which is the whole thing being avoided.
    purpose: 'inquiry',
    subject: String(s.subject || ('Request from ' + who)).slice(0, 500),
    line_items,
    // Addressed to the entity itself: their received copy IS the request in their inbox. There is no other party.
    recipients: [{ self: true, role: 'to' }],
    /* ⚠️ TASK ONLY — NO ORDER COPY. Athi: *"make the order copy none, it will create a task."* The entity did not
       send this; someone outside asked. An Order copy would put it in their Sent list and claim they raised it
       themselves, which is the one thing the record must not say. The suppression is declared on the chit
       (summary_json.copy_policy, source:'request'), so the missing copy is governed and not a hole. */
    self_copy: 'received',
    business_json: {
      via: {
        channel: cap.channel,
        from: cap.sender_ref || null,
        from_name: cap.sender_name || null,
        to: cap.to_ref || null,                       // WHICH of their lines was written to (b126)
        provider_msg_id: cap.provider_msg_id || null, // the provider's own id — stable across retries (b129)
        capture_id: cap.id,
        received_at: cap.created_at,
        read_by: 'co-assist',                         // the lines are an AI's reading of someone else's words
        /* ⚠️ SAID OUT LOUD, ON THE CHIT. A phone number that messaged a business is not a verified counterparty,
           and six weeks later nothing else on the record would distinguish it from one. */
        sender_verified: false,
        /* ⚠️ WHAT THEY ACTUALLY WROTE, ON THE CHIT ITSELF. Athi, 2026-08-09: *"the copy is attached along with the
           message so it can be verified against."* Exactly right, and it is the difference between a reading you
           can check and a reading you must trust: the lines below are a co-assist's interpretation, and an
           interpretation with the original beside it can be disputed on the evidence.
           CAPPED, because summary_json is copied onto every party's copy — the FULL text goes on as an attachment
           (see `original` below), which is where a long message belongs. */
        raw_excerpt: String(cap.raw_text || '').slice(0, 400),
        media_count: Array.isArray(cap.media_refs) ? cap.media_refs.length : 0,
      },
    },
    /**
     * ⚠️ THE ORIGINAL MESSAGE, TO BE ATTACHED AS EVIDENCE — the caller uploads this to the chit after sending.
     *
     * It is not decoration. A structured line is an AI's claim about what someone meant; the message is what they
     * said. Attachments already replicate per-entity-per-copy, so each party ends up HOLDING the original rather
     * than holding a pointer to ours — which is the whole difference when the two readings disagree later.
     *
     * ⚠️ MEDIA IS NOT INCLUDED YET. A photographed order's image lives at the provider and is fetched on demand;
     * carrying it onto the chit needs the media fetch at send time. `media_count` above says how many are missing
     * rather than letting a chit imply the photo came with it.
     */
    original: {
      filename: 'original-message-' + String(cap.channel || 'chit') + '.txt',
      text: [
        'ORIGINAL MESSAGE — as received, not interpreted',
        '',
        'Channel        : ' + (cap.channel || ''),
        'From           : ' + (cap.sender_name ? cap.sender_name + ' <' + (cap.sender_ref || '') + '>' : (cap.sender_ref || 'unknown')),
        'To (our line)  : ' + (cap.to_ref || '(not recorded)'),
        'Received       : ' + (cap.created_at || ''),
        'Provider msg id: ' + (cap.provider_msg_id || '(none)'),
        'Attachments    : ' + (Array.isArray(cap.media_refs) && cap.media_refs.length
          ? cap.media_refs.length + ' held at the provider, not copied onto this chit' : 'none'),
        'Sender verified: NO — this is a phone number that wrote in, not a checked party',
        '',
        '--- what they wrote ---',
        String(cap.raw_text || ''),
      ].join('\n'),
    },
  };
}

module.exports = { createCapture, listPending, getCapture, structureCapture, markConverted, dismissCapture, raisePayload, CHANNELS };
