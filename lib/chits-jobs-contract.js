/*
 * OWNS      the contract of routes/chits-jobs.js: the opener's OpenAPI operation (S9), its seats (register column 14) and the words of its skips.
 * CALLED BY routes/chits-jobs.js (schemaValidate, the seats) · routes/chits.js (router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · tools/role-matrix-live.cjs
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      01-rail-core-the-chit/assign
 * ASSIGN-1: POST /api/chits/jobs/open opens one job chit per client (purpose general, business_json.job) through the EXISTING send path. It holds no business rule of its own (lib/jobs-open does the work);
 * who may open is the partner or a manager (lib/owner mayAt), declared here as the seats: owner allow · staff `manager` · adviser deny · auditor deny.
 * CAP-11 entry: function "open jobs for a set of subjects"; actions `open` (send one job chit per subject) and `assign` (the auto door places the holder by the business's mode); sensitive fields returned: subject ids
 * (client entity ids) and chit ids; NO holder, name, contact or money.
 */
'use strict';
const { contractOf, object, array } = require('./contract-kit');
const { SEATS } = require('./role-matrix');
const { UUID_TEXT } = require('./chits-input');
const register = require('./assign-register');

const ROLES = [...new Set(register.OPENERS.flatMap((name) => register.REGISTER[name].roles))];
const PERIOD = { type: 'string', minLength: 1, maxLength: 24, pattern: '^[\x21-\x7e\u00a0-\uffff](?:[\x20-\x7e\u00a0-\uffff]*[\x21-\x7e\u00a0-\uffff])?$', examples: ['standing'] }; /* trimmed, one line, no control character */
const FILTER = { type: 'object', additionalProperties: false, required: ['list'], properties: { list: { enum: ['practice'] }, without_job: { type: 'boolean' }, q: { type: 'string', minLength: 1, maxLength: 80 } } };
const BODY = {
  plug: { type: 'string', enum: register.OPENERS.slice() },
  role: { type: 'string', minLength: 1, maxLength: 40, enum: ROLES },
  period: PERIOD,
  subject_ids: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: UUID_TEXT },
  filter: FILTER
};
const SKIPPED = { type: 'object', additionalProperties: false, required: ['subject_id', 'code', 'reason'], properties: { subject_id: UUID_TEXT, code: { type: 'string' }, reason: { type: 'string' } } };
const JOB = { type: 'object', additionalProperties: false, required: ['subject_id', 'chit_id', 'outcome'], properties: { subject_id: UUID_TEXT, chit_id: UUID_TEXT, outcome: { enum: ['opened', 'existing'] } } };

const ROUTES = {
  'POST /jobs/open': {
    seats: SEATS.OWNER_MANAGER_ONLY,
    summary: 'Open one job chit per client (a set of up to 200, named by list or by filter) and place each holder by the business\'s own assignment mode; a repeat opens nothing twice. Partner or manager only',
    gates: [],
    inline: [400, 403, 429],
    body: BODY,
    required: ['plug', 'role', 'period'],
    rules: { additionalProperties: false, oneOf: [{ required: ['subject_ids'] }, { required: ['filter'] }] },
    out: object(['opened', 'existing', 'assigned', 'skipped', 'jobs'], { opened: { type: 'integer' }, existing: { type: 'integer' }, assigned: { type: 'integer' }, skipped: array(SKIPPED), jobs: array(JOB) }, true)
  }
};

module.exports = Object.assign({ ROUTES, ROLES }, contractOf({ mount: '/api/chits', routes: ROUTES }));
