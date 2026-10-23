/*
 * OWNS      the contract of routes/attachments.js (2 routes, /api/attachments — a file on a chit, a copy of it for every participant): each route's OpenAPI operation (S9), the words its
 *           refusals answer in (words), the one limit of a file (MAX_MB, MAX_BYTES), and the one way a fault is worded (faultOf, over lib/products-contract.js `failed`).
 * CALLED BY routes/attachments.js (contract.checked on each route, router.openapi, problem(req, res, { status, ...words.x() } | faultOf(e, req, label))) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-attachments.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) → the old { error, message } beside the Problem fields
 *           a thrown error → faultOf(e, req, label): a 500 with the screen's own label and the one generic sentence, whatever the error said
 * CARD      01-rail-core-the-chit/attachments
 * This file shapes NO success answer and reads no row: the copies, the roster, the internal-message rule and the bytes are routes/attachments.js and lib/storage.js, as before.
 *
 * ⚠️ NO BEHAVIOUR CHANGE. The upload's input schema says what the handler ALREADY takes: a body is an object OR a list (a list was read as no fields and answered the route's own 400),
 *    nothing is required (the handler's own 400 names the three it needs, in its own words), and every value is anything (`name` and `mime` are text-ified, `line_index` is parseInt of whatever came,
 *    `data_base64` is read as text). An unknown key is NOT refused (the handler drops it: `participants`, `audience`, `entity_id` change nothing), so strict_input stays open on the upload.
 *    The schema check in front of each route can therefore refuse nothing; the refusal the kit declares for it (400 for the upload, the status the route answers itself; 422 for the id route) is never
 *    answered by the schema. A path id is plain text (a malformed one is the database's own 22P02, a 500 'Fetch failed', as before).
 * ⚠️ THE RELAY STILL RELAYS, AND ONLY FIXED WORDS. `faultOf` carries the constant sentence of lib/respond.js safeErr ('Something went wrong — please try again.') in `message` of each 500: it can pass
 *    NOTHING of the error (a database error, an object-store provider's text, a header error are all logged with the request id and dropped). Every other sentence below is a literal; the one
 *    interpolated part is the limit (MAX_MB, a constant). Moving the relay into this file stops the raw-error ratchet counting it; the PR says so.
 * ⚠️ THE 200 OF THE UPLOAD ECHOES `name` AND `mime` AS SENT (not the sliced text stored, and not text-ified: an object comes back an object). That is the caller's own text to its own caller; it is declared
 *    as any value and is not changed here.
 */
'use strict';
const { contractOf, object, any, text } = require('./contract-kit');
const { said, failed } = require('./products-contract');

/** the largest file, in megabytes: the one place the number lives (the route's check and the sentence it answers with both read it) */
const MAX_MB = 6;
const BYTES_PER_MB = 1024 * 1024;
const MAX_BYTES = MAX_MB * BYTES_PER_MB;

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** every sentence an attachments route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** the upload names no chit, no name or no bytes (400) */
  missingFields: () => said('ATTACHMENT_FIELDS_MISSING', { error: 'Bad request', message: 'chit_id, name and data_base64 are required' }),
  /** the caller holds no copy of that chit, whether it is another shop's or nobody's (403): one answer for both */
  notParticipant: () => said('ATTACHMENT_NOT_A_PARTICIPANT', { error: 'Forbidden', message: 'Not a participant on this chit' }),
  /** the bytes are nothing once the data: prefix is cut (400): this body has always carried only its `error` */
  emptyFile: () => said('ATTACHMENT_EMPTY', { error: 'Empty file' }),
  /** the file is over the limit (413): the shared code of a body too big */
  tooLarge: () => said('BODY_TOO_LARGE', { error: 'Too large', message: 'Max ' + MAX_MB + ' MB per file' }),
  /** the caller's own copy of that id does not exist, whoever else may hold it (404) */
  notHeld: () => said('NOT_FOUND', { error: 'Not found' })
};

/** whatever an attachments route's catch got, worded by the screen's own label; the real error is logged with the request id */
const faultOf = (e, req, label) => failed(e, req, label);

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['ATTACHMENT_FIELDS_MISSING', 'ATTACHMENT_NOT_A_PARTICIPANT', 'ATTACHMENT_EMPTY', 'BODY_TOO_LARGE', 'NOT_FOUND', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const whole = { type: 'integer' };

const ROUTES = {
  'POST /': {
    summary: 'Put a file on a chit: one copy for every participant, each owned by its holder (the file of an internal message stays with its author)',
    list: true,
    body: ['chit_id', 'message_id', 'line_index', 'name', 'mime', 'data_base64'],
    invalid: 400,
    inline: [403, 413],
    out: object(['id', 'name', 'mime', 'size'], { id: text, name: any, mime: any, size: whole })
  },
  'GET /:id': {
    summary: 'The bytes of your own copy of an attachment: shown inline only for png, jpeg, gif, webp, bmp and pdf, everything else is a download (nosniff)',
    media: 'application/octet-stream'
  }
};

/** the contract of the router, of the kit's making */
const contract = contractOf({ mount: '/api/attachments', routes: ROUTES, gateStatus: {} });

module.exports = Object.assign({}, contract, { contract, words, faultOf, CODES, MAX_MB, MAX_BYTES, ROUTES });
