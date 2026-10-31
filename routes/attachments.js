/**
 * routes/attachments.js — PUT A FILE ON A CHIT, AND GIVE EVERY PARTICIPANT THEIR OWN COPY OF IT.
 *
 * Two doors, and the second is the whole point:
 *   POST /api/attachments      { chit_id, message_id?, line_index?, name, mime, data_base64 }  ≤ 6 MB
 *   GET  /api/attachments/:id  the bytes, but only to an entity that holds a copy
 *
 * ⭐ PER-ENTITY COPIES (b66). The upload does not create A row, it creates ONE ROW PER PARTICIPANT, each owned
 * by that entity. That is the CB core principle applied to files: nothing OWNED is ever shared, it is
 * replicated, so a counterparty deleting or retaining their copy cannot touch yours.
 *
 * ⚠ THE ONE EXCEPTION IS AN INTERNAL MESSAGE, which stays single and belongs to the author entity alone — an
 * internal note is not addressed to the other party, so fanning its attachment out to them would leak it.
 *
 * ⚠ The bytes live in object storage (lib/storage.js), never in the row; this route carries no key and makes
 * no bucket decision of its own.
 *
 * OWNS       the two doors above. The copies themselves (one row per participant, the bytes in object storage or the row) are lib/storage.js; the words of a refusal and the limit are lib/attachments-contract.js.
 * CALLED BY  server.js (mounted at /api/attachments) · the app (public/app/attach-ui.js, app.html) and lib/autoraise.js (the original message of a capture).
 * FLOW       POST: sign-in → schema check (lib/attachments-contract.js) → audienceFor (my copy of the chit's header: the roster, or the message's audience) → bytes → storage.putForParticipants
 *            → ctpReturn.onAttachment (RAIL-106: by reference) → { id, name, mime, size, ctp? }.
 *            GET:  sign-in → storage.getBlob (my own copy only, by RLS) → the bytes with the S2 headers. A refusal → problem(req, res, ...), the old { error, message } kept beside the Problem fields
 *            (docs/contracts/api-legacy.json); a thrown error → faultOf: a 500 with the screen's label and the one generic sentence.
 * CARD       01-rail-core-the-chit/README
 *
 * @stage tested
 */
const express = require('express');
const router = express.Router();
const { query, withEntity } = require('../db');
const auth = require('../middleware/auth');
const storage = require('../lib/storage');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, words, faultOf, MAX_BYTES } = require('../lib/attachments-contract'); // the contract (each route's operation), the words of a refusal and the 6 MB limit (one source)
const ctpReturn = require('../lib/ctpreturn'); // RAIL-106: a file on a chit is told to the parties on other installations, who pull it

/**
 * Who gets a copy of a file put on a chit: every participant named on the caller's own copy (and the caller), except an INTERNAL note's file, which stays with its author entity.
 * → { participants, internalNote } or null when the caller holds no copy of the chit (not a participant).
 */
async function audienceFor(entity_id, chit_id, message_id) {
  const rosterRow = await withEntity(entity_id, (db) => db.query(`SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]));
  if (!rosterRow.rows.length) return null;
  const participants = [...new Set((rosterRow.rows[0].all_recipients || []).map((item) => item.entity_id).filter(Boolean))];
  if (!participants.includes(entity_id)) participants.push(entity_id);
  if (!message_id) return { participants, internalNote: false };
  // an INTERNAL-message attachment stays private to its entity (single copy)
  const message = await withEntity(entity_id, (db) => db.query(`SELECT visibility_entity_id FROM chit_messages WHERE message_id = $1 AND chit_id = $2 LIMIT 1`, [message_id, chit_id]));
  const owner = message.rows[0] && message.rows[0].visibility_entity_id;
  return owner ? { participants: [owner], internalNote: true } : { participants, internalNote: false };
}

/** the file as announced to a party on another installation: by REFERENCE (id, name, type, size, sha-256), never the bytes */
function announcement(file, id, buffer) {
  return {
    chit_id: file.chit_id,
    message_id: file.message_id || null,
    line_index: file.line_index,
    attachment_id: id,
    name: file.name,
    mime: file.mime,
    size: buffer.length,
    sha256: require('crypto').createHash('sha256').update(buffer).digest('hex')
  };
}

// POST /api/attachments — { chit_id, message_id?, line_index?, name, mime, data_base64 }
// PER-ENTITY copies (b66): replicate one row per participant so each owns its own. Audience = all chit participants
// (from the caller's all_recipients), EXCEPT an internal-message attachment which stays single (author entity only).
router.post('/', auth, ...contract.checked('POST /'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { chit_id, message_id, line_index, name, mime, data_base64 } = req.body || {};
    if (!chit_id || !data_base64 || !name) return problem(req, res, { status: 400, ...words.missingFields() });

    // caller must be a participant — and its own copy carries the full roster (all_recipients)
    const audience = await audienceFor(entity_id, chit_id, message_id);
    if (!audience) return problem(req, res, { status: 403, ...words.notParticipant() });

    const buffer = Buffer.from(String(data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length === 0) return problem(req, res, { status: 400, ...words.emptyFile() });
    if (buffer.length > MAX_BYTES) return problem(req, res, { status: 413, ...words.tooLarge() });

    const file = { chit_id, message_id: message_id || null, line_index: line_index == null ? null : parseInt(line_index), name: String(name).slice(0, 200), mime: String(mime || 'application/octet-stream').slice(0, 120) };
    const id = await storage.putForParticipants({
      ...file,
      size: buffer.length,
      buffer,
      uploaded_by: req.identity.identity_id,
      participants: audience.participants,
      forEntity: entity_id
    });
    /* ⭐ RAIL-106: the party elsewhere pulls the bytes over the CTP door, from the copy this entity holds. An internal note's file stays here. */
    const crossed = audience.internalNote ? { queued: 0 } : await ctpReturn.onAttachment(entity_id, announcement(file, id, buffer));
    res.json({ id, name, mime: mime || 'application/octet-stream', size: buffer.length, ...ctpReturn.answerOf(crossed) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Upload failed')); /* the cause is logged with the request id; the caller gets the one generic sentence */
  }
});

// GET /api/attachments/:id — stream the bytes (on demand). Participant-checked.
router.get('/:id', auth, ...contract.checked('GET /:id'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    // PER-ENTITY: getBlob is entity-scoped (RLS) — it returns ONLY the caller's own copy, else nothing. No shared read.
    const a = await storage.getBlob(req.params.id, entity_id);
    if (!a) return problem(req, res, { status: 404, ...words.notHeld() });
    // S2 (reviewer 2026-07-13) — stored-XSS defence. The MIME is uploader-supplied, so we do NOT let the browser render
    // arbitrary types on our origin. Only image/* and application/pdf may render INLINE; everything else is forced to
    // DOWNLOAD (attachment). nosniff stops the browser second-guessing the declared type. A text/html payload can no
    // longer execute a script on the API origin.
    const rawMime = String(a.mime || 'application/octet-stream').toLowerCase();
    // NOTE: SVG is deliberately EXCLUDED — image/svg+xml can carry inline <script>, so it is forced to download.
    const renderable = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(rawMime) || rawMime === 'application/pdf';
    const safeMime = renderable ? rawMime : 'application/octet-stream';
    const safeName = (a.name || 'file').replace(/[\r\n"\\]/g, '');
    res.setHeader('Content-Type', safeMime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${renderable ? 'inline' : 'attachment'}; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(a.data);
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Fetch failed')); /* the cause is logged with the request id; the caller gets the one generic sentence */
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
