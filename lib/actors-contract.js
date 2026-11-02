/*
 * OWNS      the contract of the people routes (17 of the 20): routes/actors.js (/api/actors) — each route's OpenAPI operation (S9) and the one way their refusals and faults are worded
 *           (words, failed, failedBare, EMAIL_TAKEN). The shop's people: add · edit · switch off · PIN and first code · cover and break · tasks and routing · settings.
 * CALLED BY routes/actors.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | failed(e, req, label)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-actors.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old body ({ error, message } · { error, code, message, ... }) beside the Problem fields
 *           a thrown error → failed(e, req, label): a 500 that says nothing of its cause (the real error is logged with the request id)
 * CARD      17-people-employees-hr-and-payroll/functions
 * This file shapes NO answer: the people, their PIN and first code, their breaks, their tasks and the shop's settings are written by the route and the libraries, as before.
 *
 * ⚠️ GET /check-login, POST /set-pin and POST /login are NOT in this contract. They are the sign-in: ALIASES of routes/signin.js handlers (checkLogin, pin, verify), whose own sweep is not done.
 *    They are RUN, not frozen, by tests/api-problem-actors.test.cjs (every scene answers; docs/contracts/api-legacy.json has no key for them, so CI compares none of their bodies) and never edited here.
 * ⚠️ AUTH AREA. PUT /change-pin, POST /:id/otp, DELETE /:id/pin, POST / (the first code) and PUT /:id/status (switch on) are the sign-in side of this file. Their refusals only gain the Problem fields;
 *    the PIN engine, the first-code library, the dev code door, the lock counters and the token are the libraries', and no line of them is read or changed here.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing typed. Where the express-validator chain already refused an omission with 400 "Validation failed", the field is `required` (the chain
 *    answers first, so nothing new is refused); every other missing or odd value is answered in the handler's own sentence, frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep.
 *    The one thing a schema adds is the refusal of a body that is not an object (a list), or a page asked twice: 400 in the chains' own body ({ error: "Validation failed", details }).
 *    POST /:id/otp reads no body at all and keeps accepting any, as before.
 * ⚠️ THREE ROUTES DO SEVERAL JOBS ON ONE FIELD (MODE_SWITCHES below): flagged, not split. A change of that shape is the next major version of the route, not this sweep.
 */
'use strict';
const { contractOf, object, any } = require('./contract-kit');
const { said, failed } = require('./products-contract');
const { internalSpec } = require('./problem');
const { refusalFor } = require('./storefront-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** PEOPLE-EMAIL (SEC2): identities.email is UNIQUE across every sign-in, so the owner's own address on a staff row collides. Said in words with a code — never "Key taken", never a 500. */
const EMAIL_TAKEN = {
  error: 'E-mail in use',
  code: 'EMAIL_TAKEN',
  message: "That e-mail already signs in to another account. Use the person's own e-mail, or leave it empty."
};
const POOL_OR_COLLEAGUE = 'Send task_action: pool (return to entity) or actor (pass to colleague)';
const notFoundWith = (legacy) => said('NOT_FOUND', legacy);

/** a 5xx that never had a `message` key (the tasks list, the task route): the screen's label alone */
const failedBare = (e, req, label) => internalSpec(req, e, { error: label });

const words = {
  /* add / edit */
  overTaskCap: (ceiling) =>
    said('MAX_TASKS_OVER_ENTITY', {
      error: 'Over the limit',
      code: 'MAX_TASKS_OVER_ENTITY',
      message: `A person can hold at most ${ceiling} tasks, the limit you set in Settings › Work. Raise that first, or give them ${ceiling} or fewer.`
    }),
  keyTaken: (key, handle) => said('ACTOR_KEY_TAKEN', { error: 'Key taken', message: `${key}@${handle} is already taken`, login_format: `${key}@${handle}` }),
  keyHeld: () =>
    said('ACTOR_KEY_TAKEN', {
      error: 'Key taken',
      message: 'That key already belongs to someone at this entity — including people who have been removed, because their name stays on the work they recorded. Choose another.'
    }),
  emailTaken: () => said('EMAIL_TAKEN', EMAIL_TAKEN),
  /* the first-code library's own refusal ({ status, body }), carried whole: its status, its code, its words */
  fromLibrary: (refused) => ({ status: refused.status, code: refused.body.code, detail: refused.body.message, legacy: refused.body }),
  coAssistGone: () => notFoundWith({ error: 'Not found', message: 'Co-assist not found' }),
  costsOwnerOnly: () => said('OWNER_ONLY', { error: 'Forbidden', message: 'Only the account owner can change who sees costs and margin.' }),
  nothingToUpdate: () => said('NOTHING_TO_UPDATE', { error: 'Nothing to update', message: 'Provide display_name, actor_role, phone, email, max_tasks, hat, or can_see_costs' }),
  /* PIN */
  onlyActorsChangePin: () => said('PIN_ACTORS_ONLY', { error: 'Only actors can change PIN' }),
  actorGone: () => notFoundWith({ error: 'Actor not found' }),
  noPinSet: () => said('NO_PIN_SET', { error: 'No PIN set', message: 'Set your PIN first via login' }),
  pinIncorrect: () => said('PIN_INCORRECT', { error: 'Incorrect PIN', message: 'Current PIN is incorrect' }),
  actorGoneInWords: () => notFoundWith({ error: 'Not found', message: 'Actor not found' }),
  /* switch off / remove / switch on */
  notFound: () => notFoundWith({ error: 'Not found' }),
  confirmRemove: (open) =>
    said('CONFIRM_REMOVE', {
      error: 'Confirmation required',
      code: 'CONFIRM_REMOVE' /* PEOPLE-SRV1: the screen asks "Remove?" on this code, never on the words */,
      message: 'Send confirm: REMOVE to permanently remove this actor',
      tasks_warning: open > 0 ? `Actor has ${open} active tasks — route them first` : null
    }),
  tasksToRoute: (open) =>
    said('TASKS_TO_ROUTE', {
      error: 'Tasks must be routed',
      code: 'TASKS_TO_ROUTE',
      message: `Actor has ${open} active tasks`,
      required: POOL_OR_COLLEAGUE,
      actor_tasks: open
    }),
  targetRequired: () => said('TARGET_ACTOR_REQUIRED', { error: 'Target actor required' }),
  targetNotActive: () => said('TARGET_ACTOR_NOT_ACTIVE', { error: 'Target actor not found or not active' }),
  /* break / leave */
  nameThePerson: () => said('NAME_THE_PERSON', { error: 'Name the person', code: 'NAME_THE_PERSON', message: 'Say who is away — pick the person.' }),
  notInYourShop: () => notFoundWith({ error: 'Not found', code: 'NOT_FOUND', message: 'That person is not in your shop.' }),
  switchedOff: (name) => said('SWITCHED_OFF', { error: 'Switched off', code: 'SWITCHED_OFF', message: name + ' is switched off. Switch them on first.' }),
  coverConflict: (message) => said('COVER_CONFLICT', { error: 'Cover conflict', code: 'COVER_CONFLICT', message }),
  routeTasksFirst: (name, verb, open) =>
    said('TASKS_TO_ROUTE', { error: 'Route tasks first', code: 'TASKS_TO_ROUTE', message: `${name} ${verb} ${open} active tasks`, required: POOL_OR_COLLEAGUE, task_count: open }),
  /* assign */
  chitNotFound: () => notFoundWith({ error: 'Chit not found' }),
  alreadyAssigned: (name) => said('ALREADY_ASSIGNED', { error: 'Already assigned', message: `Already assigned to ${name}` }),
  pushNeedsTarget: () => said('TARGET_ACTOR_REQUIRED', { error: 'target_actor_id required for push' }),
  /* settings / cover */
  badDefaultAssignee: () => said('INVALID_ASSIGNEE', { error: 'Invalid default assignee', message: 'The default assignee must be an Act or Manager co-assist of this entity.' }),
  delegateSelf: () => said('INVALID_DELEGATE', { error: 'Invalid delegate', message: 'An actor cannot delegate to themselves.' }),
  delegateNotAssignable: () => said('INVALID_DELEGATE', { error: 'Invalid delegate', message: 'The delegate must be an Act or Manager co-assist of this entity.' }),
  delegatorGone: () => notFoundWith({ error: 'Not found', message: 'Co-assist not found.' }),
  /* tasks */
  tasksActorGone: () => notFoundWith({ error: 'Actor not found', message: 'Co-assist not found under your entity' }),
  routeNeedsBoth: () => said('CHIT_AND_ACTION_REQUIRED', { error: 'chit_id and action required' }),
  taskNotFound: () => notFoundWith({ error: 'Task not found' }),
  invalidAction: () => said('INVALID_ACTION', { error: 'Invalid action' })
};

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = [
  'INTERNAL', 'INVALID_INPUT', 'NOT_FOUND', 'OWNER_ONLY', 'MAX_TASKS_OVER_ENTITY', 'ACTOR_KEY_TAKEN', 'EMAIL_TAKEN', 'EMAIL_DELIVERY_NOT_CONFIGURED', 'EMPLOYEE_EMAIL_REQUIRED', 'CODE_ISSUE_LIMIT', 'CODE_SHOW_NOT_READY', 'NOTHING_TO_UPDATE',
  'PIN_ACTORS_ONLY', 'NO_PIN_SET', 'PIN_INCORRECT', 'CONFIRM_REMOVE', 'TASKS_TO_ROUTE', 'TARGET_ACTOR_REQUIRED', 'TARGET_ACTOR_NOT_ACTIVE', 'NAME_THE_PERSON', 'SWITCHED_OFF', 'COVER_CONFLICT',
  'ALREADY_ASSIGNED', 'INVALID_ASSIGNEE', 'INVALID_DELEGATE', 'CHIT_AND_ACTION_REQUIRED', 'INVALID_ACTION'
];

/** the three routes that do several jobs on one field (PM/ENDPOINT-USAGE-2026-10-23 §5 part 3): flagged here and in the PR, not split */
const MODE_SWITCHES = {
  'PUT /:id/status': 'action: remove, reactivate (mints a new first code) or deactivate',
  'PUT /assign/:chit_id': 'action: pull, push or return',
  'PUT /:id/tasks/route': 'action: pool or push'
};

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { owner: 403 };
const OWNER = ['owner'];
/** the refusals the first-code library raises beyond a row's own statuses (lib/employee-code: a sealed shop with no sender; R112: the show path and the issue limiter) */
const FIRST_CODE = [
  { status: 503, code: 'EMAIL_DELIVERY_NOT_CONFIGURED', when: 'the shop is sealed and has no e-mail sender set up, so a first code cannot be delivered; nothing is changed' },
  { status: 503, code: 'CODE_SHOW_NOT_READY', when: 'the shop is sealed, the person has no e-mail and the hashed code store (b781) is not there yet, so the code cannot be shown; nothing is changed' },
  { status: 429, code: 'CODE_ISSUE_LIMIT', when: 'five codes were already made for this person in the last 15 minutes; nothing is changed' }
];
/* PPL-26 (BH-12): the KIND of each value, for the fields the chains let a list or an object through (express-validator checks a list element by element, so `[]` passed every chain and reached the database).
   A number is a number and a flag a flag (the web sends them so); the chains keep their own ranges and words. */
const KINDS = {
  word: { type: 'string' },
  maybeWord: { type: ['string', 'null'] },
  whole: { type: 'integer' },
  flag: { type: 'boolean' }
};
const ACTION_NOTE = ' (a mode switch: several jobs on one field, flagged not split)';

const ROUTES = {
  'POST /suggest-key': { summary: 'Suggest a login key from a name (ravik) and say whether it is free', invalid: 400, body: { display_name: KINDS.word }, required: ['display_name'], out: object(['suggested_key', 'available', 'login_format', 'alternatives']) },
  'POST /check-key': { summary: 'Say whether a chosen login key is free (4 to 12 lowercase letters and digits)', invalid: 400, body: { actor_key: KINDS.word }, required: ['actor_key'], out: object(['actor_key', 'available', 'login_format', 'message']) },
  'POST /': {
    summary: 'Add a person: their login key, access and first sign-in code (the owner alone)',
    gates: OWNER,
    invalid: 400,
    inline: [409],
    body: { display_name: KINDS.word, email: KINDS.maybeWord, actor_key: KINDS.word, actor_role: KINDS.maybeWord, phone: KINDS.maybeWord, max_tasks: KINDS.whole, hat: KINDS.word, access_level: KINDS.word, whole_entity: KINDS.flag },
    required: ['display_name', 'actor_key'],
    refusals: FIRST_CODE,
    out: object(['message', 'actor', 'login_instruction'])
  },
  'PATCH /:id': {
    summary: "Change a person's name, role, phone, e-mail, task limit or access (the owner alone); each access change goes on the trail",
    gates: OWNER,
    invalid: 400,
    inline: [403, 409],
    body: { display_name: KINDS.word, actor_role: KINDS.maybeWord, phone: KINDS.maybeWord, max_tasks: KINDS.whole, hat: KINDS.word, access_level: KINDS.word, whole_entity: KINDS.flag, email: KINDS.maybeWord, can_see_costs: KINDS.flag, reason: KINDS.maybeWord },
    out: object(['message', 'actor', 'audit'])
  },
  'PUT /change-pin': {
    summary: 'A person changes their own PIN (the current one, then the new one twice)',
    invalid: 400,
    inline: [404],
    body: ['current_pin', 'new_pin', 'confirm_pin'],
    required: ['current_pin', 'new_pin', 'confirm_pin'],
    out: object(['message'])
  },
  'DELETE /:id/pin': { summary: "Clear a person's PIN and issue a new first code, so they set a new PIN at their next sign-in (the owner alone)", gates: OWNER, invalid: 400, refusals: FIRST_CODE, out: object(['message', 'actor_name', 'login_format']) },
  'GET /': { summary: "The shop's people, one page, with who is active, away, switched off or removed (?status= ?type=)", out: object(['actors', 'total', 'page', 'limit', 'summary'], { actors: { type: 'array' } }) },
  'POST /:id/otp': { summary: 'Give a person a new first sign-in code (the owner alone)', gates: OWNER, invalid: 400, list: true, body: [], refusals: FIRST_CODE, out: object(['message', 'actor_name', 'login_format', 'expires_in']) },
  'PUT /:id/status': {
    summary: 'Switch a person off, remove them or switch them back on (the owner alone); their open tasks go to the pool or a colleague, their phones and keys are signed out' + ACTION_NOTE,
    gates: OWNER,
    invalid: 400,
    body: { action: { enum: ['deactivate', 'remove', 'reactivate'] }, task_action: { enum: ['pool', 'actor'] }, target_actor_id: any, return_date: any, confirm: any },
    required: ['action'],
    refusals: FIRST_CODE,
    out: object(['message'])
  },
  'PUT /break': {
    summary: 'A person goes on a short break or leave, or comes back; the owner may name the person (actor_id)',
    invalid: 400,
    inline: [403],
    refusals: [{ status: 404, code: 'NOT_FOUND', when: 'the person the owner names is not one of this shop’s people (or was removed)' }],
    body: { break_type: { enum: ['short_break', 'leave', 'end_break'] }, task_action: { enum: ['hold', 'pool', 'actor'] }, target_actor_id: any, actor_id: any },
    required: ['break_type'],
    out: object(['message', 'actor_id', 'state', 'audit'])
  },
  'PUT /assign/:chit_id': {
    summary: 'Take a task, hand it to someone or give it back to the pool' + ACTION_NOTE,
    invalid: 400,
    body: { action: { enum: ['pull', 'push', 'return'] }, target_actor_id: any },
    required: ['action'],
    out: object(['message', 'action'])
  },
  'GET /settings': { summary: "The shop's rules for who takes tasks: model, task limit, auto-assign (made with its defaults the first time)", out: object(['settings']) },
  'PUT /settings': {
    summary: "Change the shop's rules for who takes tasks (the owner alone)",
    gates: OWNER,
    invalid: 400,
    body: { assignment_model: KINDS.word, default_max_tasks: KINDS.whole, all_task_visible: KINDS.flag, auto_return_on_short_break: KINDS.flag, auto_assign_mode: KINDS.word, default_assignee_actor_id: KINDS.maybeWord },
    out: object(['message', 'settings'])
  },
  'PUT /:id/delegate': { summary: "Name who covers a person's auto-assigned work while they are on leave, or clear it (the owner alone)", gates: OWNER, invalid: 400, body: { delegate_actor_id: KINDS.maybeWord }, out: object(['message', 'actor']) },
  'GET /:id/tasks': { summary: "The open tasks a person holds, one page, with the person's load", invalid: 400, query: ['page', 'limit'], out: object(['tasks', 'total', 'page', 'limit', 'actor', 'count'], { tasks: { type: 'array' } }) },
  'PUT /:id/tasks/route': {
    summary: 'Take one task from a person: back to the pool or on to a colleague (the owner alone)' + ACTION_NOTE,
    gates: OWNER,
    invalid: 400,
    body: ['chit_id', 'action', 'to_actor_id'],
    out: object(['message'])
  },
  'GET /access-events': { summary: 'The trail of who changed whose access, newest first (?subject= one person); an empty list, applied: false, before the table exists', out: object(['events', 'total', 'page', 'limit', 'applied'], { events: { type: 'array' } }) }
};

/**
 * SEC-116: the keys of a connector's connector_config that the people LIST may show to any signed-in colleague (the connector card reads adapter, version, host, kit_id, counters; the ERP shape
 * adds base_url and auth_type). Everything else stays with the owner: auth_ref and any extra key the owner typed can be a token or a password, key_jti and enrol name the kit's credential.
 */
const CONNECTOR_CONFIG_SHOWN = ['adapter', 'version', 'host', 'kit', 'kit_id', 'counters', 'mode', 'base_url', 'auth_type'];
/** a connector_config cut to the shown keys; anything that is not a plain object is nothing */
function shownConnectorConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  return Object.fromEntries(CONNECTOR_CONFIG_SHOWN.filter((key) => key in config).map((key) => [key, config[key]]));
}

/** SEC-116: a row of GET /api/actors as any colleague may read it: its connector_config cut to the shown keys */
const listedActor = (row) => Object.assign(row, { connector_config: shownConnectorConfig(row.connector_config) });

/** the contract of this area, of the kit's making */
const actors = contractOf({ mount: '/api/actors', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-actors-refusals' });
const OPERATIONS = actors.OPERATIONS;

/** the schema's own refusal, in the shape these routes' chains always refused in: a body that is not an object, or a page asked twice, is the chains' 400 "Validation failed" body */
const schemaOptions = refusalFor([]);

module.exports = { CONNECTOR_CONFIG_SHOWN, shownConnectorConfig, listedActor, words, failed, failedBare, EMAIL_TAKEN, CODES, MODE_SWITCHES, schemaOptions, OPERATIONS, ROUTES, actors, allowedStatuses: actors.allowedStatuses };
