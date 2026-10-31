/*
 * OWNS      the contract of the network routes (23): src/routes/network.js (/api/network, 12 — the tree, the edges between businesses), routes/network-design.js (/api/network-design, 7 —
 *           the saved drawing, the check, the build, the code, the search) and routes/connections.js (/api/connections, 4 — the handshake) — each route's OpenAPI operation (S9) and the one
 *           way their refusals and faults are worded (netFault, failed, the words).
 * CALLED BY src/routes/network.js · routes/network-design.js · routes/connections.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | netFault(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-network.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old body ({ error, code } · { error, message }) beside the Problem fields
 *           a thrown error → netFault(e, req): the service's own refusal (status, code, words) or a 500 that says nothing of its cause
 * CARD      04-network/connections-and-invitations
 * Reuses lib/products-contract.js (said · failed: the one way to word a refusal and a fault), lib/catalogue-contract.js (MESSAGE_TEXT: the chain's trim() then not-empty) and
 * lib/storefront-contract.js (refusalFor · trimmed · NETWORK_NOT_READ). This file shapes NO answer: the tree, the edges and the build are src/services/network.js and lib/network-build-run.js, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required but what the old validator chain required (the handshake's receiver and answer), nothing narrowed. A handler
 *    answers a missing or odd value in its own sentence, and those sentences are frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep. The one thing a schema
 *    refuses is a body that is not an object, or a query value given twice: answered 400 in the shape each route always refused in. A malformed id in a path stays a 404 (plain text).
 * ⚠️ A legacy `code` key is kept: the Problem's `code` is that same word where the old body had one (the service's NOT_ALLOWED, EDGE_NOT_FOUND ..., ERR for a fault, ROOT_HANDLE_*).
 * ⚠️ The Problem owns `status`: the handshake's "Connection already exists with status: pending" used to carry the state as a key called `status` (a word). It cannot ride along as such; the
 *    sentence still names it and `params.connection_status` carries it.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array, any } = require('./contract-kit');
const { said, failed } = require('./products-contract');
const { MESSAGE_TEXT } = require('./catalogue-contract');
const { refusalFor, trimmed, NETWORK_NOT_READ } = require('./storefront-contract');
const { UUID_RE } = require('./trace'); /* NET-48: an id that is not a uuid names no one */
const { parse: parseName } = require('./ctpaddress'); /* NET-48: a handle or bridge id is a bare name, 3-64 of [A-Za-z0-9._~-] (Q22: no new rule) */

/* ── the words of /api/network ──────────────────────────────────────────────────────────────────────────── */
const FAULT_CODE = 'ERR';
const writesOff = () => said('NET_WRITE_DISABLED', { error: 'Network editing disabled', message: "Network changes aren't available yet.", code: 'NET_WRITE_DISABLED' });
/**
 * netFault(e, req) — the spec of whatever a tree route's catch got. A refusal the service made on purpose carries a status and a code and keeps both, with its sentence as `error` (the
 * body { error, code } the tree routes always answered); anything else is a 500 that says nothing of its cause (the real error is logged with the request id) and keeps the code ERR.
 */
function netFault(e, req) {
  if (e && e.status) {
    const code = e.code || FAULT_CODE;
    return { status: e.status, code, detail: e.message, legacy: { error: e.message, code } };
  }
  return internalSpec(req, e, { error: SAFE_SENTENCE, code: FAULT_CODE }, FAULT_CODE);
}

/* ── NET-48: who a connection names must be able to exist, or the answer is "not found" before the database is asked ── */
const NAMES = [['parentId', 'parent', true], ['parentHandle', 'parent', false], ['childId', 'child', true], ['childBridgeId', 'child', false], ['childHandle', 'child', false]];
const bareName = (value) => {
  const parsed = parseName(value);
  return parsed.ok && !parsed.qualified;
};
const canExist = (isUuid, value) => typeof value === 'string' && (isUuid ? UUID_RE.test(value) : bareName(value));
/** the refusal for the first side named by something that cannot exist (the sentences the service itself gives), or null; a field left out is the service's business */
function unknownSide(body) {
  const named = NAMES.find(([field, , isUuid]) => body[field] != null && body[field] !== '' && !canExist(isUuid, body[field]));
  if (!named) return null;
  const parent = named[1] === 'parent';
  return netFault({ status: 404, code: parent ? 'PARENT_NOT_FOUND' : 'CHILD_NOT_FOUND', message: parent ? 'network not found' : 'business not found — check the handle' });
}

/* ── the words of /api/network-design ───────────────────────────────────────────────────────────────────── */
const BAD_REQUEST = 'NETWORK_BAD_REQUEST';
const badRequest = (message) => said(BAD_REQUEST, { error: 'Bad request', message });
const draftNotObject = () => badRequest('draft must be an object');
const tooLarge = (maxBytes) => said('NETWORK_TOO_LARGE', { error: 'Too large', message: 'design exceeds ' + maxBytes + ' bytes' });
const buildOwnerOnly = () => said('NETWORK_OWNER_ONLY', { error: 'Not permitted', message: 'Only the business owner can build a network. Sign in as the business itself.' });
const reissueOwnerOnly = () => said('NETWORK_OWNER_ONLY', { error: 'Not permitted', message: 'Only the business owner can re-issue a store code.' });
const accountUnread = () => said('NOT_FOUND', { error: 'Not found', message: 'Your account could not be read.' });
const nothingDesigned = () => said(BAD_REQUEST, { error: 'Nothing designed', message: 'Draw the network first — add the branches and units you want, then build.' });
const noStoreNamed = () => badRequest('Which store? Send its handle as user_id.');
const notYourStore = (handle) => said('NOT_FOUND', { error: 'Not found', message: `You did not create a store called "${handle}".` });
const searchTooShort = () => badRequest('Search for a product — two characters or more.');
const nameTaken = () => said('NETWORK_NAME_TAKEN', { error: 'Name taken', message: 'One of these names was taken while the network was being built. Nothing was created — try again.' });
const visibilityNotMigrated = () =>
  said('VISIBILITY_NOT_MIGRATED', { error: 'Migration needed', code: 'VISIBILITY_NOT_MIGRATED', message: 'This database does not accept "network" visibility yet — apply migration b115.' });
/** a roster read that failed is never "no stores": the one body lib/network-membership words (the route answers it 503) */
const networkNotRead = () => said(NETWORK_NOT_READ.code, NETWORK_NOT_READ);
/** the words of a roster read that failed (lib/network-membership throws NETWORK_READ_FAILED), or null when the error is anything else */
const unreadWords = (err) => (err && err.code === NETWORK_NOT_READ.code ? networkNotRead() : null);
/** a refusal the build's first step made (lib/network-build-run rootOf): its own status, code and words, kept whole */
const relayed = (refuse) => ({ status: refuse.status, ...said(refuse.body.code || BAD_REQUEST, refuse.body) });

/* ── the words of /api/connections ──────────────────────────────────────────────────────────────────────── */
const toYourself = () => said('CONNECTION_BAD_REQUEST', { error: 'Invalid request', message: 'Cannot connect to yourself' });
const receiverUnknown = () => said('NOT_FOUND', { error: 'Not found', message: 'Entity not found' });
/** the sentence names the state; the state itself rides in params (the Problem owns the key `status`) */
const connectionExists = (state) => {
  const message = `Connection already exists with status: ${state}`;
  return { ...said('CONNECTION_EXISTS', { error: 'Connection exists', message }), params: { connection_status: state } };
};
const requestUnknown = () => said('NOT_FOUND', { error: 'Not found', message: 'Connection request not found or already responded' });

const words = { writesOff, draftNotObject, tooLarge, buildOwnerOnly, reissueOwnerOnly, accountUnread, nothingDesigned, noStoreNamed, notYourStore, searchTooShort, nameTaken, visibilityNotMigrated, networkNotRead, toYourself, receiverUnknown, connectionExists, requestUnknown };
/** every code these words answer under (the service's own are read from the service by the test): the test holds them to docs/ERROR-CODES.md */
const CODES = [...new Set([FAULT_CODE].concat(['NET_WRITE_DISABLED', BAD_REQUEST, 'NETWORK_TOO_LARGE', 'NETWORK_OWNER_ONLY', 'NETWORK_NAME_TAKEN', 'VISIBILITY_NOT_MIGRATED', NETWORK_NOT_READ.code, 'ROOT_HANDLE_UNUSABLE', 'ROOT_HANDLE_NEEDED', 'ROOT_HANDLE_TAKEN', 'CONNECTION_BAD_REQUEST', 'CONNECTION_EXISTS', 'INVALID_INPUT', 'NOT_FOUND', 'INTERNAL']))];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { write: 503 };
const WRITES = ['write'];
/** the refusals the service raises beyond a row's own statuses: its status and code, the words are the service's (frozen in docs/contracts/api-legacy.json) */
const refusal = (status, code, when) => ({ status, code, when });
const NOT_ALLOWED = refusal(403, 'NOT_ALLOWED', 'the business asking is not one of the two on that connection, or not in that network (a suspended member is refused the tree)');
const EDGE_GONE = refusal(404, 'EDGE_NOT_FOUND', 'no such connection');
const WRONG_STATE = refusal(409, 'BAD_STATE', 'the connection is not in a state where that can be done');

const TREE_ROUTES = {
  'POST /entities': { summary: 'Register a business on the tree (a node of its own)', gates: WRITES, invalid: 400, body: ['name', 'mode', 'businessType', 'ownerScope', 'claimed', 'appRef'], refusals: [refusal(400, 'NAME_REQUIRED', 'no name was sent'), refusal(500, 'MINT_FAILED', 'no free bridge id after five tries')], out: object([]) },
  'GET /entities/lookup': { summary: "A business's public card by its bridge id, or that there is none (?bridgeId=)", invalid: 400, query: ['bridgeId'], out: object(['found']) },
  'POST /entities/:id/claim': { summary: 'The business a node belongs to claims it', gates: WRITES, invalid: 400, body: [], refusals: [NOT_ALLOWED, refusal(409, 'ALREADY_CLAIMED', 'it was claimed already')], out: object([]) },
  'GET /place': { summary: 'Where a business sits and the whole network around it, in one answer (?bridgeId=)', invalid: 400, query: ['bridgeId'], out: object(['found']) },
  'GET /entities/:id/subtree': { summary: 'A node and everything below it, for a business in the same network', invalid: 400, refusals: [NOT_ALLOWED], out: array() },
  'GET /entities/:id/connections': { summary: 'The open connections of a node, for the node itself or a business above it', invalid: 400, refusals: [NOT_ALLOWED], out: array() },
  'POST /connections': {
    summary: 'Ask to connect: a network invites a business, or a business asks to join (either side may ask)',
    gates: WRITES,
    invalid: 400,
    body: ['parentId', 'parentHandle', 'childId', 'childBridgeId', 'childHandle', 'type'],
    refusals: [refusal(400, 'BAD_TYPE', 'the type is not governance or commercial'), refusal(400, 'SELF', 'a business cannot connect to itself'), refusal(401, 'NO_ACTOR', 'the sign-in is not a business'), NOT_ALLOWED, refusal(404, 'PARENT_NOT_FOUND', 'no such network'), refusal(404, 'CHILD_NOT_FOUND', 'no such business'), refusal(409, 'HAS_PARENT', 'the business is in a network already (a tree has one parent)'), refusal(409, 'EXISTS', 'already asked, or already connected')],
    out: object([])
  },
  'POST /connections/:id/approve': { summary: 'The side that did not ask accepts the connection', gates: WRITES, invalid: 400, body: [], refusals: [NOT_ALLOWED, EDGE_GONE, refusal(409, 'BAD_STATE', 'it is not waiting for an answer'), refusal(409, 'UNCLAIMED', 'the business is an unclaimed stub, it cannot consent'), refusal(409, 'HAS_PARENT', 'the business is in a network already'), refusal(409, 'CYCLE', 'the network would sit under its own member')], out: object([]) },
  'POST /connections/:id/decline': { summary: 'Either side declines a connection that is waiting', gates: WRITES, invalid: 400, body: [], refusals: [NOT_ALLOWED, EDGE_GONE, WRONG_STATE], out: object([]) },
  'POST /connections/:id/suspend': { summary: 'The network suspends a member (authority flows down)', gates: WRITES, invalid: 400, body: [], refusals: [NOT_ALLOWED, EDGE_GONE, WRONG_STATE], out: object([]) },
  'POST /connections/:id/resume': { summary: 'The network resumes a suspended member', gates: WRITES, invalid: 400, body: [], refusals: [NOT_ALLOWED, EDGE_GONE, WRONG_STATE], out: object([]) },
  'POST /connections/:id/disconnect': { summary: 'Either side ends a connection; with settle: true its open chits are withdrawn first', gates: WRITES, invalid: 400, body: ['settle'], refusals: [NOT_ALLOWED, EDGE_GONE, WRONG_STATE, refusal(409, 'IN_FLIGHT', 'an open chit is on the connection and settle was not asked')], out: object([]) }
};
const BUILD_REFUSALS = [
  refusal(409, 'ROOT_HANDLE_NEEDED', 'no User ID and no network name stated: asked, never guessed'),
  refusal(409, 'ROOT_HANDLE_UNUSABLE', 'the User ID cannot be a network name'),
  refusal(409, 'ROOT_HANDLE_TAKEN', 'the stated network name is taken'),
  refusal(400, 'ROOT_HANDLE_NEEDED', 'the stated network name will not do')
];
const DESIGN_ROUTES = {
  'GET /': { summary: "This business's saved network drawing (null if none yet)", out: object(['draft', 'updated_at']) },
  'PUT /': { summary: 'Save the whole drawing; what was built and invited stays recorded', invalid: 400, inline: [400, 413], body: { draft: any }, out: object(['ok', 'updated_at']) },
  'POST /validate': { summary: 'What would break if this were built (reads, writes nothing): the drawing sent or the saved one', invalid: 400, inline: [400, 413], body: ['draft', 'root_handle', 'ceiling', 'sample'], out: object(['dry_run', 'sample', 'ok']) },
  'POST /build': { summary: 'Turn the saved drawing into real businesses (or, with dry_run, say what would happen)', invalid: 400, inline: [400, 403, 404, 409], body: ['dry_run', 'root_handle'], refusals: BUILD_REFUSALS, out: object(['ok']) },
  'POST /reissue': { summary: 'A new claim code for a store this business created', invalid: 400, inline: [400, 403, 404], body: ['user_id'], out: object(['ok', 'user_id', 'display_name', 'claim_code', 'expires_at', 'message']) },
  'GET /availability': { summary: 'Who in my network has this product, and how fast can it get here (?q=, two characters or more)', invalid: 400, inline: [400, 404, 503], query: ['q'], out: object(['q', 'rows', 'summary']) },
  'GET /stores': { summary: 'Who is in my network and where: the stores I may look at', invalid: 400, inline: [404, 503], out: object(['stores']) }
};
const TO_ENTITY = Object.assign({}, MESSAGE_TEXT, { examples: ['x'] });
/** the old chain's optional().trim().isLength({ max: 500 }): no more than 500 characters once the spaces either side are gone (a number or a flag was turned to text) */
const NOTE = { anyOf: [{ type: 'string', pattern: '^\\s*(?:\\S(?:[\\s\\S]{0,498}\\S)?)?\\s*$' }, { type: ['number', 'boolean', 'null'] }] };
const ACTION = { type: 'string', enum: ['accept', 'reject'] };
const CONNECTION_ROUTES = {
  'POST /request': { summary: 'Ask another business to connect', invalid: 400, inline: [400, 404], body: { to_entity_id: TO_ENTITY, note: NOTE }, required: ['to_entity_id'], out: object(['message', 'connection_id', 'to']) },
  'GET /pending': { summary: 'Connection requests waiting for this business to answer', invalid: 400, query: ['page', 'limit'], out: object(['count', 'requests']) },
  'PUT /:id/respond': { summary: 'Accept or reject a request that was made to this business', invalid: 400, inline: [404], body: { action: ACTION }, required: ['action'], out: object(['message', 'connection_id', 'status']) },
  'GET /list': { summary: 'The connections this business has accepted', invalid: 400, query: ['page', 'limit'], out: object(['count', 'connections']) }
};

const network = contractOf({ mount: '/api/network', routes: TREE_ROUTES, gateStatus: GATE_STATUS, extension: 'x-network-refusals' });
const design = contractOf({ mount: '/api/network-design', routes: DESIGN_ROUTES, gateStatus: {}, extension: 'x-network-design-refusals' });
const connections = contractOf({ mount: '/api/connections', routes: CONNECTION_ROUTES, gateStatus: {}, extension: 'x-connections-refusals' });
const CONTRACTS = [network, design, connections];
const OPERATIONS = Object.assign({}, ...CONTRACTS.map((contract) => contract.OPERATIONS));
/** the refusal statuses a test may see from one route of any of the three mounts */
const allowedStatuses = () => (key) => CONTRACTS.map((contract) => contract.allowedStatuses()(key)).find((found) => found.length) || [];

/* ── the schema's own refusal, in the shape each mount always refused in ── */
/** the old validator chains of the handshake, field by field with the chain's own message: refusalFor keeps their 400 "Validation failed" body */
const CHAINS = { 'POST /request': [['to_entity_id', 'Receiver entity ID required'], ['note']], 'PUT /:id/respond': [['action', 'Action must be accept or reject']] };
/** the fields the old chain trim()med before it looked: the route reads what it always read */
const TRIMMED = { 'POST /request': ['to_entity_id', 'note'], 'PUT /:id/respond': ['action'] };
const schemaOptions = {
  network: { status: 400, code: BAD_REQUEST, legacy: (failures) => ({ error: failures[0].detail, code: BAD_REQUEST }) },
  design: { status: 400, code: BAD_REQUEST, legacy: (failures) => ({ error: 'Bad request', message: failures[0].detail }) },
  connections: (route) => refusalFor(CHAINS[route] || [])
};
/** what the handshake's chain did before the schema looked: spaces either side of the receiver, the note and the answer are gone */
const trimmedFor = (route) => trimmed(...(TRIMMED[route] || []));

module.exports = { unknownSide, netFault, failed, words, relayed, unreadWords, CODES, schemaOptions, trimmedFor, TRIMMED, CHAINS, OPERATIONS, allowedStatuses, network, design, connections };
