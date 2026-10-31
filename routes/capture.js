/*
 * OWNS      the intake inbox and channel adapters (web simulate, webhooks).
 * CALLED BY web Inbox · WhatsApp / email webhooks.
 * FLOW      channel → capture → AI structure → human confirm → chit   (a WhatsApp STOP reply: capture → lib/optout withdraws consent, never a chit)
 *           the nine signed-in routes: auth → checked(route) → handler → res.json | problem(req, res, faultOf(...) | storesFault(...) | failed(...)); the words and the contract are lib/capture-contract.js.
 *           the three webhooks (an outside contract: Meta, the e-mail provider) are NOT in that contract and answer exactly as they always did.
 * CARD      11-crm-and-marketing/capture
 */
// routes/capture.js — the intake inbox + channel adapters. Pipeline: channel → capture → AI structure → human confirm
// (send via /api/chits/send) → mark converted. See SPEC-capture-connector.md. Migration b104.
const express = require('express');
const log = require('../lib/logger');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { faultOf, storesFault, failed, checked } = require('../lib/capture-contract'); // API-4: the contract (each signed-in route's operation) and the words of a refusal
const { UUID_RE } = require('../lib/trace');
const { queryDay } = require('../middleware/validate'); // API-17: a ?since= that is not a day answers 400 VALIDATION_FAILED before any read
const capture = require('../lib/capture');
const channels = require('../lib/channels'); // b123 — the number/address → entity map the webhooks resolve against
const optout = require('../lib/optout'); // CON-2 — a STOP reply withdraws marketing consent (new messages only, before auto-raise)

// HMAC verify over the RAW request body (constant-time). Providers sign every POST; a shared verify-token is NOT auth.
// header e.g. WhatsApp `X-Hub-Signature-256: sha256=<hex>`. Returns true only on a valid signature.
function hmacOk(rawBuf, secret, header, prefix) {
  if (!secret || !rawBuf || !header) return false;
  const sig = String(header).replace(prefix || '', '');
  const mine = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(mine, 'hex'));
  } catch (e) {
    log.fellBack('capture hmacOk: did not parse — answered no', e, 'debug');
    return false;
  }
}

const entityId = (req) => auth.entityOf(req);

/** the label each /:id route has always answered a missing message under (frozen in docs/contracts/api-legacy.json) */
const FAILED_LABEL = { structure: 'Structure failed', raise: 'Raise failed', convert: 'Convert failed', dismiss: 'Dismiss failed' };
/* CON-100 — an id in the address that is not a uuid names no message of this shop: answered 404 before the database puts its own words into a 500. One guard for every /:id route. */
router.param('id', (req, res, next, id) =>
  UUID_RE.test(String(id)) ? next() : problem(req, res, { status: 404, code: 'NOT_FOUND', detail: 'We could not find that message.', legacy: { error: FAILED_LABEL[req.path.split('/')[2]] || 'Not found', message: req.path.endsWith('/raise') || req.path.endsWith('/structure') ? 'Capture not found' : 'Capture not found or already handled' } })
);
/** a 400 for one field of the body that is not what the route takes; the database is never asked (CON-100/101) */
const badField = (req, res, field, detail) => problem(req, res, { status: 400, code: 'VALIDATION_FAILED', detail, field, legacy: { error: 'Validation failed', message: detail } });
/** a field that is given (not absent) and fails the test */
const given = (value) => value !== undefined && value !== null && value !== '';

// ── authenticated intake (the entity's own inbox) ──────────────────────────────────────────────────────────────
// POST /simulate — record an inbound message as if it arrived on the web (testable WITHOUT a BSP/inbound-parse).
// ⚠️ SEC-FIX3 S7: ALWAYS channel 'web' — a simulated 'whatsapp' message opened the 24-hour window for any number.
router.post('/simulate', auth, ...checked('POST /simulate'), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(
      await capture.createCapture(entityId(req), {
        channel: 'web',
        sender_ref: b.sender_ref,
        sender_name: b.sender_name,
        subject: b.subject,
        raw_text: b.raw_text,
        media_refs: b.media_refs
      })
    );
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Capture failed', 'any'));
  }
});

router.get('/pending', auth, async (req, res) => {
  try {
    res.json(await capture.listPending(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'List failed', 'none'));
  }
});

// POST /:id/structure — invoke the AI co-assist to structure the message into a chit draft (proposes; human confirms).
router.post('/:id/structure', auth, ...checked('POST /:id/structure'), async (req, res) => {
  try {
    res.json(await capture.structureCapture(entityId(req), req.params.id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Structure failed', 'below500'));
  }
});

/**
 * POST /:id/raise — build the SEND PAYLOAD for turning this message into a REQUEST addressed to the entity.
 *
 * ⚠️ IT CREATES NOTHING. It returns what to send; the caller posts it to /api/chits/send (the one send path) and
 * then calls /convert. The human confirm gate is exactly where it was — a person still presses send. What this
 * removes is the typing, not the deciding.
 */
router.post('/:id/raise', auth, ...checked('POST /:id/raise'), async (req, res) => {
  // use_catalogue defaults TRUE; false makes every line carry exactly what the message said (see raisePayload).
  try {
    res.json(await capture.raisePayload(entityId(req), req.params.id, { useCatalogue: (req.body || {}).use_catalogue !== false }));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Raise failed', 'below500'));
  }
});

// POST /:id/convert — the human has SENT the chit (via /api/chits/send); record the linkage. { chit_id }
router.post('/:id/convert', auth, ...checked('POST /:id/convert'), async (req, res) => {
  const chitId = (req.body || {}).chit_id;
  if (given(chitId) && !(typeof chitId === 'string' && UUID_RE.test(chitId))) return badField(req, res, 'chit_id', 'The chit that was sent is not a valid id.');
  try {
    res.json(await capture.markConverted(entityId(req), req.params.id, chitId));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Convert failed', 'any'));
  }
});

router.post('/:id/dismiss', auth, ...checked('POST /:id/dismiss'), async (req, res) => {
  try {
    res.json(await capture.dismissCapture(entityId(req), req.params.id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Dismiss failed', 'any'));
  }
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
/** the capture row for one inbound message, or null for a delivery receipt / status (no text, no media) */
async function captureOf(entity, to, names, message) {
  const text = (message.text && message.text.body) || message.caption || '';
  const media = message.image || message.document || message.audio || message.video;
  if (!text && !media) return null; // a receipt/status, not a message
  return capture.createCapture(entity, {
    channel: 'whatsapp',
    sender_ref: message.from,
    sender_name: names[message.from] || null,
    raw_text: text || '[' + (message.type || 'media') + ']',
    media_refs: media && media.id ? [{ name: media.filename || message.type, id: media.id }] : [],
    to_ref: to, // b126 — the line they wrote to, so a reply can come FROM it
    provider_msg_id: message.id // b129 — Meta retries; a redelivery must not become a second order
  });
}
/**
 * takeMessage — ONE inbound WhatsApp message of a signed delivery: capture it, let a STOP reply withdraw consent (CON-2), else schedule the auto-raise.
 * Returns how many captures it placed (0 for a delivery receipt or a status, 1 otherwise). `afterAnswer` collects work that must wait for Meta's 200.
 */
async function takeMessage(entity, bind, to, names, message, afterAnswer) {
  const cap = await captureOf(entity, to, names, message);
  if (!cap) return 0;
  /**
   * CON-2 · A STOP IS NOT AN ORDER. Whole-message match only (lib/optout), new messages only, and BEFORE auto-raise: the withdrawal is written now
   * (a lost confirmation is a courtesy missed, a lost withdrawal is a person who still gets offers), the STOP capture is dismissed, and the
   * confirmation goes out after the 200. A redelivery (cap.duplicate) never reaches this.
   */
  const stopped = cap.duplicate ? { stop: false } : await optout.fromReply(entity, { sender_ref: message.from, text: (message.text && message.text.body) || '', capture_id: cap.id });
  if (stopped.stop) {
    if (!stopped.failed) afterAnswer.push(() => optout.confirmReply(entity, Object.assign({ sender_ref: message.from, to_ref: to, capture_id: cap.id }, stopped)));
    return 1;
  }
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
    setImmediate(() => {
      require('../lib/autoraise').run(entity, cap.id).catch(log.orElse('capture: auto-raise failed — the message waits in Intake to be raised by hand'));
    });
  }
  return 1;
}
/** one `changes` entry of a signed delivery: resolve the shop from OUR number (b123 · b131), then take each message; returns how many were placed */
async function takeChange(change, afterAnswer) {
  const value = (change && change.value) || {};
  const to = (value.metadata && (value.metadata.display_phone_number || value.metadata.phone_number_id)) || '';
  /* b131 — resolve the OWNER and the line's settings in one SECURITY DEFINER call. Falls back to ownerOf on a
     pre-b131 database, where auto_raise simply does not exist and every line behaves as it does today. */
  const bind = await channels.bindingFor('whatsapp', to);
  const entity = bind ? bind.entity_id : await channels.ownerOf('whatsapp', to);
  if (!entity) return 0; // not bound to anyone here — not for us
  const names = {};
  for (const contact of value.contacts || []) names[contact.wa_id] = (contact.profile && contact.profile.name) || null;
  let placed = 0;
  for (const message of value.messages || []) placed += await takeMessage(entity, bind, to, names, message, afterAnswer);
  return placed;
}
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
    const parsed = JSON.parse(req.body.toString('utf8'));
    let placed = 0;
    const afterAnswer = []; /* CON-2: the STOP confirmations, sent once Meta has its 200 */
    for (const entry of parsed.entry || []) for (const change of entry.changes || []) placed += await takeChange(change, afterAnswer);
    res.status(200).json({ ok: true, captured: placed });
    setImmediate(() => afterAnswer.forEach((send) => send()));
    return;
  } catch (e) {
    log.error('capture: a signed WhatsApp delivery could not be handled - Meta still gets its 200', { why: String(e && e.message) });
    return res.status(200).json({ ok: true });
  }
});

// Inbound email (SendGrid Inbound Parse / Mailgun route). Inert until a signing secret AND an address→entity map exist.
router.post('/webhook/email', express.raw({ type: () => true }), async (req, res) => {
  try {
    const secret = process.env.EMAIL_INBOUND_SECRET;
    if (!secret) return res.status(200).json({ ok: true, note: 'email inbound not configured' });
    if (!hmacOk(req.body, secret, req.headers['x-mailgun-signature-256'] || req.headers['x-inbound-signature'], ''))
      return res.status(401).json({ error: 'bad signature' });
    /**
     * Entity from the To: address MAP, never the body (b123). Inbound-parse providers differ in casing and in
     * whether they send JSON or form fields, so read tolerantly — but only ever to find WHICH ADDRESS IT WAS SENT
     * TO. Who sent it is data on the capture; who receives it is a decision, and decisions come from the map.
     */
    let body = {};
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch (_) {
      body = Object.fromEntries(new URLSearchParams(req.body.toString('utf8')));
    }
    const to = String(body.to || body.To || body.recipient || '')
      .replace(/.*</, '')
      .replace(/>.*/, '')
      .trim();
    const entity = await channels.ownerOf('email', to);
    if (!entity) return res.status(200).json({ ok: true, note: 'no binding for that address' });
    const text = String(body.text || body['body-plain'] || body.stripped_text || '').trim();
    if (!text) return res.status(200).json({ ok: true, note: 'nothing to capture' });
    await capture.createCapture(entity, {
      channel: 'email',
      sender_ref:
        String(body.from || body.From || body.sender || '')
          .replace(/.*</, '')
          .replace(/>.*/, '')
          .trim() || null,
      subject: String(body.subject || body.Subject || '').slice(0, 200) || null,
      raw_text: text
    });
    return res.status(200).json({ ok: true, captured: 1 });
  } catch (_) {
    return res.status(200).json({ ok: true });
  }
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
router.get('/consolidate', auth, queryDay('since'), ...checked('GET /consolidate'), async (req, res) => {
  try {
    const me = entityId(req);
    const cat = await consolidate.loadCatalogue(me);
    const cards = await capture.consolidationInput(me, { since: req.query.since });
    const out = consolidate.consolidate(cards, cat);
    const want = String(req.query.date || '').trim();
    const lines = want ? out.lines.filter((item) => item.date === want) : out.lines;
    /* ⚠️ THE FLAGS TRAVEL WITH THE TOTALS, never in a separate place nobody opens. A total with a gap beside it
       gets checked; a total that quietly excluded something does not. */
    res.json({
      date: want || null,
      dates: [...new Set(out.lines.map((item) => item.date))].sort(),
      requirement: lines,
      flags: out.flags,
      unmatched_phrase_count: out.flags.unmatched.length,
      note: 'Flagged lines are EXCLUDED from every total — unmatched, variant-unspecified, date-unspecified. Unit-split lines are shown split, never converted without a declared factor.'
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Consolidate failed'));
  }
});

// ── the shop list (W-1) ──────────────────────────────────────────────────────────────────────────────────────
router.get('/stores', auth, async (req, res) => {
  try {
    res.json(await stores.list(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Stores list failed', 'none'));
  }
});
/** a phone is text of 7 to 15 digits (the E.164 ceiling) with only the marks a person types; stores.phoneMatchKey is the one reader of "enough digits" */
const isPhoneText = (value) => typeof value === 'string' && /^[\d\s()+.-]+$/.test(value) && stores.phoneMatchKey(value) !== '' && value.replace(/\D/g, '').length <= 15;
router.post('/stores', auth, ...checked('POST /stores'), async (req, res) => {
  const phone = (req.body || {}).phone;
  if (given(phone) && !isPhoneText(phone)) return badField(req, res, 'phone', 'Give the phone number as 7 to 15 digits.');
  try {
    res.json(await stores.upsert(entityId(req), req.body || {}));
  } catch (err) {
    problem(req, res, storesFault(err, req));
  }
});

router.openapi = { paths: require('../lib/capture-contract').contract.pathsOf(), schemas: {} };
module.exports = router;
