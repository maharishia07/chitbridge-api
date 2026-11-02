/*
 * OWNS      the contract of routes/integrations.js: each route's OpenAPI operation (S9) and the answers those routes gave before the standard (S2, S14).
 * CALLED BY routes/integrations.js (schemaValidate on each route, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      28-platform-and-operations/integrations
 * Kept apart from the route file so its handlers keep their places (and their history) while the contract grows here.
 */
'use strict';
const { problemResponse } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { shapeOf, outputFilter } = require('./output-allowlist'); /* S34: the answers' closed schemas, derived by tools/api-allowlist.cjs from recorded answers */

/* ── the contract: each route's OpenAPI operation, the ONE source the register, the contract tests, schemaValidate and /api/openapi.json share (S9) ──
   ⚠️ a page argument (page · limit · days · adapter) is declared as text: the route reads it leniently (a bad one falls back), and a schema that
   refused "abc" would turn a fallback into a refusal no caller has ever had. */
const refused = problemResponse;
const json = (schema) => ({ 'application/json': { schema } });
/* OpenAPI 3.1: a body that is not JSON is a string of its media type (API-STANDARD S9) */
const media = (type) => ({ [type]: { schema: { type: 'string', contentMediaType: type } } });
const object = (required, properties) => ({ type: 'object', required, properties: properties || {} });
const text = { type: 'string' };
const PAGE_PARAMS = [
  { name: 'page', in: 'query', required: false, schema: text },
  { name: 'limit', in: 'query', required: false, schema: text }
];
const pathParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string', minLength: 1 } });
const SESSION_OR_KEY = [{ bearer: [] }, { apiKey: [] }];
/** the 200 schema a GET route answers today (docs/contracts/api-output-shapes.json), else the hand-written one */
const answered = (route, handWritten) => {
  const derived = shapeOf('GET /api/integrations' + route);
  return derived && String(derived.status) === '200' ? derived.schema : handWritten;
};
/** the output filter of a GET route as a list to spread after its gates (empty until a shape is derived from recorded answers) */
const filterFor = (route) => {
  const filter = outputFilter(shapeOf('GET /api/integrations' + route), 'GET /api/integrations' + route);
  return filter ? [filter] : [];
};
const NO_SIGN_IN = refused('no or bad credentials');
const FAULT = refused('a fault of ours');
const KIT_OPERATION = {
  summary: 'What a kit should be: its version and every file with its hash (the update path)',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  responses: {
    200: { description: 'the manifest', content: json(answered('/kit', object(['version', 'at', 'files'], { version: text, at: text, files: { type: 'array', items: object(['name', 'sha256', 'bytes']) } }))) },
    401: NO_SIGN_IN,
    500: FAULT
  }
};
const KIT_FILE_OPERATION = {
  summary: 'One file of the kit, exactly as the zip carries it (the name is checked against the kit list)',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  responses: { 200: { description: 'the file', content: media('text/plain') }, 401: NO_SIGN_IN, 404: refused('not a file of the kit'), 500: FAULT }
};
const DOCS_OPERATION = {
  summary: "A connector's instruction document, as markdown",
  tags: ['integrations'],
  parameters: [pathParam('id')],
  responses: { 200: { description: 'the document', content: media('text/markdown') }, 404: refused('no such connector, or it has no document'), 422: refused('the id is missing'), 500: FAULT }
};
const CATALOGUE_OPERATION = {
  summary: 'The connectors that exist, with a download each and whether this shop may have it',
  tags: ['integrations'],
  responses: {
    200: { description: 'catalogue', content: json(answered('/catalogue', object(['connectors'], { connectors: { type: 'array', items: object(['id', 'name', 'download', 'docs', 'may']) } }))) },
    401: refused('credentials were offered and are bad'),
    500: FAULT
  }
};
const DOWNLOAD_OPERATION = {
  summary: "A ZIP of the connector kit, connector.json filled in (the owner's download carries a key)",
  tags: ['integrations'],
  parameters: [pathParam('id'), { name: 'adapter', in: 'query', required: false, schema: text }],
  responses: {
    200: { description: 'the kit', content: media('application/zip') },
    401: refused('credentials were offered and are bad'),
    404: refused('no such connector'),
    409: refused("not offered for this shop's country"),
    422: refused('the id is missing'),
    500: FAULT
  }
};
const HEARTBEAT_OPERATION = {
  summary: 'A running connector checks in (key: connector)',
  tags: ['integrations'],
  security: [{ apiKey: [] }],
  requestBody: {
    content: json({
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: 200 }, // API-18
        name: text,
        adapter: text,
        host: text,
        version: text,
        note: text,
        counters: { type: 'object' },
        tally: { type: 'object' },
        source: { type: 'object' },
        streams: { type: 'array', items: text }
      }
    })
  },
  responses: {
    200: {
      description: 'seen',
      content: json(object(['ok', 'id', 'actor_id', 'created', 'seen', 'approved', 'policy', 'stream_owner'], { ok: { type: 'boolean' }, id: text, actor_id: text, approved: { type: 'boolean' }, policy: { type: 'object' } }))
    },
    400: refused('the check-in is not the shape a kit sends'),
    401: NO_SIGN_IN,
    403: refused('the key is not scoped for connector'),
    500: FAULT
  }
};
const APPROVE_OPERATION = {
  summary: "The owner approves a connector's PC (session only)",
  tags: ['integrations'],
  security: [{ bearer: [] }],
  parameters: [pathParam('actor_id')],
  requestBody: { content: json({ type: 'object' }) },
  responses: {
    200: { description: 'approved', content: json(object(['ok', 'enrol'], { ok: { type: 'boolean' }, enrol: { type: 'object' } })) },
    400: refused('the connector has no key to approve'),
    401: NO_SIGN_IN,
    403: refused('a key cannot approve itself'),
    404: refused('no such connector in this shop'),
    422: refused('the request is not valid'),
    500: FAULT
  }
};
const CHIT_ID = { type: 'string', pattern: '^[0-9a-f-]{36}$', examples: ['11111111-2222-3333-4444-555555555555'] };
const BOOKS_OPERATION = {
  summary: "The kit's write-back after a push: what the books answered for one order (key: connector)",
  tags: ['integrations'],
  security: [{ apiKey: [] }],
  requestBody: { content: json({ type: 'object', required: ['chit_id'], properties: { chit_id: CHIT_ID, kind: text, system: text, outcome: text, why: text, at: text, host: text } }) },
  responses: {
    200: { description: 'recorded on the task', content: json(object(['ok', 'kind', 'books'], { ok: { type: 'boolean' }, kind: text, books: { type: 'object' } })) },
    400: refused('chit_id is missing or not an id'),
    401: NO_SIGN_IN,
    403: refused('the key is not scoped for connector'),
    404: refused('no such order in this shop'),
    500: FAULT
  }
};
const STATUS_OPERATION = {
  summary: 'The connectors that have checked in: last seen, counters',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  parameters: PAGE_PARAMS,
  responses: {
    200: { description: 'connectors', content: json(answered('/status', object(['connectors', 'total', 'page', 'limit'], { connectors: { type: 'array' }, total: { type: 'integer' } }))) },
    401: NO_SIGN_IN,
    422: refused('a page argument is not valid'),
    500: FAULT
  }
};
const STREAMS_OPERATION = {
  summary: 'Who owns which stream, and the connectors that could carry each',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  responses: {
    200: { description: 'the map', content: json(answered('/streams', object(['streams', 'owner', 'connectors'], { streams: { type: 'array' }, owner: { type: 'object' }, connectors: { type: 'array' } }))) },
    401: NO_SIGN_IN,
    500: FAULT
  }
};
const STREAMS_SET_OPERATION = {
  summary: 'Give a stream to a connector, or leave it unowned (session only)',
  tags: ['integrations'],
  security: [{ bearer: [] }],
  requestBody: { content: json({ type: 'object', description: 'stream → kit id, or null to leave it unowned', additionalProperties: { type: ['string', 'null', 'boolean'] } }) },
  responses: {
    200: { description: 'the new map', content: json(object(['ok', 'owner'], { ok: { type: 'boolean' }, owner: { type: 'object' } })) },
    400: refused('no stream named, or the map was refused'),
    401: NO_SIGN_IN,
    403: refused('a connector cannot reassign its own streams'),
    422: refused('a stream was given something other than a kit id or null'),
    500: FAULT
  }
};
const SKIP_OPERATION = {
  summary: 'Set an order aside from the books, or lift that (session only)',
  tags: ['integrations'],
  security: [{ bearer: [] }],
  requestBody: { content: json({ type: 'object', required: ['chit_id'], properties: { chit_id: CHIT_ID, on: { type: 'boolean' }, why: text } }) },
  responses: {
    200: { description: 'set aside or lifted', content: json(object(['ok', 'skipped'], { ok: { type: 'boolean' }, skipped: { type: 'boolean' } })) },
    400: refused('chit_id is missing or not an id'),
    401: NO_SIGN_IN,
    403: refused('a connector cannot decide this'),
    404: refused('no such order in this shop'),
    500: FAULT
  }
};
const RECONCILE_OPERATION = {
  summary: 'Did what left this account land in the books: one row per order, its state, the counts',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  parameters: [{ name: 'days', in: 'query', required: false, schema: text }],
  responses: {
    200: {
      description: 'the reconciliation',
      content: json(answered('/reconcile', object(['days', 'books_at', 'overdue_hours', 'connector_since', 'counts', 'by_system', 'rows'], { days: { type: 'integer' }, counts: { type: 'object' }, rows: { type: 'array' } })))
    },
    401: NO_SIGN_IN,
    422: refused('days is not valid'),
    500: FAULT
  }
};
const ASK_OPERATION = {
  summary: "Ask the store's connector for fresh stock (public; answered through the bell)",
  tags: ['integrations'],
  parameters: [pathParam('handle')],
  requestBody: { content: json({ type: 'object', properties: { codes: { type: 'array' } } }) },
  responses: {
    200: { description: 'asked · listeners', content: json(object(['asked', 'listeners', 'ask_id', 'note'], { asked: { type: 'boolean' }, listeners: { type: 'integer' }, ask_id: text, note: text })) },
    404: refused('no open storefront by that handle'),
    422: refused('the request is not valid'),
    500: FAULT
  }
};
const STOCK_OPERATION = {
  summary: 'The stamped stock figures of a public storefront',
  tags: ['integrations'],
  parameters: [pathParam('handle')].concat(PAGE_PARAMS),
  responses: {
    200: { description: 'stock', content: json(answered('/stock/:handle', object(['stock', 'total', 'page', 'limit', 'at'], { stock: { type: 'array' }, total: { type: 'integer' }, at: text }))) },
    404: refused('no open storefront by that handle'),
    422: refused('the request is not valid'),
    500: FAULT
  }
};
const PROFILE_MAP_OPERATION = {
  summary: 'What we look for about the store, where it comes from, how trusted — with the current values',
  tags: ['integrations'],
  security: SESSION_OR_KEY,
  responses: {
    200: { description: 'the map', content: json(answered('/profile-map', object(['engine', 'version'], { engine: text, version: { type: 'integer' } }))) },
    401: NO_SIGN_IN,
    500: FAULT
  }
};
const PROFILE_OPERATION = {
  summary: "The connector writes the store's profile from its own system (rung copied; checks may raise it; never below a held rung)",
  tags: ['integrations'],
  security: [{ apiKey: [] }],
  requestBody: { content: json({ type: 'object', required: ['fields'], properties: { source: text, as_of: text, fields: { type: 'object' } } }) },
  responses: {
    200: { description: 'written · kept · the map', content: json(object(['message', 'written', 'kept'], { message: text })) },
    400: refused('no field the profile knows'),
    401: NO_SIGN_IN,
    403: refused('the key is not scoped for connector'),
    500: FAULT
  }
};

/* the answers these routes gave before the standard, kept beside the Problem fields (S2, S14) */
const FAILED_LEGACY = { error: 'Failed', message: SAFE_SENTENCE };
const NOT_FOUND_SAID = 'We could not find that.';
/* a connector kit in the field reads the old 400 body: its schema refusal stays 400 in those words until its next major (S2, S13) */
const KIT_REFUSAL = (message) => ({ status: 400, code: 'INTEGRATION_BAD_REQUEST', legacy: (failures) => ({ error: 'validation', message: message || failures[0].detail }) });
const CHIT_SAID = 'chit_id required';
const PROFILE_FIELDS_SAID = () => 'fields{} required — keys: ' + require('./profile-map').FIELDS.map((item) => item.key).join(', ');

/* the sentences of the refusals these routes keep, word for word (each is a frozen legacy message) */
const SAID = {
  approveKey: 'A key cannot approve itself — sign in.',
  noKey: 'This connector has no key to approve',
  streamsKey: 'a connector cannot reassign its own streams',
  noStream: 'name at least one stream',
  skipKey: 'a connector cannot decide this — sign in'
};

module.exports = { filterFor, KIT_OPERATION, KIT_FILE_OPERATION, DOCS_OPERATION, CATALOGUE_OPERATION, DOWNLOAD_OPERATION, HEARTBEAT_OPERATION, APPROVE_OPERATION, BOOKS_OPERATION, STATUS_OPERATION, STREAMS_OPERATION, STREAMS_SET_OPERATION, SKIP_OPERATION, RECONCILE_OPERATION, ASK_OPERATION, STOCK_OPERATION, PROFILE_MAP_OPERATION, PROFILE_OPERATION, FAILED_LEGACY, NOT_FOUND_SAID, KIT_REFUSAL, CHIT_SAID, PROFILE_FIELDS_SAID, SAID };
