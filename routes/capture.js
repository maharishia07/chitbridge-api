// routes/capture.js — the intake inbox + channel adapters. Pipeline: channel → capture → AI structure → human confirm
// (send via /api/chits/send) → mark converted. See SPEC-capture-connector.md. Migration b104.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const capture = require('../lib/capture');
const channels = require('../lib/channels');   // b123 — the number/address → entity map the webhooks resolve against

// HMAC verify over the RAW request body (constant-time). Providers sign every POST; a shared verify-token is NOT auth.
// header e.g. WhatsApp `X-Hub-Signature-256: sha256=<hex>`. Returns true only on a valid signature.
function hmacOk(rawBuf, secret, header, prefix) {
  if (!secret || !rawBuf || !header) return false;
  const sig = String(header).replace(prefix || '', '');
  const mine = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(mine, 'hex')); } catch (_) { return false; }
}

const entityId = (req) => auth.entityOf(req);

// ── authenticated intake (the entity's own inbox) ──────────────────────────────────────────────────────────────
// POST /simulate — record an inbound message as if it arrived on a channel (testable WITHOUT a BSP/inbound-parse).
router.post('/simulate', auth, async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await capture.createCapture(entityId(req), {
      channel: b.channel || 'web', sender_ref: b.sender_ref, sender_name: b.sender_name, subject: b.subject, raw_text: b.raw_text, media_refs: b.media_refs }));
  } catch (err) { res.status(err.status || 500).json({ error: 'Capture failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.get('/pending', auth, async (req, res) => {
  try { res.json(await capture.listPending(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'List failed', message: safeErr(err) }); }
});

// POST /:id/structure — invoke the AI co-assist to structure the message into a chit draft (proposes; human confirms).
router.post('/:id/structure', auth, async (req, res) => {
  try { res.json(await capture.structureCapture(entityId(req), req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Structure failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});

/**
 * POST /:id/raise — build the SEND PAYLOAD for turning this message into a REQUEST addressed to the entity.
 *
 * ⚠️ IT CREATES NOTHING. It returns what to send; the caller posts it to /api/chits/send (the one send path) and
 * then calls /convert. The human confirm gate is exactly where it was — a person still presses send. What this
 * removes is the typing, not the deciding.
 */
router.post('/:id/raise', auth, async (req, res) => {
  // use_catalogue defaults TRUE; false makes every line carry exactly what the message said (see raisePayload).
  try { res.json(await capture.raisePayload(entityId(req), req.params.id, { useCatalogue: (req.body || {}).use_catalogue !== false })); }
  catch (err) { res.status(err.status || 500).json({ error: 'Raise failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});

// POST /:id/convert — the human has SENT the chit (via /api/chits/send); record the linkage. { chit_id }
router.post('/:id/convert', auth, async (req, res) => {
  try { res.json(await capture.markConverted(entityId(req), req.params.id, (req.body || {}).chit_id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Convert failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.post('/:id/dismiss', auth, async (req, res) => {
  try { res.json(await capture.dismissCapture(entityId(req), req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Dismiss failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

// ── CHANNEL WEBHOOKS (adapters over the SAME pipeline) ─────────────────────────────────────────────────────────
// A real provider (Meta WhatsApp Cloud API / a BSP; SendGrid/Mailgun inbound-parse) POSTs here.
//
// ⚠️ THE ENTITY MAP NOW EXISTS (b123, Settings → Channels), so these adapters RESOLVE and CAPTURE rather than
// no-op. What still gates them is the provider SECRET: with no WHATSAPP_APP_SECRET / EMAIL_INBOUND_SECRET set
// they return 200 and do nothing, exactly as before. So this stays inert until Athi connects an account — a
// missing secret cannot become an open door.
//
// NOTE: no auth middleware (providers can't send a JWT). The gate is three things together: the HMAC signature,
// the provider secret, and the binding. None of them comes from the request body.
//
// ⚠️ NOT YET EXERCISED AGAINST A REAL PROVIDER. The payload shapes below are from Meta's and Mailgun's documented
// formats, not from a live delivery. First real message should be watched, not assumed.

// Meta WhatsApp webhook verification handshake (GET) — returns the challenge when the verify token matches.
router.get('/webhook/whatsapp', (req, res) => {
  const vt = process.env.WHATSAPP_VERIFY_TOKEN;
  if (vt && req.query['hub.verify_token'] === vt && req.query['hub.mode'] === 'subscribe') return res.status(200).send(req.query['hub.challenge']);
  return res.status(403).send('forbidden');
});
// RAW body on the webhook POSTs (needed for HMAC — the parsed JSON can't be re-signed byte-for-byte).
router.post('/webhook/whatsapp', express.raw({ type: () => true }), async (req, res) => {
  // Inert until BOTH an app secret AND a number→entity binding exist. Meta expects a fast 200 (no retry-storm).
  try {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return res.status(200).json({ ok: true, note: 'whatsapp not configured' });
    // reviewer capture #1 — verify the HMAC signature on EVERY POST (a verify-token guards only the GET handshake).
    if (!hmacOk(req.body, secret, req.headers['x-hub-signature-256'], 'sha256=')) return res.status(401).json({ error: 'bad signature' });
    /**
     * reviewer capture #2, now IMPLEMENTED (b123). The entity comes from the number→entity MAP and never from the
     * payload — anything in the body is a stranger's assertion, and trusting it on a public endpoint would let
     * anyone post an obligation into anyone's inbox.
     *
     * `metadata.display_phone_number` is OUR number (the business line the message was sent TO); `messages[].from`
     * is theirs. The binding is looked up on OURS. Getting those two the wrong way round is the whole bug this
     * comment exists to prevent.
     */
    const evt = JSON.parse(req.body.toString('utf8'));
    let placed = 0;
    for (const entry of (evt.entry || [])) {
      for (const ch of (entry.changes || [])) {
        const v = (ch && ch.value) || {};
        const to = (v.metadata && (v.metadata.display_phone_number || v.metadata.phone_number_id)) || '';
        /* b131 — resolve the OWNER and the line's settings in one SECURITY DEFINER call. Falls back to ownerOf on a
           pre-b131 database, where auto_raise simply does not exist and every line behaves as it does today. */
        const bind = await channels.bindingFor('whatsapp', to);
        const entity = bind ? bind.entity_id : await channels.ownerOf('whatsapp', to);
        if (!entity) continue;                                   // not bound to anyone here — not for us
        const names = {};
        for (const c of (v.contacts || [])) names[c.wa_id] = (c.profile && c.profile.name) || null;
        for (const m of (v.messages || [])) {
          const text = (m.text && m.text.body) || (m.caption) || '';
          const media = m.image || m.document || m.audio || m.video;
          if (!text && !media) continue;                          // a receipt/status, not a message
          const cap = await capture.createCapture(entity, {
            channel: 'whatsapp', sender_ref: m.from, sender_name: names[m.from] || null,
            raw_text: text || ('[' + (m.type || 'media') + ']'),
            media_refs: media && media.id ? [{ name: media.filename || m.type, id: media.id }] : [],
            to_ref: to,     // b126 — the line they wrote to, so a reply can come FROM it
            provider_msg_id: m.id,   // b129 — Meta retries; a redelivery must not become a second order
          });
          /**
           * ⚠️ AUTO-RAISE RUNS AFTER WE HAVE ANSWERED, NEVER BEFORE (b131). Reading a message with a co-assist takes
           * seconds; Meta wants a fast 200 and retries anything slow. Doing this inline would turn every message
           * into a redelivery storm — and b129's dedupe would then be load-bearing for a problem we created.
           *
           * ⚠️ AND A REDELIVERY MUST NOT RAISE TWICE. `cap.duplicate` means this exact provider message id is
           * already on the queue, so it is skipped: the first delivery owns it. Without this, Meta retrying a
           * message we already handled would mint a second chit for one request.
           */
          if (bind && bind.auto_raise && !cap.duplicate) {
            const _cid = cap.id, _ent = entity;
            setImmediate(() => { require('../lib/autoraise').run(_ent, _cid).catch(() => {}); });
          }
          placed++;
        }
      }
    }
    return res.status(200).json({ ok: true, captured: placed });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

// Inbound email (SendGrid Inbound Parse / Mailgun route). Inert until a signing secret AND an address→entity map exist.
router.post('/webhook/email', express.raw({ type: () => true }), async (req, res) => {
  try {
    const secret = process.env.EMAIL_INBOUND_SECRET;
    if (!secret) return res.status(200).json({ ok: true, note: 'email inbound not configured' });
    if (!hmacOk(req.body, secret, req.headers['x-mailgun-signature-256'] || req.headers['x-inbound-signature'], '')) return res.status(401).json({ error: 'bad signature' });
    /**
     * Entity from the To: address MAP, never the body (b123). Inbound-parse providers differ in casing and in
     * whether they send JSON or form fields, so read tolerantly — but only ever to find WHICH ADDRESS IT WAS SENT
     * TO. Who sent it is data on the capture; who receives it is a decision, and decisions come from the map.
     */
    let body = {};
    try { body = JSON.parse(req.body.toString('utf8')); }
    catch (_) { body = Object.fromEntries(new URLSearchParams(req.body.toString('utf8'))); }
    const to = String(body.to || body.To || body.recipient || '').replace(/.*</, '').replace(/>.*/, '').trim();
    const entity = await channels.ownerOf('email', to);
    if (!entity) return res.status(200).json({ ok: true, note: 'no binding for that address' });
    const text = String(body.text || body['body-plain'] || body.stripped_text || '').trim();
    if (!text) return res.status(200).json({ ok: true, note: 'nothing to capture' });
    await capture.createCapture(entity, {
      channel: 'email',
      sender_ref: String(body.from || body.From || body.sender || '').replace(/.*</, '').replace(/>.*/, '').trim() || null,
      subject: String(body.subject || body.Subject || '').slice(0, 200) || null,
      raw_text: text,
    });
    return res.status(200).json({ ok: true, captured: 1 });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  WHOLESALER CONSOLIDATION — the two outputs (directive 2026-08-10).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * A. the CONSOLIDATED REQUIREMENT for a fulfilment date — what he must source.
 * B. the ATTRIBUTION — who asked for how much, traceable to the chit and the original message.
 *
 * ⚠️ READ-ONLY. It reads chits that already exist and totals them; it mints nothing, sends nothing and prices
 * nothing. Every rule that could cost money lives in lib/consolidate.js and is proved arithmetically.
 */
const consolidate = require('../lib/consolidate');
const stores = require('../lib/stores');

// GET /api/capture/consolidate?date=YYYY-MM-DD — the requirement + the attribution, per fulfilment date.
router.get('/consolidate', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const cat = await consolidate.loadCatalogue(me);
    const cards = await capture.consolidationInput(me, { since: req.query.since });
    const out = consolidate.consolidate(cards, cat);
    const want = String(req.query.date || '').trim();
    const lines = want ? out.lines.filter((l) => l.date === want) : out.lines;
    /* ⚠️ THE FLAGS TRAVEL WITH THE TOTALS, never in a separate place nobody opens. A total with a gap beside it
       gets checked; a total that quietly excluded something does not. */
    res.json({
      date: want || null,
      dates: [...new Set(out.lines.map((l) => l.date))].sort(),
      requirement: lines,
      flags: out.flags,
      unmatched_phrase_count: out.flags.unmatched.length,
      note: 'Flagged lines are EXCLUDED from every total — unmatched, variant-unspecified, date-unspecified. Unit-split lines are shown split, never converted without a declared factor.',
    });
  } catch (err) { res.status(500).json({ error: 'Consolidate failed', message: safeErr(err) }); }
});

// ── the shop list (W-1) ──────────────────────────────────────────────────────────────────────────────────────
router.get('/stores', auth, async (req, res) => {
  try { res.json(await stores.list(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'Stores list failed', message: safeErr(err) }); }
});
router.post('/stores', auth, async (req, res) => {
  try { res.json(await stores.upsert(entityId(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: 'Store save failed', message: err.status ? err.message : safeErr(err) }); }
});

module.exports = router;
