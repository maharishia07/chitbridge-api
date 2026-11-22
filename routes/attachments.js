/**
 * routes/attachments.js — PUT A FILE ON A CHIT, AND GIVE EVERY PARTICIPANT THEIR OWN COPY OF IT.
 *
 * Two doors, and the second is the whole point:
 *   POST /api/attachments      { chit_id, message_id?, line_index?, name, mime, data_base64 }  ≤ 6 MB
 *   GET  /api/attachments/:id  the bytes, but only to an entity that holds a copy
 *   POST with entry_id (S1, b887): a receipt on a POSTED ENTRY of the shop's own books: JPEG, PNG or PDF by its bytes, ≤ 6 MB, add-only (DELETE · PUT · PATCH of such a file answer 409): lib/books-evidence-attach
 *
 * ⭐ PER-ENTITY COPIES (b66). The upload does not create A row, it creates ONE ROW PER PARTICIPANT, each owned
 * by that entity. That is the CB core principle applied to files: nothing OWNED is ever shared, it is
 * replicated, so a counterparty deleting or retaining their copy cannot touch yours.
 *
 * ⚠ THE EXCEPTIONS ARE NARROWER AUDIENCES. An INTERNAL message's file stays single and belongs to the author entity alone — an
 * internal note is not addressed to the other party. A DISPUTE message's file goes to exactly the parties that message goes to
 * (the dispute's roster, or the chit when it is chit-wide: lib/dispute-audience), here and on other installations (RAIL-187).
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
const { withEntity } = require('../db');
const auth = require('../middleware/auth');
const storage = require('../lib/storage');
const { sendBlob } = require('../lib/attachment-send'); // the one writer of a stored file's headers (images and PDFs inline, the rest a download)
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, words, faultOf, MAX_BYTES } = require('../lib/attachments-contract');
const { declaresStatuses } = require('../lib/contract-kit'); // names the statuses the books-entry door (lib/books-evidence-attach) answers for the register // the contract (each route's operation), the words of a refusal and the 6 MB limit (one source)
const disputeAudience = require('../lib/dispute-audience'); // RAIL-187: a file on a dispute message goes to the parties that message goes to: the one reading, not a copy of it
const access = require('../lib/access');
const ctpReturn = require('../lib/ctpreturn'); // RAIL-106: a file on a chit is told to the parties on other installations, who pull it

/**
 * Who gets a copy of a file put on a chit: every participant named on the caller's own copy (and the caller), except an INTERNAL note's file, which stays with its author entity.
 * A DISPUTE message's file → the dispute's own audience (lib/dispute-audience, the rule its message delivery uses), `toIds` naming it for the copy sent to other installations.
 * → { participants, internalNote, toIds? } or null when the caller holds no copy of the chit (not a participant).
 */
async function audienceFor(entity_id, chit_id, message_id) {
  const rosterRow = await withEntity(entity_id, (db) => db.query(`SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]));
  if (!rosterRow.rows.length) return null;
  const participants = [...new Set((rosterRow.rows[0].all_recipients || []).map((item) => item.entity_id).filter(Boolean))];
  if (!participants.includes(entity_id)) participants.push(entity_id);
  if (!message_id) return { participants, internalNote: false };
  // an INTERNAL-message attachment stays private to its entity (single copy)
  const message = await withEntity(entity_id, (db) => db.query(`SELECT visibility_entity_id, is_dispute, dispute_id FROM chit_messages WHERE message_id = $1 AND chit_id = $2 LIMIT 1`, [message_id, chit_id]));
  if (!message.rows.length) return { participants: [entity_id], internalNote: false, toIds: [entity_id] }; /* RAIL-187: a message I hold no copy of is none I may widen a file onto: my copy only */
  const owner = message.rows[0] && message.rows[0].visibility_entity_id;
  if (owner) return { participants: [owner], internalNote: true };
  const disputed = message.rows[0] && message.rows[0].is_dispute && message.rows[0].dispute_id;
  if (!disputed) return { participants, internalNote: false };
  const dispute = await disputeAudience.audienceOf(entity_id, chit_id, disputed);
  if (!dispute) return { participants: [entity_id], internalNote: false, toIds: [entity_id] }; /* fail closed: not a party to that dispute → my copy only */
  return dispute.wide ? { participants, internalNote: false } : { participants: dispute.ids, internalNote: false, toIds: dispute.ids };
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
/** S1: a file on an entry of the books, not on a chit: the books' own door logic (seat, type by bytes, add-only, duplicate note) */
async function onEntry(req, res, entity_id, body) {
  if (!body.data_base64 || !body.name) return problem(req, res, { status: 400, ...words.missingFields() });
  const done = await require('../lib/books-evidence-attach').put(req, entity_id, body);
  return done.refuse ? problem(req, res, done.refuse) : res.json(done.ok);
}
/** LENS-SEC 1129: a VIEWER seat attaches nothing (a file lands on every participant's copy); the rail's read_only 403, same as access.writeGate. A commenter may still attach to an internal note. */
function viewerGate(req, res, next) {
  if (access.levelOf(req.identity) !== access.VIEWER || require('../lib/owner').isOwner(req)) return next();
  return access.writeGate(req, res, next);
}
// PER-ENTITY copies (b66): replicate one row per participant so each owns its own. Audience = all chit participants
// (from the caller's all_recipients), EXCEPT an internal-message attachment which stays single (author entity only).
// @does A chit id, file name and base64 data in -> we store a copy for each participant of that chit -> the attachment record.
router.post('/', auth, viewerGate, declaresStatuses([404, 415, 503]) /* the entry door's own refusals: no such entry, bytes that are not JPEG/PNG/PDF, columns not built yet */, ...contract.checked('POST /'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { chit_id, message_id, line_index, name, mime, data_base64, entry_id } = req.body || {};
    if (entry_id) return onEntry(req, res, entity_id, { entry_id, name, data_base64 });
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
    const crossed = audience.internalNote ? { queued: 0 } : await ctpReturn.onAttachment(entity_id, announcement(file, id, buffer), audience.toIds);
    res.json({ id, name, mime: mime || 'application/octet-stream', size: buffer.length, ...ctpReturn.answerOf(crossed) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Upload failed')); /* the cause is logged with the request id; the caller gets the one generic sentence */
  }
});

// A file on an entry of the books is ADD-ONLY: any change of it (delete, replace) is refused with a code. Any other id falls through to the router's own answer, as before (no route for these verbs).
router.use('/:id', (req, res, next) => {
  if (!['DELETE', 'PUT', 'PATCH'].includes(req.method)) return next();
  auth(req, res, async (err) => {
    if (err) return next(err);
    try {
      const refused = await require('../lib/books-evidence-attach').guardChange(auth.entityOf(req), req.params.id);
      return refused ? problem(req, res, refused) : next();
    } catch (fault) {
      problem(req, res, faultOf(fault, req, 'Upload failed'));
    }
  });
});

// GET /api/attachments/:id — stream the bytes (on demand). Participant-checked.
// @does An attachment id in -> we stream the caller's own copy, rendering only images and PDFs inline -> the file bytes.
router.get('/:id', auth, ...contract.checked('GET /:id'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    // PER-ENTITY: getBlob is entity-scoped (RLS) — it returns ONLY the caller's own copy, else nothing. No shared read.
    const a = await storage.getBlob(req.params.id, entity_id);
    if (!a) return problem(req, res, { status: 404, ...words.notHeld() });
    sendBlob(res, a); /* S2: lib/attachment-send, the one writer of a stored file's headers */
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Fetch failed')); /* the cause is logged with the request id; the caller gets the one generic sentence */
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

router.contentDisposition = require('../lib/attachment-send').contentDisposition; /* RAIL-189: pinned by tests/c11-10b-rail-shape.test.cjs */
module.exports = router;
