// routes/capture.js — the intake inbox + channel adapters. Pipeline: channel → capture → AI structure → human confirm
// (send via /api/chits/send) → mark converted. See SPEC-capture-connector.md. Migration b104.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const capture = require('../lib/capture');

// HMAC verify over the RAW request body (constant-time). Providers sign every POST; a shared verify-token is NOT auth.
// header e.g. WhatsApp `X-Hub-Signature-256: sha256=<hex>`. Returns true only on a valid signature.
function hmacOk(rawBuf, secret, header, prefix) {
  if (!secret || !rawBuf || !header) return false;
  const sig = String(header).replace(prefix || '', '');
  const mine = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(mine, 'hex')); } catch (_) { return false; }
}

const entityId = (req) => req.identity.parent_entity_id || req.identity.identity_id;

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

// POST /:id/convert — the human has SENT the chit (via /api/chits/send); record the linkage. { chit_id }
router.post('/:id/convert', auth, async (req, res) => {
  try { res.json(await capture.markConverted(entityId(req), req.params.id, (req.body || {}).chit_id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Convert failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.post('/:id/dismiss', auth, async (req, res) => {
  try { res.json(await capture.dismissCapture(entityId(req), req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Dismiss failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

// ── CHANNEL WEBHOOKS (adapters over the SAME pipeline) — wired, but CONFIG-PENDING ─────────────────────────────
// A real provider (Meta WhatsApp Cloud API / a BSP; SendGrid/Mailgun inbound-parse) POSTs here. Each adapter must map
// the inbound to a CB entity (which entity owns this number/address) — that mapping does not exist yet, so these are
// inert until configured. They validate a shared verify token and, when a mapping is present, create a capture.
// NOTE: no auth middleware (providers can't send a JWT) — the verify token + the entity mapping are the gate.

// Meta WhatsApp webhook verification handshake (GET) — returns the challenge when the verify token matches.
router.get('/webhook/whatsapp', (req, res) => {
  const vt = process.env.WHATSAPP_VERIFY_TOKEN;
  if (vt && req.query['hub.verify_token'] === vt && req.query['hub.mode'] === 'subscribe') return res.status(200).send(req.query['hub.challenge']);
  return res.status(403).send('forbidden');
});
// RAW body on the webhook POSTs (needed for HMAC — the parsed JSON can't be re-signed byte-for-byte).
router.post('/webhook/whatsapp', express.raw({ type: () => true }), async (req, res) => {
  // Inert until BOTH an app secret AND a number→entity map exist. Meta expects a fast 200 (no retry-storm).
  try {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return res.status(200).json({ ok: true, note: 'whatsapp not configured' });
    // reviewer capture #1 — verify the HMAC signature on EVERY POST (a verify-token guards only the GET handshake).
    if (!hmacOk(req.body, secret, req.headers['x-hub-signature-256'], 'sha256=')) return res.status(401).json({ error: 'bad signature' });
    // reviewer capture #2 — the entity comes from the number→entity MAP, NEVER the payload (else it is S1 on a public endpoint).
    //   const evt = JSON.parse(req.body.toString('utf8')); const entity = lookupEntityByWhatsAppNumber(evt…);
    //   for each message: await capture.createCapture(entity, { channel:'whatsapp', sender_ref, raw_text, media_refs });
    return res.status(200).json({ ok: true, note: 'signature ok; entity mapping not configured' });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

// Inbound email (SendGrid Inbound Parse / Mailgun route). Inert until a signing secret AND an address→entity map exist.
router.post('/webhook/email', express.raw({ type: () => true }), async (req, res) => {
  try {
    const secret = process.env.EMAIL_INBOUND_SECRET;
    if (!secret) return res.status(200).json({ ok: true, note: 'email inbound not configured' });
    if (!hmacOk(req.body, secret, req.headers['x-mailgun-signature-256'] || req.headers['x-inbound-signature'], '')) return res.status(401).json({ error: 'bad signature' });
    // entity from the To: address MAP, never the body. createCapture({channel:'email', ...}).
    return res.status(200).json({ ok: true, note: 'signature ok; entity mapping not configured' });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

module.exports = router;
