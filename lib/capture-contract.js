/*
 * OWNS      the contract of the authenticated intake routes of routes/capture.js (9 of its 12 routes, mounted at /api/capture): each route's OpenAPI operation (S9) and the one way their refusals and
 *           faults are worded (faultOf, storesFault, failed, schemaOptions, CODES). All 12 routes are here since the 7 Nov contract pass, the three webhooks included (GET and POST /webhook/whatsapp, POST /webhook/email); their success replies are the providers' own.
 * CALLED BY routes/capture.js (checked(route) after auth, router.openapi, problem(req, res, faultOf(err, req, label, relay) | storesFault(err, req) | failed(err, req, label)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-capture.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route (after auth) → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(err, req, label, relay) → the refusal our code meant (its status, its sentence) or a fault that says nothing of its cause (its status kept)
 *           a value no column can hold (a NUL byte in text, 22021 · 22P05) → 400 'Cannot save this text. Type it again.', never a 500 (the three webhooks still answer their 200)
 *           a refusal → problem(req, res, spec) → the old { error, message } beside the Problem fields
 * CARD      11-crm-and-marketing/capture
 * Reuses lib/products-contract.js (said · failed: the one way to word a refusal and a fault) and lib/contract-kit.js. This file shapes NO answer: the captures, the structured draft, the raise payload,
 * the consolidation and the stores are lib/capture.js, lib/ai.js, lib/consolidate.js and lib/stores.js, as before.
 *
 * ⚠️ THE THREE WEBHOOKS ARE AN OUTSIDE CONTRACT (Meta, the e-mail provider) AND ARE LEFT EXACTLY AS THEY WERE: the verify echo (text, status 200), the bare 403 `forbidden`, the 401 `{ error: 'bad signature' }`,
 *    the always-200 once a body is signed. No real provider has ever been shown to read a refusal body, so none is changed. They have no operation here (a refusal declared as a Problem would be false of
 *    what they send) and stay partial in the register; tests/api-problem-capture.test.cjs holds their bytes.
 * ⚠️ A RELAY STILL RELAYS. faultOf answers a library's own refusal with the sentence it threw (`relay`: 'any' = whatever status, 'below500' = only under 500, 'none' = never), exactly the three ways the
 *    catches did. Every sentence it can carry is fixed words in lib/capture.js, lib/stores.js or lib/ai.js (traced in docs/critique/API-4-capture.md); a database error has no status and a provider's text
 *    rides only a 502, which no relay passes. The raw-error ratchet no longer counts these catches; the signer reads this spec.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed. The one thing a schema refuses is a body that is not an object, or a query value given twice: answered 400 in
 *    the express-validator body ({ error: 'Validation failed', details }). A malformed id in a path is plain text here, as before: the library asks the database and says its own 404.
 */
'use strict';
const { internalSpec } = require('./problem');
const { safeErr, SAFE_SENTENCE } = require('./respond');
const { said, failed } = require('./products-contract');
const { contractOf, object, array, text } = require('./contract-kit');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const OWN_CODE = /^[A-Z][A-Z0-9_]*$/;
/** the code our own library put on an error (CAPTURE_STORE_MISSING), if it is a code and not a pg SQLSTATE */
const ownCode = (e) => (OWN_CODE.test(String(e.code || '')) ? e.code : null);
/** a refusal's code by its status when the error carries none: the register's own rows where one means the same */
const REFUSAL_CODES = { 400: 'INVALID_INPUT', 402: 'AI_GATED', 404: 'NOT_FOUND', 429: 'AI_LIMIT' };
/** a fault that kept its status (a 502 from the reader, a 503 from the library): the code of what failed */
const FAULT_CODES = { 502: 'AI_PROVIDER', 503: 'AI_UNAVAILABLE' };
const RELAYS = {
  any: () => true,
  below500: (status) => status < 500,
  none: () => false
};

/** K-1: Postgres refuses a NUL byte in text (22021; 22P05 inside a jsonb value). That is the caller's value, not our fault: a 400 that names nothing of the database */
const BAD_TEXT = ['22021', '22P05'];
const badText = () => ({ status: 400, ...said('INVALID_INPUT', { error: 'Cannot save this text', message: 'Cannot save this text. Type it again.' }) });

/** the label of a failure and the one safe sentence, the body of every fault of this area */
const faultBody = (label) => ({ error: label, message: SAFE_SENTENCE });

/**
 * faultOf(e, req, label, relay) — the spec of whatever a capture route's catch got. A thrown error WITHOUT a status is a 500 that says nothing of its cause (logged with the request id). One WITH a status
 * keeps that status: its own sentence when the route's `relay` lets it through ('any', 'below500' or 'none'), else the safe sentence (a 502 from the reader never carries the provider's text).
 */
function faultOf(e, req, label, relay) {
  return BAD_TEXT.includes((e || {}).code) ? badText() : statusFault(e, req, label, relay);
}
/** the fault of an error that is not a text no column can hold: by its status (none: a 500 that says nothing of its cause) */
function statusFault(e, req, label, relay) {
  const status = e && e.status;
  if (!status) return internalSpec(req, e, faultBody(label));
  const code = ownCode(e);
  if (RELAYS[relay](status)) {
    const message = e.message || safeErr(e, { id: req && req.id, path: req && req.path });
    return { status, ...said(code || REFUSAL_CODES[status] || 'CAPTURE_REFUSED', { error: label, message }) };
  }
  return Object.assign(internalSpec(req, e, faultBody(label), code || FAULT_CODES[status]), { status });
}

/** the stores route: its 503 (the table is not migrated, b135) has a code of its own; every other fault is faultOf's, a relay of any status */
function storesFault(e, req) {
  const spec = faultOf(e, req, 'Store save failed', 'any');
  return e && e.status === 503 && !ownCode(e) ? { ...spec, code: 'STORES_NOT_MIGRATED' } : spec;
}

/** a body the schema refuses (not an object, a query value given twice) is answered 400 in the express-validator body: one {field, message} per field at fault */
const schemaOptions = {
  status: 400,
  code: 'INVALID_INPUT',
  legacy: (failures) => ({ error: 'Validation failed', details: failures.map((failure) => ({ field: failure.field, message: failure.detail })) })
};

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = ['AI_GATED', 'AI_LIMIT', 'AI_PROVIDER', 'AI_UNAVAILABLE', 'CAPTURE_REFUSED', 'CAPTURE_STORE_MISSING', 'INTERNAL', 'INVALID_INPUT', 'NOT_FOUND', 'STORES_NOT_MIGRATED', 'WEBHOOK_BAD_SIGNATURE', 'WEBHOOK_VERIFY_REFUSED'];

/* ── the shapes ──────────────────────────────────────────────────────────────────────────────────────────── */
const NO_SUCH_CAPTURE = { status: 404, code: 'NOT_FOUND', when: 'there is no such message in this shop’s inbox (another shop’s is the same answer)' };
const ALREADY_HANDLED = { status: 404, code: 'NOT_FOUND', when: 'the message is not pending any more: it was converted or dismissed' };
const NOT_MIGRATED = { status: 503, code: 'CAPTURE_STORE_MISSING', when: 'the capture table (b104) is not run yet' };
const READER_REFUSALS = [
  NO_SUCH_CAPTURE,
  { status: 422, code: 'CAPTURE_REFUSED', when: 'the reader returned nothing usable, or the message was too long for one reading, or the reply was not valid JSON; nothing was saved' },
  { status: 402, code: 'AI_GATED', when: 'the shop’s AI budget is used' },
  { status: 429, code: 'AI_LIMIT', when: 'the hourly or daily AI limit is reached' },
  { status: 502, code: 'AI_PROVIDER', when: 'the AI provider answered an error (its text is never passed on)' },
  { status: 503, code: 'AI_UNAVAILABLE', when: 'the AI is not connected, is paused for the day or its metering is degraded' }
];
const RAISE_REFUSALS = [NO_SUCH_CAPTURE, { status: 409, code: 'CAPTURE_REFUSED', when: 'the message was already handled, has not been read yet, or nothing in it could be requested' }];

const CLOSED = { additionalProperties: false }; /* S33: any other body key is refused by name */
/** what the three webhooks answer once the provider's signature is checked: always a 200 (the provider retries anything else), `captured` only when something was placed */
const WEBHOOK_ANSWER = object(['ok'], { ok: { type: 'boolean' }, captured: { type: 'integer' }, note: { type: 'string' } }, true);
/** the EMAIL webhook's fields are the provider's, not ours: the ones the handler reads, and any other the provider adds is let through (a closed list would turn real mail away) */
/**
 * S33-T (tolerant by design, Athi 11 Nov 2026): the provider owns the keys. An unknown key is ignored; a key we READ that holds the wrong kind of value is refused 400 (only a SIGNED body gets here).
 * The kinds are the providers' published ones: Mailgun posts recipient, sender, from, subject, body-plain and stripped-text as strings
 * (https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http); SendGrid Inbound Parse names to, from, subject and text as strings. The other spellings the handler also reads stay text.
 * Meta's webhook payload examples (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples) show object, entry[].id, changes[].field, value.metadata.display_phone_number and phone_number_id,
 * contacts[].wa_id, contacts[].profile.name, messages[].from, id, type and text.body as strings; the page does not state the media (image, document, audio, video) fields, so those stay untyped.
 */
const EMAIL_FIELDS = Object.fromEntries(['to', 'To', 'recipient', 'text', 'body-plain', 'stripped_text', 'from', 'From', 'sender', 'subject', 'Subject'].map((name) => [name, text]));
const META_MESSAGE = { type: 'object', properties: { from: text, id: text, type: text, text: { type: 'object', properties: { body: text } } } };
const META_VALUE = { type: 'object', properties: { messaging_product: text, metadata: { type: 'object', properties: { display_phone_number: text, phone_number_id: text } }, contacts: { type: 'array', items: { type: 'object', properties: { wa_id: text, profile: { type: 'object', properties: { name: text } } } } }, messages: { type: 'array', items: META_MESSAGE } } };
const WHATSAPP_FIELDS = { object: text, entry: { type: 'array', items: { type: 'object', properties: { id: text, changes: { type: 'array', items: { type: 'object', properties: { field: text, value: META_VALUE } } } } } } };
const ROUTES = {
  'GET /webhook/whatsapp': { summary: "Meta's webhook handshake: when the verify token matches, the challenge is echoed back as plain text (the provider sets this reply); anything else is refused 403", public: true, inline: [403], media: 'text/plain', noKeys: true, says: 'the challenge, as plain text' },
  'POST /webhook/whatsapp': { summary: "A WhatsApp delivery from Meta: signed (X-Hub-Signature-256) over the raw body, then each message is placed in the inbox of the shop whose number it was sent to; always 200 once signed", public: true, invalid: 400, inline: [401], body: WHATSAPP_FIELDS, says: 'the delivery was taken (200 whatever happened inside, so Meta does not retry)', out: WEBHOOK_ANSWER },
  'POST /webhook/email': { summary: "An inbound e-mail from the mail provider: signed over the raw body, then placed in the inbox of the shop that owns the address it was sent to; always 200 once signed", public: true, invalid: 400, inline: [401], list: true, body: EMAIL_FIELDS, says: 'the mail was taken (200 whatever happened inside)', out: WEBHOOK_ANSWER },
  'POST /simulate': { summary: 'Record a message as if it arrived on the web (always the web channel, whatever is sent); nothing is read, raised or sent', invalid: 400, refusals: [NOT_MIGRATED], rules: CLOSED, body: ['channel', 'sender_ref', 'sender_name', 'subject', 'raw_text', 'media_refs'], out: object(['id', 'channel', 'status', 'created_at']) },
  'GET /pending': { summary: 'The messages waiting in the inbox, newest first (up to 200); the note says when the capture table is not run yet', out: object(['captures'], { captures: array() }) },
  'POST /:id/structure': { summary: 'Ask the AI to read one message into a chit draft: it proposes, a person confirms', invalid: 400, refusals: READER_REFUSALS, rules: CLOSED, body: [], out: object(['capture_id', 'structured']) },
  'POST /:id/raise': { summary: 'Build the payload of a request chit from a read message, priced from the catalogue; it creates nothing, a person still presses send', invalid: 400, refusals: RAISE_REFUSALS, rules: CLOSED, body: ['use_catalogue'], out: object(['purpose', 'subject', 'line_items', 'recipients', 'self_copy', 'business_json', 'original'], { line_items: array(), recipients: array() }) },
  'POST /:id/convert': { summary: 'Record that a person sent the chit: this message became that chit', invalid: 400, refusals: [ALREADY_HANDLED], rules: CLOSED, body: ['chit_id'], out: object(['id', 'status', 'chit_id']) },
  'POST /:id/dismiss': { summary: 'Set a message aside: it leaves the inbox and stays on record', invalid: 400, refusals: [ALREADY_HANDLED], rules: CLOSED, body: [], out: object(['id', 'status']) },
  'GET /consolidate': { summary: 'What a wholesaler must source for a delivery date, and who asked for how much; flagged lines are left out of every total', invalid: 400, query: ['since', 'date'], out: object(['date', 'dates', 'requirement', 'flags', 'unmatched_phrase_count', 'note'], { dates: array(), requirement: array() }) },
  'GET /stores': { summary: 'The shops that write in, by their phone number; provisional ones are first', out: object(['stores', 'migrated'], { stores: array() }) },
  'POST /stores': { summary: 'Name a shop that writes in and give it its default delivery address', invalid: 400, refusals: [{ status: 503, code: 'STORES_NOT_MIGRATED', when: 'the shop list (b135) is not run yet' }], rules: CLOSED, body: ['phone', 'display_name', 'address', 'notes'], out: object(['store_id', 'phone_key', 'display_name', 'address', 'provisional']) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/capture', routes: ROUTES, gateStatus: {}, extension: 'x-capture-refusals' });
const OPERATIONS = contract.OPERATIONS;
const allowedStatuses = () => contract.allowedStatuses();

/** the schema check of one route as a list to spread after auth (a route that takes no input has none) */
function checked(route) {
  const { schemaValidate } = require('../middleware/validate');
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}

module.exports = { faultOf, storesFault, failed, schemaOptions, checked, contract, CODES, OPERATIONS, allowedStatuses, ROUTES };
