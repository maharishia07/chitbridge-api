/*
 * OWNS      the contract of routes/connectors.js (14 routes, /api/connectors — a shop's devices and ERP connectors: make one, its connections, its key, and the two doors a device and an ERP
 *           agent call with their own key): each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (the words, failed, ingestRefusal, VALIDATION_WORDS).
 * CALLED BY routes/connectors.js (checked(route) after the validation chains, router.openapi, problem(req, res, { status, ...words.x() } | failed(e, req, label) | ingestRefusal(known)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-connectors.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route (after the chains) → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old body ({ error, message } · { error, code, message } · { error, code, health, message }) beside the Problem fields
 *           a thrown error → failed(e, req, label): a 500 that says nothing of its cause · ingestRefusal(known(e)): the refusal the database meant, its own status and words, health first
 * CARD      28-platform-and-operations/connectors-routes
 * Reuses lib/products-contract.js (said · failed: the one way to word a refusal and a fault) and lib/contract-kit.js. This file shapes NO answer: the connector, its connections, the receipts,
 * the key and the signal chit are written by the route and the libraries, as before.
 *
 * ⚠️ TWO DOORS ARE READ BY PROGRAMS WE DO NOT REDEPLOY WITH THE API: POST /ingest (a Pi or gateway with its X-Bridge-Key) and POST /erp-ingest (the ERP agent). A 2xx makes the agent move an event to
 *    sent/, a non-2xx keeps it for retry (SEC3). Every status they answered, every old key and every word is kept; a refusal only gains the Problem fields (the agents show `message || error` and parse the
 *    body as JSON whatever its content type). Their schemas take an object or a list, so the schema refuses nothing there.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed. The express-validator chains stay the verdict (their words are the frozen words, VALIDATION_WORDS is their
 *    one source) and run BEFORE the schema check, so every refusal the chains made is still theirs, byte for byte; the schema refuses only what is neither an object nor (on a device door) a list.
 *    POST / branches on `type` (iot or erp): the schema does not declare the enum, because the chain's isIn passes an array value the handler then treats as neither.
 * ⚠️ A wrong code and a locked one at POST /:actorId/regenerate-key are ONE code (OTP_WRONG): the step-up code's reason is for the log, never the door (SEC-81).
 * ⚠️ POST /ingest's 200 carries `file_err` and `proof_err`, the text of an exception (SEC-93, listed for cb-security, not fixed here): its schema names them as they are.
 */
'use strict';
const { object, array, contractOf } = require('./contract-kit');
const { said, failed } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const KEY_ADMIN_ONLY = 'Only the entity admin or a manager delegate may reissue a device key.';
const DEVICE_RULE = 'A device sends only to its own shop and the shop’s own customers or suppliers.';
const NOT_FOUND = { error: 'Not found' };
const WORDS_OF_VALIDATION = { error: 'Validation failed' };

/** the words of each chain's refusal: the chains in routes/connectors.js read them from here, and so does the refusal of a body that is not an object (one source) */
const VALIDATION_WORDS = {
  name: 'Name required',
  type: 'type must be iot or erp',
  gatewayName: 'Type the gateway name',
  code: '6-digit code required',
  ref: 'endpoint/device ref required',
  payload: 'payload (JSON object) required'
};

const words = {
  capabilityOff: () =>
    said('CAPABILITY_OFF', {
      error: 'Capability off',
      code: 'CAPABILITY_OFF',
      message: 'This shop has switched its connector capability off, so its devices and connectors are refused. Turn it back on to resume.'
    }),
  noKey: () => said('NO_KEY', { error: 'No key', code: 'NO_KEY', message: 'Send the ActorKey in the X-Bridge-Key header.' }),
  badKey: () => said('KEY_UNKNOWN', { error: 'Bad key', code: 'KEY_UNKNOWN', message: 'ActorKey not recognised, or the connector is inactive.' }),
  /** a device addressed someone outside its shop's own parties: the reason, then the rule */
  deviceRefused: (reason) => said('DEVICE_TO_REFUSED', { error: 'Forbidden', code: 'DEVICE_TO_REFUSED', message: 'Not sent: ' + reason + '. ' + DEVICE_RULE }),
  unknownDevice: () => said('NOT_FOUND', { error: 'Unknown device', message: 'No connection with that bridge_id under this connector.' }),
  deviceOff: () => said('CONNECTOR_DEVICE_OFF', { error: 'Disabled', message: 'This connection is disabled.' }),
  wrongType: () => said('CONNECTOR_WRONG_TYPE', { error: 'Wrong type', message: 'This endpoint is for ERP connectors. IoT devices use /ingest.' }),
  chitNotDelivered: () =>
    said('CHIT_NOT_DELIVERED', {
      error: 'Not delivered',
      code: 'CHIT_NOT_DELIVERED',
      health: 'live',
      message: 'Health updated, but the signal chit could not be delivered. The device keeps the event and sends it again.'
    }),
  keyAdminOnly: () => said('CONNECTOR_KEY_ADMIN_ONLY', { error: 'Forbidden', message: KEY_ADMIN_ONLY }),
  noEmail: () => said('CONNECTOR_NO_EMAIL', { error: 'No email', message: 'The entity has no registered email to send a code to.' }),
  nameMismatch: () => said('CONNECTOR_NAME_MISMATCH', { error: 'Name mismatch', message: 'The gateway name you typed does not match.' }),
  /** the step-up code was refused: its sentence is verifyOtp's own; a locked code is not told apart from a wrong one (SEC-81), an expired one says so */
  badCode: (verdict) => ({
    ...said(verdict.reason === 'OTP_EXPIRED' ? 'OTP_EXPIRED' : 'OTP_WRONG', { error: 'Bad code', message: verdict.message }),
    hint: 'Check the code and type it again, or ask for a new one.'
  }),
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  noSuchConnector: () => said('NOT_FOUND', { error: 'Not found', message: 'No such connector under this entity.' }),
  noErpConnector: () => said('NOT_FOUND', { error: 'Not found', message: 'No ERP connector with that id under this entity.' }),
  hasDevices: (count) =>
    said('CONNECTOR_HAS_DEVICES', { error: 'Has devices', message: 'This connector has ' + count + ' device' + (count === 1 ? '' : 's') + ' attached — remove them before deleting.' }),
  inUse: () => said('CONNECTOR_IN_USE', { error: 'In use', message: 'This connector has raised records and cannot be hard-deleted. Disable its devices instead.' })
};

/**
 * ingestRefusal(known) — the spec of a refusal the database made on purpose while the signal chit was being delivered (lib/knownerr known(e)): its own status, code and words, with
 * `health: "live"` first (the heartbeat was kept), as the door always answered. The device keeps the event on any non-2xx.
 */
function ingestRefusal(known) {
  return { status: known.status, code: known.body.code, detail: known.body.message, hint: known.body.hint, legacy: Object.assign({ health: 'live' }, known.body) };
}

/** a body the schema refuses (neither an object nor, on a device door, a list) is answered 400 in the chains' own body: one {field, message} per field at fault */
const schemaOptions = {
  status: 400,
  code: 'INVALID_INPUT',
  legacy: (failures) => Object.assign({}, WORDS_OF_VALIDATION, { details: failures.map((failure) => ({ field: failure.field, message: failure.detail })) })
};

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = [
  'CAPABILITY_OFF',
  'CHIT_NOT_DELIVERED',
  'CONNECTOR_DEVICE_OFF',
  'CONNECTOR_HAS_DEVICES',
  'CONNECTOR_IN_USE',
  'CONNECTOR_KEY_ADMIN_ONLY',
  'CONNECTOR_NAME_MISMATCH',
  'CONNECTOR_NO_EMAIL',
  'CONNECTOR_WRONG_TYPE',
  'DEVICE_TO_REFUSED',
  'INTERNAL',
  'INVALID_INPUT',
  'KEY_UNKNOWN',
  'NOT_FOUND',
  'NO_KEY',
  'OTP_EXPIRED',
  'OTP_WRONG',
  'POPULATION_BOUNDARY',
  'STATEMENT_TIMEOUT'
];

/* ── the shapes ──────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { connector: 403 };
const CONNECTOR_ON = ['connector'];
const REFUSALS = [
  { status: 409, code: 'POPULATION_BOUNDARY', when: 'the database refuses a test shop trading with a live one while the signal chit is delivered (the heartbeat is kept: health "live")' },
  { status: 503, code: 'STATEMENT_TIMEOUT', when: 'the database took too long while the signal chit was delivered (the device keeps the event)' }
];
const CONNECTION_FIELDS = ['direction', 'ref', 'schema_ref', 'counterparty_entity_id', 'retention', 'config'];
const CONNECTOR_SHAPE = object(['identity_id', 'display_name', 'type', 'bridge_id', 'site', 'connector_config', 'health']);

const ROUTES = {
  'POST /': { summary: 'Make a connector: an IoT device (a key shown once when it pushes) or an ERP system (a key shown once); type is iot or erp', gates: CONNECTOR_ON, invalid: 400, body: ['display_name', 'type', 'site', 'config'], out: object(['message', 'connector', 'provision_key'], { connector: CONNECTOR_SHAPE }) },
  'POST /ingest': {
    summary: 'A device raises a signal chit with its own key (X-Bridge-Key, no sign-in); health goes live. A 2xx makes the device drop the event, any other status keeps it for retry',
    public: true, list: true, invalid: 400, inline: [401, 403, 404, 409, 503], refusals: REFUSALS,
    body: ['key', 'signal', 'sub_type', 'folder', 'bridge_id', 'unit', 'device_id', 'value', 'to', 'heartbeat_only', 'proof', 'proof_name', 'proof_mime'],
    says: 'Ingested. file_err and proof_err carry the text of an exception when the folder or the proof could not be kept (a finding, not fixed here).',
    out: object(['message', 'health', 'last_seen', 'chit_id', 'proof_id', 'filed', 'file_err', 'proof_err', 'note', 'assigned', 'money_why'])
  },
  'POST /erp-ingest': {
    summary: 'An ERP agent pushes a document with its own key (no sign-in): it is processed into an outcome chit and forgotten, a receipt is kept; a retry of the same document is one receipt. A 2xx makes the agent drop the event',
    public: true, list: true, invalid: 400, inline: [401, 403, 409],
    body: ['key', 'payload', 'doc_type', 'doc_ref', 'to'],
    says: 'Received, or a duplicate of one already received. outcome is processed, logged, duplicate or failed.',
    out: object(['message', 'receipt_id', 'payload_hash', 'outcome', 'chit_id', 'idempotent', 'note'])
  },
  'GET /:actorId/receipts': { summary: 'The receipt ledger of an ERP connector: hash and outcome, never the document', gates: CONNECTOR_ON, invalid: 400, out: object(['receipts', 'total', 'page', 'limit'], { receipts: array() }) },
  'POST /:actorId/erp-test': { summary: 'Run the whole ERP loop from the cockpit with a generated sample document', gates: CONNECTOR_ON, invalid: 400, list: true, body: [], out: object(['message', 'doc_type', 'doc_ref', 'counterparty', 'receipt_id', 'outcome', 'chit_id']) },
  'GET /': { summary: 'The shop’s connectors, with site, config and health', gates: CONNECTOR_ON, out: object(['connectors', 'total', 'page', 'limit'], { connectors: array() }) },
  'GET /:actorId/provisioning': { summary: 'The connection string to put on the Pi (IoT) or the ERP system’s configuration', gates: CONNECTOR_ON, invalid: 400, out: object(['type']) },
  'POST /reissue-code': { summary: 'Email a one-time step-up code to the entity’s own address (entity admin or manager delegate only)', gates: CONNECTOR_ON, invalid: 400, list: true, body: [], out: object(['message', 'email']) },
  'POST /:actorId/regenerate-key': { summary: 'Issue a fresh key (the old one stops at once, the new one is shown once): the gateway name and the emailed code are asked', gates: CONNECTOR_ON, invalid: 400, body: ['name', 'otp'], out: object(['message', 'provision_key']) },
  'POST /:actorId/ping': { summary: 'Mark the connector (and optionally one connection) live', gates: CONNECTOR_ON, invalid: 400, list: true, body: ['bridge_id'], out: object(['message', 'last_seen', 'health']) },
  'POST /:actorId/connections': { summary: 'Add a device or an endpoint under a connector, with its own bridge id', gates: CONNECTOR_ON, invalid: 400, body: CONNECTION_FIELDS, out: object(['message', 'connection']) },
  'GET /:actorId/connections': { summary: 'The connections of a connector; each one’s signal follows the connector’s health', gates: CONNECTOR_ON, invalid: 400, out: object(['actor_health', 'actor_last_seen', 'connections', 'total', 'page', 'limit'], { connections: array() }) },
  'PATCH /:actorId/connections/:connId': { summary: 'Switch one connection on or off', gates: CONNECTOR_ON, invalid: 400, body: ['enabled'], out: object(['message', 'connection']) },
  'DELETE /:actorId': { summary: 'Retire a connector that has no devices attached and no records', gates: CONNECTOR_ON, invalid: 400, inline: [409], out: object(['deleted']) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/connectors', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-connectors-refusals' });
const OPERATIONS = contract.OPERATIONS;
const allowedStatuses = () => contract.allowedStatuses();

/** the schema check of one route as a list to spread after its chains (a route that takes no input has none) */
function checked(route) {
  const { schemaValidate } = require('../middleware/validate');
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}

module.exports = { words, failed, ingestRefusal, schemaOptions, checked, contract, CODES, OPERATIONS, allowedStatuses, VALIDATION_WORDS, ROUTES };
