/*
 * OWNS      the contract of routes/flags.js (private bookmarks and notes, API-STANDARD S9): each route's OpenAPI operation, its strict input and its answer shape.
 * CALLED BY routes/flags.js (checked(route) in front of each handler, router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
 * Nine routes: the flags of the records a page shows (POST /query, a read), the organisation's open list (GET /), the Home count (GET /counts), the ONE add door (POST /), resolve · reopen · share · remove one flag, and clear the bookmarks of one client (POST /clear).
 * ⚠️ NO `X-Books-For`, NO grant middleware: a flag belongs to the caller's own organisation (lib/private-flag).
 */
'use strict';
const { contractOf, object, array, text, maybeText } = require('./contract-kit');
const { SEATS } = require('./role-matrix'); /* the role matrix: what each seat is answered (register column 14) */

/* the flag id is a number the page was given; a malformed one is the same 404 as an unknown one (lib/private-flag), so the schema asks only for a non-empty word */
const FLAG = object(['flag_id', 'kind', 'visibility', 'subject_kind', 'subject_entity', 'subject_id', 'label', 'state', 'seat', 'mine', 'created_at'], {
  flag_id: text, kind: text, visibility: text, subject_kind: text, subject_entity: text, subject_id: text, label: text, note: maybeText, state: text, seat: text, by_name: maybeText,
  mine: { type: 'boolean' }, created_at: text, resolved_by: maybeText, resolved_at: maybeText
}, true);
const FLAG_OUT = object(['flag', 'unchanged'], { flag: FLAG, unchanged: { type: 'boolean' } }, true);
const ITEM = object(['id', 'label'], { id: text, label: text });
const REPLY_MAY = object(['ok', 'why'], { ok: { type: 'boolean' }, why: maybeText }, true);
const THREAD = object(['flag', 'messages', 'may'], {
  flag: FLAG,
  messages: array(object(['message_id', 'text', 'mine', 'at'], { message_id: text, by_name: maybeText, text: text, mine: { type: 'boolean' }, at: text }, true)),
  may: object(['reply'], { reply: REPLY_MAY }, true)
}, true);

const ROUTES = {
  'POST /query': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'The flags of the records a list page shows (ids in the body, at most 200), one read; a read, not a write', gates: [], inline: [403, 404, 422, 503], body: { subject_kind: text, subject_entity: text, ids: array(text) }, required: ['subject_kind', 'subject_entity', 'ids'], rules: { additionalProperties: false },
    out: object(['subject_kind', 'subject_entity', 'flags'], { subject_kind: text, subject_entity: text, flags: { type: 'object', additionalProperties: array(FLAG) } }, true) },
  'GET /': { seats: SEATS.EVERYONE_SIGNED_IN, summary: "The organisation's open flags this person may read, newest first, paged; one client's with subject_entity", gates: [], inline: [403, 404, 422, 503], query: ['subject_entity', 'kind', 'page', 'limit'],
    out: object(['flags', 'total', 'page', 'limit'], { flags: array(FLAG), total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } }, true) },
  'GET /counts': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'How many open flags this person may read, for Home: one read', gates: [], inline: [403, 404, 503], out: object(['open', 'bookmarks', 'notes'], { open: { type: 'integer' }, bookmarks: { type: 'integer' }, notes: { type: 'integer' } }, true) },
  'POST /': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Bookmark one or many records (items, at most 200) or write one note, for your organisation or only for you; the writer keeps it, the client never sees it', gates: [], ok: 201, inline: [403, 404, 422, 503],
    body: { kind: text, visibility: text, subject_kind: text, subject_entity: text, items: array(ITEM), note: maybeText }, required: ['kind', 'subject_kind', 'subject_entity', 'items'], rules: { additionalProperties: false },
    out: object(['created', 'already', 'flags'], { created: { type: 'integer' }, already: { type: 'integer' }, flags: array(FLAG) }, true) },
  'POST /:id/resolve': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Resolve a note: it stays, greyed, with who and when', gates: [], inline: [403, 404, 409, 503], body: {}, rules: { additionalProperties: false }, out: FLAG_OUT },
  'POST /:id/reopen': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Open a resolved note again', gates: [], inline: [403, 404, 409, 503], body: {}, rules: { additionalProperties: false }, out: FLAG_OUT },
  'POST /:id/share': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Share an Only-me flag with your organisation (its writer only; it cannot be taken back)', gates: [], inline: [403, 404, 409, 503], body: {}, rules: { additionalProperties: false }, out: FLAG_OUT },
  'POST /:id/remove': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Remove a bookmark or a note: the words are gone, who and when stay', gates: [], inline: [403, 404, 409, 503], body: {}, rules: { additionalProperties: false }, out: FLAG_OUT },
  'GET /:id/messages': { seats: SEATS.EVERYONE_SIGNED_IN, summary: "The replies of one note of your organisation, oldest first, and whether you may reply now (the firm's own thread; the client never sees it)", gates: [], inline: [403, 404, 503], out: THREAD },
  'POST /:id/messages': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Reply on a My-firm note: one more message in your own organisation, never the client side; an Only-me, resolved or removed note takes none', gates: [], ok: 201, inline: [403, 404, 409, 422, 503],
    body: { message_text: text }, required: ['message_text'], rules: { additionalProperties: false }, out: THREAD },
  'POST /clear': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'Remove the open bookmarks of one client in one act, optionally the ones set between two days', gates: [], inline: [403, 404, 422, 503], body: { subject_entity: text, from: maybeText, to: maybeText }, required: ['subject_entity'], rules: { additionalProperties: false }, out: object(['cleared'], { cleared: { type: 'integer' } }, true) }
};

module.exports = Object.assign({ ROUTES }, contractOf({ mount: '/api/flags', routes: ROUTES, gateStatus: {} }));
