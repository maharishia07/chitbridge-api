/*
 * OWNS      the contract of routes/assist.js (22 routes, /api/assist — CB Assist and the brand's catalogue-source authoring): each route's OpenAPI operation (S9) and the one way its refusals
 *           and faults are worded (the words, failed, FAULTS, PUBLISH_NO).
 * CALLED BY routes/assist.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | failed(e, req, FAULTS.x))) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-assist.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) → the old body ({ error, message } · { ok: false, error[, code] }) beside the Problem fields
 *           a thrown error → failed(e, req, FAULTS.x) → a 500 that says nothing of its cause, in the route's own two keys
 * CARD      28-platform-and-operations/assist
 * This file shapes NO answer: the model call (lib/ai.js), the grounding, the catalogue versions, the regional resolve-and-seal and the commercials are the libraries', as before.
 *
 * ⚠️ THE ASSISTANT'S NON-200s ARE ITS CONTRACT. POST /api/assist answers 503 { error: 'assist_unavailable' } (not configured · ASSIST_SIGN_IN · ASSIST_GATED) and 502 so the web client
 *    (askLLM) falls through to its own library floor. Every status, `error` word, `code` and sentence is kept; a refusal only gains the Problem fields.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed. A body may be a list (the handler answers it in its own 422 sentence, as before), and a query value
 *    is declared as anything (a repeated key is read as it always was), so the schema check refuses nothing the assistant ever took. A path argument is plain text.
 * ⚠️ A legacy `code` key is kept: the Problem's `code` is that same word where the old body had one (ASSIST_SIGN_IN, ASSIST_GATED, *_STORE_MISSING, NO_COUNTRY).
 * ⚠️ The two library sentences of PUT /container and PUT /region-override ride in `error`: they are fixed words of lib/container.js and lib/regional.js (a database error carries no status).
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object } = require('./contract-kit');

/** the old body of a refusal as the parts problem() takes: { code, detail, legacy }. The detail is the sentence the body carried (its message, else its error word). */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });

/** the one sentence for "you may not publish": POST /publish's 403 and GET /whoami's actions.publish say the same */
const PUBLISH_NO = 'Only a help desk can publish to its catalogue.';

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const BAD_REQUEST = 'ASSIST_BAD_REQUEST';
const NOT_OWNER = 'ASSIST_NOT_OWNER';
const UNAVAILABLE = 'assist_unavailable';
const askRefused = (message) => said(BAD_REQUEST, { error: 'Bad request', message });
const plain = (error) => said(BAD_REQUEST, { ok: false, error });
const notFound = (error, more) => said('NOT_FOUND', Object.assign({ ok: false, error }, more));
/** a store that a migration has not made yet: the old three keys, the code the screens map to their own line */
const storeMissing = (code, error) => said(code, { ok: false, code, error });

const words = {
  askNothing: () => askRefused('Ask a question.'),
  askTooLong: () => askRefused('Question is too long.'),
  assistOff: () => said('ASSIST_NOT_CONFIGURED', { error: UNAVAILABLE, message: 'The assistant model is not configured yet.' }),
  assistSignIn: () => said('ASSIST_SIGN_IN', { error: UNAVAILABLE, code: 'ASSIST_SIGN_IN', message: 'Sign in for fuller answers.' }),
  assistGated: () => said('ASSIST_GATED', { error: UNAVAILABLE, code: 'ASSIST_GATED', message: 'The assistant is resting — the help library answers.' }),
  assistEmpty: () => said('ASSIST_NO_ANSWER', { error: 'Assistant error', message: 'No answer produced — try again.' }),
  assistBusy: () => said('ASSIST_UPSTREAM', { error: 'Assistant upstream error', message: 'The assistant is busy — please try again.' }),
  standardNeeded: () => plain('Name the standard to check against.'),
  unknownStandard: (available) => notFound('Unknown standard.', { available }),
  unknownCatalogueSource: (available) => notFound('Unknown catalogue source.', available === undefined ? undefined : { available }),
  unknownSource: () => notFound('Unknown source.'),
  unknownContainerOrVersion: () => notFound('Unknown container or version.'),
  /** a library's own refusal of a container: its fixed sentence, in the old key */
  noSuchContainer: (sentence) => notFound(sentence),
  ownedByAnother: (sentence) => said(NOT_OWNER, { ok: false, error: sentence }),
  sourceOfAnother: () => said(NOT_OWNER, { ok: false, error: 'This source is owned by another brand.' }),
  sourceOfThePlatform: () => said(NOT_OWNER, { ok: false, error: 'This source belongs to the platform.' }),
  sourceKeyNeeded: () => plain('source_key is required (e.g. royale-play@v1)'),
  containerIdNeeded: () => plain('container_id is required (e.g. royaleplay/tussar)'),
  containerAndRegionNeeded: () => plain('container_id and region are required'),
  regionNeeded: () => Object.assign(said('NO_COUNTRY', { ok: false, code: 'NO_COUNTRY', error: 'Name the region (?region=AU) — a product is resolved for the region you say, never a guessed one.' }), { hint: 'Add ?region= to the request, for example ?region=AU.' }),
  catalogueStoreMissing: () => storeMissing('CATALOGUE_STORE_MISSING', 'Catalogue persistence not enabled yet — apply migration b75.'),
  sourceStoreMissing: () => storeMissing('SOURCE_STORE_MISSING', 'Source authoring not enabled yet — apply migration b78.'),
  containerStoreMissing: () => storeMissing('CONTAINER_STORE_MISSING', 'Container model not enabled yet — apply migration b80.'),
  handoffStoreMissing: () => storeMissing('HANDOFF_STORE_MISSING', 'ERP handoff not enabled yet — apply migration b82.'),
  regionStoreMissing: () => storeMissing('REGION_STORE_MISSING', 'Regional scatter not enabled yet — apply migration b81.'),
  penetrationStoreMissing: () => storeMissing('PENETRATION_STORE_MISSING', 'Penetration not enabled yet — apply migration b79.'),
  questionNeeded: () => plain('Ask a question.'),
  questionTooLong: () => plain('Question is too long.'),
  answerNeeded: () => plain('question and answer are required.'),
  notAHelpDesk: () => said('ASSIST_NOT_HELPDESK', { ok: false, error: PUBLISH_NO, why: 'not_helpdesk' }),
  reviewRetired: () => said('ASSIST_REVIEW_RETIRED', { ok: false, deprecated: true, error: 'Gap review is superseded — answer the question on its chit (Task inbox), then Publish to the KB.' })
};

/** the 500 body of each route's own two keys: the screen's label (or the safe sentence) and nothing of the cause */
const FAULTS = {
  assistant: { error: 'Assistant error', message: SAFE_SENTENCE },
  plain: { ok: false, error: SAFE_SENTENCE },
  questions: { ok: false, error: 'Could not load assistant questions.' },
  gap: { ok: false, error: 'Could not note the question.' },
  publish: { ok: false, error: 'Could not publish.' }
};
/** a 500 that says nothing of its cause (the real error is logged with the request id); `legacy` is one of FAULTS */
const failed = (e, req, legacy) => internalSpec(req, e, legacy);

/** every code the words answer under, for the test that each is a register row with its sentence written */
const CODES = [
  BAD_REQUEST, NOT_OWNER, 'ASSIST_NOT_CONFIGURED', 'ASSIST_SIGN_IN', 'ASSIST_GATED', 'ASSIST_NO_ANSWER', 'ASSIST_UPSTREAM', 'ASSIST_NOT_HELPDESK', 'ASSIST_REVIEW_RETIRED', 'NOT_FOUND', 'NO_COUNTRY',
  'CATALOGUE_STORE_MISSING', 'SOURCE_STORE_MISSING', 'CONTAINER_STORE_MISSING', 'HANDOFF_STORE_MISSING', 'REGION_STORE_MISSING', 'PENETRATION_STORE_MISSING', 'INTERNAL'
];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const LIMITED = [{ status: 429, when: 'too many questions in a quarter of an hour: the limiter answers { error, message } before the handler runs, and the client falls through to its library' }];
const PAGE = ['page', 'limit'];

const ROUTES = {
  'POST /': { summary: "Ask the assistant (the model's answer, grounded on the public help); a 503 or 502 tells the client to answer from its own library", public: true, list: true, inline: [503, 502], refusals: LIMITED, body: ['q', 'context', 'stage'], out: object(['answer']) },
  'POST /conform': { summary: 'Check a payload against a standard: the verdict is rule-made, a model adds a narrative only when one is configured', public: true, list: true, inline: [404], body: ['standard', 'payload'], out: object(['ok', 'narrative', 'acted_by']) },
  'GET /standards': { summary: 'The standards a payload can be checked against', public: true, out: object(['ok', 'data']) },
  'GET /catalogue-sources': { summary: 'The catalogue sources the assistant can structure', public: true, out: object(['ok', 'data']) },
  'POST /catalogue-structure': { summary: 'The structured proposal of a catalogue source (schema and coloured items), with a model-drafted intro when one is configured; nothing is saved', public: true, list: true, inline: [404], body: ['source'], out: object(['ok', 'finishes', 'intro', 'acted_by']) },
  'POST /catalogue-adopt': { summary: "Adopt a catalogue source: the reference, the version and the shop's prices; no copy of the design", list: true, inline: [404, 503], body: ['source', 'commercials', 'visible'], out: object(['ok', 'persisted', 'source', 'resolved', 'acted_by']) },
  'GET /catalogue-mine': { summary: "The shop's adopted catalogues, resolved against their sources, with its prices", lenient: true, query: PAGE, inline: [503], out: object(['ok', 'count', 'catalogues']) },
  'PUT /catalogue-source': { summary: 'A brand authors or updates its own catalogue source (the owner; the platform root for a platform seed)', list: true, inline: [403, 503], body: ['source_key', 'version', 'for_vertical', 'title', 'collection', 'schema', 'items', 'commercials_fields', 'experience', 'formatting'], out: object(['ok', 'source_key', 'owner_entity_id', 'authored', 'containers']) },
  'PUT /container': { summary: 'Author a product container, or mint its next immutable version (the owner only)', list: true, inline: [403, 503], body: ['container_id', 'name', 'source_key', 'content', 'schema', 'schema_version'], out: object(['ok', 'owner_entity_id']) },
  'GET /container/:id': { summary: 'A product container at its current version, or at ?version= (public reference)', public: true, lenient: true, query: ['version'], out: object(['ok']) },
  'GET /erp-handoffs': { summary: "The shop's ERP handoff receipts", lenient: true, query: PAGE, inline: [503], out: object(['ok', 'count', 'handoffs']) },
  'PUT /region-override': { summary: "A brand sets a region's override on its own container", list: true, inline: [403, 404, 503], body: ['container_id', 'region', 'overrides'], out: object(['ok', 'container_id', 'region']) },
  'GET /regions': { summary: 'The region layers: currency, units, language and jurisdiction', public: true, out: object(['ok', 'regions']) },
  'GET /resolve': { summary: 'A product resolved for a region the caller names (?container=&version=&region=); never a guessed region', public: true, lenient: true, invalid: 400, inline: [400, 404], query: ['container', 'version', 'region'], out: object(['ok']) },
  'GET /penetration': { summary: 'Orders and distributor coverage by locality, for the sources the brand owns (counts only)', inline: [503], out: object(['ok', 'total_orders', 'localities', 'by_locality']) },
  'GET /catalogue-source/:key': { summary: 'A catalogue source: its content, experience and formatting (public reference)', public: true, out: object(['ok', 'finishes']) },
  'GET /questions': { summary: "The assistant's question and answer library, for a screen (?context=a,b); public", public: true, lenient: true, query: ['context', ...PAGE], out: object(['ok', 'data']) },
  'POST /gap': { summary: 'Note a question the assistant could not answer (it only logs; the help desk gets it as a chit)', public: true, list: true, body: ['q', 'context'], out: object(['ok', 'noted', 'via']) },
  'POST /publish': { summary: "A help desk publishes a question and answer to its own catalogue (served live)", list: true, inline: [403], body: ['question', 'answer', 'context', 'qa_id'], out: object(['ok', 'qa_id']) },
  'GET /gaps': { summary: 'Retired: the gap queue is empty (questions arrive as chits in the help desk)', out: object(['ok', 'data', 'deprecated']) },
  'POST /resolve': { summary: 'Retired: answering a gap is done on its chit, then published; always 410', list: true, inline: [410], body: [], out: object(['ok', 'deprecated']) },
  'GET /whoami': { summary: 'Is this shop a help desk, and may it publish', out: object(['ok', 'is_helpdesk', 'actions']) }
};

const contract = contractOf({ mount: '/api/assist', routes: ROUTES, extension: 'x-assist-refusals' });

module.exports = Object.assign({ words, said, failed, FAULTS, PUBLISH_NO, CODES, ROUTES }, contract);
