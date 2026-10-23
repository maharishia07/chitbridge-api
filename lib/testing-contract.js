/*
 * OWNS      the contract of the test board's routes (33): routes/testing.js (/api/testing) — each route's OpenAPI operation (S9) and the one way its refusals and faults are worded
 *           (said, badRequest, refused, notFound, tooLarge, notDeployed, notStored, notSignedIn, notBoardWriter, faultOf, bareFaultOf).
 * CALLED BY routes/testing.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...badRequest(...) } | faultOf(...))) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-testing.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...badRequest(error, message) }) → the old { error, message } beside the Problem fields
 *           a thrown error → faultOf(e, req, label) → a 500 that says nothing of its cause, under the label the screen always read
 * CARD      28-platform-and-operations/testing
 * This file shapes NO answer: the cases, results, incidents, requirements, changes and releases are routes/testing.js, lib/testboard.js and lib/junitresults.js, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed (a handler reads every field through String(...) and answers a missing or odd value in its own
 *    sentence, and those sentences are frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep). The one thing a schema refuses is a body that is not an object, or a
 *    query value given twice: answered 400 in the board's own two keys. A malformed id in a path stays what it was (the database refuses the cast: a 500 that says nothing of its cause).
 * ⚠️ The JUnit report travels as the text of `xml` inside a JSON body (routes/testing.js POST /results/junit): its media type is declared on that field, the parser is lib/junitresults.js, untouched.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array, media } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }; the words a person reads are `message`, else `error` */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });

/* ── the words of a refusal ─────────────────────────────────────────────────────────────────────────────── */
/** the request could not be taken: 400 in the board's own two keys */
const badRequest = (error, message) => said('TESTING_BAD_REQUEST', { error, message });
/** the request was understood and the board will not record it as it stands: 422, the old body whole (junit adds its `unmatched` list) */
const refused = (legacy) => said('TESTING_REFUSED', legacy);
/** nothing of that name on the board: 404, the old body whole */
const notFound = (legacy) => said('NOT_FOUND', legacy);
/** a screenshot over the cap: 413 */
const tooLarge = (message) => said('BODY_TOO_LARGE', { error: 'Too large', message });
/** the API shipped without a data folder: a deploy problem, said plainly (500) */
const notDeployed = (error, message) => said('TESTING_NOT_DEPLOYED', { error, message });
/** the named sentences the long refusals of the handlers say, so a handler line stays one line */
const casesNotDeployed = () =>
  notDeployed('The documented cases are not on this server', 'This API was deployed without data/test-cases.json. Run build-test-cases.cjs and deploy again.');
const cmdbNotDeployed = () => notDeployed('The CMDB records are not on this server', 'This API was deployed without data/cmdb/. Deploy again.');
const noWayBack = () =>
  badRequest('No way back', 'How would you undo this? ⚠️ Written before it ships, not after — if the answer is "I am not sure", that is the finding.');
const noCause = () =>
  badRequest('No cause', 'Name the incident or requirement this answers. A change with no cause is either undocumented work or scope creep.');
const unnamedRelease = () => badRequest('Unnamed release', 'Give it a tag — it is what a shop will be told its fix arrived in.');
const emptyRelease = () => badRequest('Nothing in it', 'A release carries changes. One with none is a tag, and a tag tells nobody anything.');
/** the attachment store returned nothing (500) */
const notStored = () => said('TESTING_NOT_STORED', { error: 'Not stored', message: 'The attachment store returned nothing.' });
/** a login that names no entity: 401 */
const notSignedIn = () => said('TESTING_NOT_SIGNED_IN', { error: 'Unauthorised' });
/** the shared board is written by its own account (or TEST_BOARD_WRITERS, or the platform root): 403 with a code the screen branches on */
const notBoardWriter = () =>
  said('NOT_BOARD_WRITER', {
    error: 'Not a writer of the shared board',
    code: 'NOT_BOARD_WRITER',
    message: 'Cases and CMDB records are read by every shop, so only the board’s own account (or one named in TEST_BOARD_WRITERS) can change them.'
  });

/** a fault of ours: the screen's label and the safe sentence, nothing of the cause (the real error is logged with the request id) */
const faultOf = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });
/** the two reads that never carried a message: the label alone */
const bareFaultOf = (e, req, label) => internalSpec(req, e, { error: label });

/** a body the schema refuses is answered 400 in the board's two keys: the first failure's sentence */
const schemaOptions = { status: 400, code: 'TESTING_BAD_REQUEST', legacy: (failures) => ({ error: 'Bad request', message: failures[0].detail }) };
/** every code this file words a refusal under, for the test that each is a register row with its sentence */
const CODES = [
  'TESTING_BAD_REQUEST',
  'TESTING_REFUSED',
  'NOT_FOUND',
  'BODY_TOO_LARGE',
  'TESTING_NOT_DEPLOYED',
  'TESTING_NOT_STORED',
  'TESTING_NOT_SIGNED_IN',
  'NOT_BOARD_WRITER',
  'INTERNAL'
];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const PAGED = ['count', 'total', 'page', 'limit'];
const PAGE_QUERY = ['page', 'limit'];
const WRITER = ['writer'];
const GATE_STATUS = { writer: 403 };
const RESULT_FIELDS = ['case_key', 'status', 'run_kind', 'layer', 'note', 'evidence', 'module_key', 'results', 'run_id', 'run_label', 'build', 'project'];
const FINDING_FIELDS = [
  'observed',
  'severity',
  'affected',
  'ref',
  'case_key',
  'screen_code',
  'popup_code',
  'evidence_id',
  'audience',
  'to_bridge_id',
  'happened_at',
  'build'
];

const ROUTES = {
  'POST /cases/close': {
    summary: "Close a case, or put it back with open:true; a closing says why (the board's writer)",
    gates: WRITER,
    invalid: 400,
    inline: [400, 404],
    body: ['case_key', 'open', 'why'],
    out: object(['case_key', 'status', 'closed'])
  },
  'POST /trace': {
    summary: 'Turn server timings on for the caller for a while, or off now (never another shop)',
    invalid: 400,
    body: ['minutes', 'off'],
    out: object()
  },
  'GET /trace': { summary: "Whether the caller's own calls are being timed, and for how long", out: object() },
  'GET /vocabulary': {
    summary: 'The words the board uses: kinds of run, layers, statuses, test types and what each level means (no sign-in)',
    public: true,
    out: object(['run_kinds', 'layers', 'statuses', 'test_types', 'levels', 'says'])
  },
  'GET /cases': {
    summary: 'Every test case on the board, newest version, one page (closed ones hidden unless all=1)',
    query: ['all'].concat(PAGE_QUERY),
    invalid: 400,
    out: object(['cases'].concat(PAGED), { cases: array() })
  },
  'POST /cases/import': {
    summary: "Add cases to the board, or rebuild it from the whole document (the board's writer)",
    gates: WRITER,
    invalid: 400,
    inline: [400],
    body: ['cases', 'mode'],
    out: object()
  },
  'GET /engine': { summary: 'The declared engine tiers, so a screen can show what the pure rules are', out: object(['engine']) },
  'POST /cases/seed': {
    summary: "Load the documented cases onto the board (an upsert; pressing it twice is safe; the board's writer)",
    gates: WRITER,
    invalid: 400,
    out: object()
  },
  'GET /cmdb': { summary: 'Every CMDB record, one page', query: PAGE_QUERY, invalid: 400, out: object(['records'].concat(PAGED), { records: array() }) },
  'GET /cmdb/:ci': {
    summary: 'One CMDB record as stored (?version=N for an earlier one)',
    query: ['version'],
    invalid: 400,
    inline: [400],
    out: object(['ci', 'version', 'current_version', 'saved_at', 'record', 'flags'])
  },
  'PUT /cmdb/:ci': {
    summary: "Save one CMDB record; a new version only when it changed (the board's writer)",
    gates: WRITER,
    invalid: 400,
    inline: [400],
    body: ['system', 'title', 'source'],
    out: object(['ci', 'flags'])
  },
  'POST /cmdb/seed': {
    summary: "Load every CMDB record shipped with the API (the board's writer)",
    gates: WRITER,
    invalid: 400,
    inline: [400],
    out: object(['seeded', 'unchanged', 'refused'])
  },
  'POST /results': {
    summary: 'Record one result, or a whole run of them (append only; a re-test is a new row)',
    invalid: 400,
    inline: [422],
    body: RESULT_FIELDS,
    out: object(['run_id', 'recorded', 'skipped', 'folded', 'not_on_board', 'results'])
  },
  'GET /results': {
    summary: "The board: the latest word on every case, or one case's or one run's history",
    query: ['case_key', 'run_id', 'project'].concat(PAGE_QUERY),
    invalid: 400,
    inline: [400],
    out: object(['results'].concat(PAGED), { results: array() })
  },
  'GET /runs': {
    summary: 'The sittings, newest first, each with its totals, and the projects the board has seen',
    query: ['project'].concat(PAGE_QUERY),
    invalid: 400,
    inline: [400],
    out: object(['runs', 'projects'].concat(PAGED), { runs: array() })
  },
  'POST /results/junit': {
    summary: 'Record a JUnit XML report from an automated run, through the same recorder as a tap',
    invalid: 400,
    inline: [400, 422],
    body: {
      xml: { contentMediaType: 'application/xml' },
      run_kind: {},
      layer: {},
      key_from: {},
      key_prefix: {},
      run_id: {},
      run_label: {},
      build: {},
      project: {}
    },
    out: object(['unmatched', 'recorded'])
  },
  'GET /cases/gherkin': { summary: 'The board as a .feature file to download', query: ['module'], invalid: 400, media: 'text/plain' },
  'POST /cases/gherkin': {
    summary: "Import a .feature file as spec clauses and cases (the board's writer)",
    gates: WRITER,
    invalid: 400,
    inline: [400, 422],
    body: ['text'],
    out: object()
  },
  'POST /requirements': {
    summary: 'Raise a requirement with the evidence for it; it stays with whoever raised it',
    invalid: 400,
    inline: [400],
    body: ['requirement', 'observed', 'case_key', 'clause', 'spec', 'priority', 'screen_code', 'popup_code', 'audience', 'to_bridge_id'],
    out: object(['raised', 'state', 'support'])
  },
  'GET /requirements': {
    summary: 'The requirements the caller raised, by state (open by default), one page',
    query: ['state'].concat(PAGE_QUERY),
    invalid: 400,
    out: object(['requirements', 'counts', 'open'].concat(PAGED), { requirements: array() })
  },
  'PATCH /requirements/:id': {
    summary: 'Move a requirement to a state, or change only its priority; a rejection says why',
    invalid: 400,
    inline: [400],
    body: ['state', 'why', 'priority'],
    out: object(['ok'])
  },
  'POST /incidents': {
    summary: 'Record an incident: what happened, how bad, when',
    invalid: 400,
    inline: [400],
    body: FINDING_FIELDS,
    out: object(['recorded', 'state', 'support'])
  },
  'GET /incidents': {
    summary: 'The incidents the caller raised, by state (open by default), one page',
    query: ['state'].concat(PAGE_QUERY),
    invalid: 400,
    out: object(['incidents', 'counts', 'open', 'open_by_severity', 'severities', 'means'].concat(PAGED), { incidents: array() })
  },
  'PATCH /incidents/:id': {
    summary: 'Move an incident to a state, re-grade it, or link its defect or change; a resolution says what changed',
    invalid: 400,
    inline: [400],
    body: ['state', 'why', 'severity', 'defect', 'change'],
    out: object(['ok'])
  },
  'POST /evidence': {
    summary: 'Attach a screenshot (png, jpg, gif, webp or bmp, up to 4 MB) and get its id',
    invalid: 400,
    inline: [400, 413],
    body: ['data_base64', 'mime', 'name'],
    out: object(['id', 'name', 'mime', 'size'])
  },
  'GET /stale': { summary: 'Cases written against an earlier wording of the clause they cite', out: object(['stale', 'count', 'says'], { stale: array() }) },
  'GET /coverage': {
    summary: 'What each area has run and what nobody has, with the gap named',
    query: ['run_id', 'project'],
    invalid: 400,
    inline: [400],
    out: object(['areas', 'groups', 'suggest', 'says'])
  },
  'GET /report': {
    summary: "The test completion report: the latest word per case, or one run's own rows",
    query: ['run_id', 'project'],
    invalid: 400,
    inline: [400],
    out: object(['standard', 'names'])
  },
  'GET /reliability': {
    summary: 'How steady each case is across runs: flaky, drifting, settled',
    query: ['run_kind'],
    invalid: 400,
    out: object(['cases', 'totals', 'says'], { cases: array() })
  },
  'POST /changes': {
    summary: 'Record a change with its cause and its way back; a change with neither is refused',
    invalid: 400,
    inline: [400],
    ok: 201,
    body: ['summary', 'backout', 'cites', 'ref', 'repo', 'sha', 'proves'],
    out: object(['ok', 'definition_id', 'ref', 'risk', 'rules', 'forced_risk', 'needs_review'])
  },
  'GET /changes': {
    summary: 'The changes the caller recorded, by state (open by default), with the counts',
    query: ['state'].concat(PAGE_QUERY),
    invalid: 400,
    out: object(['changes', 'counts', 'total', 'page', 'limit'], { changes: array() })
  },
  'POST /releases': {
    summary: 'Cut a release: a tag that carries recorded changes, what a shop is told its fix arrived in',
    invalid: 400,
    inline: [400],
    ok: 201,
    body: ['name', 'changes', 'note'],
    out: object()
  },
  'GET /releases': {
    summary: 'The releases the caller cut, newest first, one page',
    query: PAGE_QUERY,
    invalid: 400,
    out: object(['releases', 'total', 'page', 'limit'], { releases: array() })
  }
};

const contract = contractOf({ mount: '/api/testing', routes: ROUTES, gateStatus: GATE_STATUS });

module.exports = {
  said,
  badRequest,
  refused,
  notFound,
  tooLarge,
  notDeployed,
  casesNotDeployed,
  cmdbNotDeployed,
  noWayBack,
  noCause,
  unnamedRelease,
  emptyRelease,
  notStored,
  notSignedIn,
  notBoardWriter,
  faultOf,
  bareFaultOf,
  schemaOptions,
  CODES,
  contract,
  OPERATIONS: contract.OPERATIONS,
  operationFor: contract.operationFor,
  pathsOf: contract.pathsOf,
  allowedStatuses: contract.allowedStatuses
};
