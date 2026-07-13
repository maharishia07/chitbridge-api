// routes/capture.js — the intake inbox + channel adapters. Pipeline: channel → capture → AI structure → human confirm
// (send via /api/chits/send) → mark converted. See SPEC-capture-connector.md. Migration b104.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const capture = require('../lib/capture');

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
router.post('/webhook/whatsapp', async (req, res) => {
  // CONFIG-PENDING: needs WHATSAPP_VERIFY_TOKEN + a number→entity map (whatsapp_routes). Acknowledge so the provider
  // does not retry-storm; do nothing until configured. (Meta expects a fast 200.)
  try {
    if (!process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).json({ ok: true, note: 'whatsapp not configured' });
    // when configured: extract entry[].changes[].value.messages[], map the business number → entity, createCapture(...)
    return res.status(200).json({ ok: true, note: 'received; entity mapping not configured' });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

// Inbound email (SendGrid Inbound Parse / Mailgun route posts here). CONFIG-PENDING: needs an address→entity map.
router.post('/webhook/email', async (req, res) => {
  try {
    if (!process.env.EMAIL_INBOUND_SECRET) return res.status(200).json({ ok: true, note: 'email inbound not configured' });
    // when configured: verify the provider secret, map the To: address → entity, createCapture({channel:'email', ...})
    return res.status(200).json({ ok: true, note: 'received; entity mapping not configured' });
  } catch (_) { return res.status(200).json({ ok: true }); }
});

module.exports = router;
