/*
 * OWNS      the contract of routes/chits-holds.js: GET /holds, GET /my-work, POST /hand-over-all (OpenAPI operations, S9), their seats (register column 14) and the shapes of their answers.
 * CALLED BY routes/chits-holds.js (schemaValidate, the seats) · routes/chits.js (router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · tools/role-matrix-live.cjs
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      01-rail-core-the-chit/assign
 * ASSIGN-NET L11 + L9. GET /holds: what each person holds across the plugs, with counts (partner or manager). POST /hand-over-all: move everything one person holds to another person or back to the pool, through the ONE
 * assign writer (lib/assign-bulk); the answer is assign-bulk's (counts, named skips, previous[] for Undo). GET /my-work: what the caller holds, per plug, newest first (any signed-in person of the shop).
 * CAP-11 entry: functions "see what a person holds", "hand over all a person holds", "my work"; sensitive fields returned: actor ids and names of the shop's own team, chit ids, client entity ids, follow-up ids; NO money, contact or sealed content.
 */
'use strict';
const { contractOf, object, array } = require('./contract-kit');
const { SEATS } = require('./role-matrix');
const { UUID_TEXT } = require('./chits-input');

const PLUG_COUNT = object(['plug', 'count'], { plug: { type: 'string' }, count: { type: 'integer' } }, true);
const SKIPPED = object(['code', 'reason'], { chit_id: UUID_TEXT, followup_id: UUID_TEXT, subject_id: UUID_TEXT, plug: { type: 'string' }, name: { type: 'string' }, code: { type: 'string' }, reason: { type: 'string' } }, true);
const PREVIOUS = object(['plug', 'actor_id'], { chit_id: UUID_TEXT, followup_id: UUID_TEXT, subject_id: { type: ['string', 'null'] }, plug: { type: 'string' }, actor_id: { type: ['string', 'null'] } }, true);
const PERSON = object(['actor_id', 'name', 'total', 'followups', 'plugs'], { actor_id: UUID_TEXT, name: { type: 'string' }, total: { type: 'integer' }, followups: { type: 'integer' }, plugs: array(PLUG_COUNT) }, true);
const WORK_ROW = object(['kind', 'plug', 'subject', 'subject_id', 'status', 'assigned_at'], { kind: { enum: ['chit', 'followup'] }, plug: { type: 'string' }, chit_id: UUID_TEXT, followup_id: UUID_TEXT, subject: { type: ['string', 'null'] }, subject_id: { type: ['string', 'null'] }, status: { type: 'string' }, assigned_at: { type: ['string', 'null'] } }, true);

const ROUTES = {
  'GET /holds': {
    seats: SEATS.OWNER_MANAGER_ONLY,
    summary: 'What each person holds open across the plugs (tasks, clients, follow-ups), with counts; actor_id asks for one person. Partner or manager only',
    gates: [],
    inline: [403, 429],
    query: ['actor_id'],
    out: object(['people'], { people: array(PERSON) }, true)
  },
  'GET /my-work': {
    seats: SEATS.EVERYONE_SIGNED_IN,
    summary: 'What the caller holds open, per plug, newest first, with one count (the same rule as every gate and the Holds column)',
    gates: [],
    inline: [429],
    query: ['limit'],
    out: object(['total', 'plugs', 'rows'], { total: { type: 'integer' }, plugs: array(PLUG_COUNT), rows: array(WORK_ROW) }, true)
  },
  'POST /hand-over-all': {
    seats: SEATS.OWNER_MANAGER_ONLY,
    summary: 'Move everything one person holds open to another person, or back to the pool (to_actor_id null); one answer like assign-bulk: counts, named skips, previous[] for Undo. Partner or manager only',
    gates: [],
    inline: [400, 403, 404, 429],
    body: { from_actor_id: UUID_TEXT, to_actor_id: { oneOf: [UUID_TEXT, { type: 'null' }] }, note: { type: 'string', maxLength: 200 } },
    required: ['from_actor_id'],
    rules: { additionalProperties: false },
    out: object(['message', 'from', 'to', 'moved', 'skipped', 'previous'], { message: { type: 'string' }, from: { type: 'string' }, to: { type: ['string', 'null'] }, moved: { type: 'integer' }, skipped: array(SKIPPED), previous: array(PREVIOUS) }, true)
  }
};

module.exports = Object.assign({ ROUTES }, contractOf({ mount: '/api/chits', routes: ROUTES }));
