'use strict';
/**
 * lib/books-evidence-attach.js — A RECEIPT ON A POSTED ENTRY OF THE BOOKS (S1 of REQ-2026-11-20-evidence-and-classification-checks): who may attach, what a file must be, the one write, and the refusal of a delete or replace.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      put(req, entity, body) · guardChange(entity, id) · typeOf(buffer) · mayAttach(req) · the rule that a file on an entry is ADD-ONLY (a second file adds, the first stays)
 * CALLED BY routes/attachments.js (POST / with an entry_id; DELETE · PUT · PATCH /:id) · tests/books-evidence-attach.test.cjs · tests/books-evidence-s1.realstack.cjs
 * FLOW      POST { entry_id, name, data_base64 } → seat (the owner or a seat that can edit; never a key, a viewer, an auditor, a firm) → the columns exist (migration b887; else 503 in words, nothing stored) → bytes: size ≤ 6 MB, type by the FIRST BYTES (JPEG · PNG · PDF; lib/order-input
 *           MAGIC_BYTES), never by name or declared type → the entry is THIS shop's (else the one 404) → sha-256 → storage.putForParticipants (entry_id, sha256; one row, the shop's own) → { id, name, mime, size, entry_id, duplicate? }
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * ⚠️ NO chit is invented (a chit is a document between parties); the file reads as evidence through lib/books-evidence (same shape: files[], count). HEIC is out (a converter is a new dependency): the web sends JPEG.
 * ⚠️ A firm does not attach here: its person signs in as ITSELF, so the entry is not in its books, and the X-Books-For header is refused in words. A firm's write-evidence grant is a later slice.
 * ⚠️ The hash finds EXACT copies only: a re-photographed receipt has another hash and stays silent (said on purpose, critic change 6).
 */
const crypto = require('crypto');
const storage = require('./storage');
const { withEntity } = require('../db');
const { MAGIC_BYTES, magicMatches } = require('./order-input');
const { words, MAX_BYTES } = require('./attachments-contract');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the accepted type of a buffer by its first bytes, or null: 'application/pdf' · 'image/jpeg' · 'image/png' */
const typeOf = (buffer) => Object.keys(MAGIC_BYTES).find((mime) => magicMatches(mime, buffer)) || null;

/** may THIS request add evidence to the shop's own books: not a key, not a request naming a member's books (a firm), and an editor level (lib/access): the owner always is */
function mayAttach(req) {
  if (req.api_key || req.acting_for_grant || (req.headers && req.headers['x-books-for'])) return false;
  return !require('./rail').byLevel(require('./access').levelOf(req.identity), 'amend');
}

/**
 * put(req, entity, body) → { refuse } | { ok }. body = { entry_id, name, data_base64 }. Nothing is stored on a refusal.
 */
async function put(req, entity, body) {
  if (!mayAttach(req)) return { refuse: { status: 403, ...words.notEntrySeat() } };
  if (!(await storage.hasEntryColumns())) return { refuse: { status: 503, ...words.entryNotReady() } };
  const buffer = Buffer.from(String(body.data_base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buffer.length === 0) return { refuse: { status: 400, ...words.emptyFile() } };
  if (buffer.length > MAX_BYTES) return { refuse: { status: 413, ...words.tooLarge() } };
  const mime = typeOf(buffer);
  if (!mime) return { refuse: { status: 415, ...words.typeNotAllowed() } };
  if (!UUID.test(String(body.entry_id))) return { refuse: { status: 404, ...words.entryNotFound() } };
  const mine = await withEntity(entity, (db) => db.query(`SELECT 1 FROM journal_entry WHERE entity_id = $1 AND entry_id = $2`, [entity, body.entry_id]));
  if (!mine.rows.length) return { refuse: { status: 404, ...words.entryNotFound() } };
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const name = String(body.name).slice(0, 200);
  const id = await storage.putForParticipants({ entry_id: body.entry_id, sha256, name, mime, size: buffer.length, buffer, uploaded_by: (req.identity && req.identity.identity_id) || null, participants: [entity], forEntity: entity });
  const twin = await withEntity(entity, (db) => require('./books-evidence').entryFilesFor(db, [String(body.entry_id)]));
  const out = { id, name, mime, size: buffer.length, entry_id: body.entry_id };
  if (twin.dup.has(String(body.entry_id))) out.duplicate = twin.dup.get(String(body.entry_id));
  return { ok: out };
}

/** DELETE / PUT / PATCH on a file id: a file on an entry answers 409 ADD_ONLY (null otherwise: the id is not one of these and the router answers as it always did) */
async function guardChange(entity, id) {
  if (!UUID.test(String(id)) || !(await storage.hasEntryColumns())) return null;
  const row = await storage.meta(id, entity);
  return row && row.entry_id ? { status: 409, ...words.addOnly() } : null;
}

module.exports = { put, guardChange, typeOf, mayAttach };
