/*
 * OWNS      the contract of routes/entities.js (23 of its 25 routes, /api/entities — the shop itself: the public vertical list, search and lookup, the profile, policy, the person's preferences,
 *           routing, the platform's populations, the platform report, erasure): each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (the words, failed, policyFault).
 * CALLED BY routes/entities.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | failed(e, req, label) | policyFault(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-entities.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old body ({ error, message } · { error, code, message }) beside the Problem fields
 *           a thrown error → failed(e, req, label) | policyFault(e, req): the refusal the library meant (its own status and words) or a 500 that says nothing of its cause
 * CARD      28-platform-and-operations/entities-routes
 * Reuses lib/products-contract.js (said · failed: the one way to word a refusal and a fault), lib/storefront-contract.js (refusalFor: the chain's "Validation failed" body),
 * lib/exposure.js (KEYS) and lib/owner.js (the owner sentence and code). This file shapes NO answer: the profile, the policy, the routing and the
 * populations are written by the route and the libraries, as before.
 *
 * ⚠️ POST /register and POST /verify are NOT in this contract. They are the sign-in: their checks are routes/signin.js's express-validator chains and its own handlers, whose refusals are that file's
 *    sweep. Only registerNew's three refusals (the User ID is unusable or taken, the sign-up failed) are worded here; every success body, status, code, rate limit and header of sign-in is untouched.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. A handler answers a missing or odd value in its own sentence, and those sentences are frozen
 *    in docs/contracts/api-legacy.json, recorded from the code before the sweep. The one thing a schema refuses is a body that is not an object (a list): answered 400 in the chain's own body
 *    ({ error: "Validation failed", details }). A query value is NOT declared (the routes read it leniently, a repeated one included), so none is refused; a path argument is plain text.
 * ⚠️ A legacy `code` key is kept: the Problem's `code` is that same word where the old body had one (USER_ID_*, CURRENCY_*, OWNER_ONLY, VISIBILITY_NOT_MIGRATED, TAX_ID_BAD ...).
 * ⚠️ The Problem owns `hint`: the two database refusals that carried a `hint` key (routing, a desk) keep the database's own hint when it gave one; when it gave none the key used to be null and is now
 *    the register's sentence.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object } = require('./contract-kit');
const { said, failed } = require('./products-contract');
const { refusalFor } = require('./storefront-contract');
const owner = require('./owner');
const exposure = require('./exposure');
const platformroot = require('./platformroot');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const BAD_REQUEST = 'ENTITY_BAD_REQUEST';
const CLASH = 'ENTITY_CLASH';
const NOT_MIGRATED = 'ENTITY_NOT_MIGRATED';
const NO_ROOT = 'NO_PLATFORM_ROOT';
const NOT_ROOT = 'NOT_PLATFORM_ROOT';
const badRequest = (error, message) => said(BAD_REQUEST, { error, message });
const notFound = (legacy) => said('NOT_FOUND', legacy);
const clash = (error, message) => said(CLASH, { error, message });
const notYetThere = (migration, what, tail) => said(NOT_MIGRATED, { error: 'Not available yet', message: `Run migration ${migration} — the ${what} does not exist in this database${tail || ''}.` });

/** the User ID sentences: one source for the sign-up (registerNew) and the profile save */
const userIdTaken = (value) => said('USER_ID_TAKEN', { error: 'That User ID is taken', code: 'USER_ID_TAKEN', message: '"' + value + '" is already registered. Choose another — it cannot be changed later.' });
const userIdInvalid = (reason, more) => said('USER_ID_INVALID', Object.assign({ error: 'Choose a User ID', code: 'USER_ID_INVALID', message: reason }, more));
const userIdFixed = (existing) =>
  said('USER_ID_IMMUTABLE', {
    error: 'A User ID cannot be changed',
    code: 'USER_ID_IMMUTABLE',
    message:
      'Your User ID is "' + existing + '". It is how people sign in and how everything else is named, so it is fixed for the life of the business — like an email address. The name above it can be changed to anything.',
    user_id: existing
  });
const userIdEntityOnly = () =>
  said('USER_ID_ENTITY_ONLY', {
    error: 'Not permitted',
    code: 'USER_ID_ENTITY_ONLY',
    message: 'A User ID belongs to the business, not to a person. You sign in as "key@business" — that is your login, and it cannot be changed here.'
  });
const currencyEntityOnly = () =>
  said('CURRENCY_ENTITY_ONLY', {
    error: 'Not permitted',
    code: 'CURRENCY_ENTITY_ONLY',
    message: 'The currency your prices are written in belongs to the business. Ask whoever runs the account to change it in Settings.'
  });
/** the library's own refusal of a currency ({ code, message[, allowed] }): kept whole, under the screen's word "Currency not permitted" */
const currencyRefused = (refusal) => ({ code: refusal.code, detail: refusal.message, legacy: Object.assign({ error: 'Currency not permitted' }, refusal) });
/** the tax-number check of the shop's country pack ({ code, why }) */
const taxNumberRefused = (refused) => said(refused.code, { error: 'Tax number not accepted', code: refused.code, message: refused.why });
/** a catalogue visibility the plan or the operator closed: the sentence names who closed it */
const visibilityCapped = (verdict, by) => ({ code: verdict.status === 400 ? BAD_REQUEST : 'VISIBILITY_CAPPED', detail: verdict.message, legacy: { error: 'Not allowed', message: verdict.message, capped_by: by } });
const visibilityNotMigrated = (value) =>
  said('VISIBILITY_NOT_MIGRATED', { error: 'Not stored', message: `This database does not accept "${value}" yet — apply migration b115.`, code: 'VISIBILITY_NOT_MIGRATED' });
/** a team or a desk the database's trigger refused: its own sentence, and its hint when it gave one; callers ask knownerr.isTriggerRefusal(e) first (SEC-94), any other 23514 is a fault */
const triggerRefused = (error, e) => Object.assign(said(CLASH, { error, message: e.message }), e.hint ? { hint: e.hint } : {});

const words = {
  searchTooShort: () => badRequest('Search query too short', 'Enter at least 2 characters'),
  meUnknown: () => notFound({ error: 'Entity not found' }),
  /* the shared handler of the two preference doors carries these two statuses in their words: only one of the doors can answer a 404 */
  unknownPrefSet: () => ({ status: 404, ...notFound({ error: 'Unknown preference set' }) }),
  badPreference: (message) => ({ status: 400, ...badRequest('Bad preference', message) }),
  exposureNoSwitch: () => badRequest('validation', 'switches required — keys: ' + exposure.KEYS.join(', ')),
  policyOwnerOnly: (sentence) => said(owner.OWNER_ONLY, { error: owner.OWNER_ONLY_WORDS, code: owner.OWNER_ONLY, may: false, why: sentence, message: sentence }),
  userIdTaken,
  userIdInvalid,
  userIdFixed,
  userIdEntityOnly,
  currencyEntityOnly,
  currencyRefused,
  taxNumberRefused,
  visibilityCapped,
  visibilityNotMigrated,
  badHandler: () => badRequest('Bad handler', 'dispute_handler_actor_id must be an actor under your entity'),
  userIdRace: () => clash('Taken', 'That user_id is already in use'),
  sealed: () => said('ENTITY_SEALED', { error: 'Forbidden', message: 'Protected (sealed) entity — cannot be erased.' }),
  routingBadKind: () => badRequest('Not a routable kind', 'Routing is set per kind of work, and that is not one of them.'),
  routingNotThere: () => notYetThere('b250', 'routing table'),
  routingFolderNone: () => notFound({ error: 'Folder not found' }) /* SEC-100: an unknown folder and another shop's folder, one answer */,
  routingPersonNone: () => notFound({ error: 'Person not found' }) /* SEC-103: an unknown person and another shop's person, one answer */,
  teamOutsideNetwork: (e) => triggerRefused('Not your network', e),
  folderGone: () => clash('Gone', 'That folder or person no longer exists. Pick another.'),
  populationCodeUnusable: () =>
    badRequest('Not a usable code', 'Lowercase letters, digits and underscore, 2–24 characters, starting with a letter. It is stored on every entity in the population and appears in links.'),
  populationNeedsName: () => badRequest('Needs a name', 'What should it be called?'),
  populationNeedsNote: () => badRequest('Needs a note', 'Say what this population is for. A world nobody can describe is one nobody can decide to use.'),
  populationExists: (code) => clash('Already exists', 'There is already a population called ' + code + '.'),
  populationRegistryMissing: () => notYetThere('b249', 'population registry'),
  noSuchPopulation: (code) => notFound({ error: 'No such population', message: 'There is no population called ' + code + '.' }),
  deskColumnMissing: () => notYetThere('b252', 'desk column', ' yet'),
  notADesk: (e) => triggerRefused('Not a desk for this population', e),
  misNoRoot: () => said(NO_ROOT, { error: platformroot.NO_ROOT_BODY.error, message: platformroot.NO_ROOT_BODY.message }),
  misNotRoot: () => said(NOT_ROOT, { error: 'Not the platform root', message: 'The platform report is available to the operator entity only.' })
};

/** a 5xx that must not carry the cause but never had a `message` key either (the populations list): the screen's label alone */
const failedBare = (e, req, label) => internalSpec(req, e, { error: label });

/**
 * policyFault(e, req) — the spec of whatever PATCH /policy's catch got. A refusal the policy library meant (it carries a status, and a code when the pack names one: REG_KIND_NOT_OFFERED) keeps its
 * status, its code and its sentence; anything else is a 500 that says nothing of its cause.
 */
function policyFault(e, req) {
  if (!(e && e.status)) return failed(e, req, 'Policy update failed');
  const code = e.code || (e.status < 500 ? BAD_REQUEST : NOT_MIGRATED);
  const message = e.message || SAFE_SENTENCE;
  return { status: e.status, code, detail: message, legacy: Object.assign({ error: 'Policy update failed' }, e.code ? { code: e.code } : {}, { message }) };
}

const CODES = [
  ...new Set([
    BAD_REQUEST,
    CLASH,
    NOT_MIGRATED,
    NO_ROOT,
    NOT_ROOT,
    'INTERNAL',
    'INVALID_INPUT',
    'NOT_FOUND',
    'OWNER_ONLY',
    'NOT_PLATFORM',
    'ENTITY_SEALED',
    'USER_ID_TAKEN',
    'USER_ID_INVALID',
    'USER_ID_IMMUTABLE',
    'USER_ID_ENTITY_ONLY',
    'CURRENCY_ENTITY_ONLY',
    'CURRENCY_MALFORMED',
    'CURRENCY_NOT_ALLOWED',
    'TAX_ID_BAD',
    'VISIBILITY_CAPPED',
    'VISIBILITY_NOT_MIGRATED',
    'REG_KIND_NOT_OFFERED'
  ])
];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { root: 404 };
const ROOT_GATE = ['root'];
/** the refusals a library raises beyond a row's own statuses: its status and code, the words are the library's (frozen in docs/contracts/api-legacy.json) */
const refusal = (status, code, when) => ({ status, code, when });
const PROFILE_BODY = ['display_name', 'gstn', 'logo_url', 'address', 'business_status', 'currency_code', 'supplies', 'storefront_access', 'self_copy_pref', 'dispute_handler_actor_id', 'user_id', 'ui_prefs', 'catalogue_visibility'];
const PREFS_NOTE = 'a body of the preference keys to set (a key sent empty is removed)';

const ROUTES = {
  'GET /constitutions': { summary: 'The verticals a registrant can choose at sign-up, the installation, and the countries it may pick (?tz= the device zone); no sign-in', public: true, out: object(['constitutions', 'installation', 'allowed_countries', 'countries']) },
  'GET /search': { summary: 'Find a LISTED business (or, kind=product, a product in a listed shop) by name, here or on another installation (?q=, two characters or more; ?where=here|<installation>|all); an exact User ID or Bridge ID still finds one; never an internal one', inline: [400, 404], out: object(['results', 'count', 'answers']) },
  'GET /search/places': { summary: 'The installations the Where picker offers: the ones we deal with that are active, by name and domain', out: object(['places']) },
  'GET /policy': { summary: "The shop's policy flags, with the words and who may change each", out: object(['flags', 'country', 'schema', 'bound', 'bound_schema', 'may']) },
  'PATCH /policy': {
    summary: "Change the shop's policy flags (a body of flag: value; the owner alone for some)",
    invalid: 400,
    inline: [403],
    body: [],
    refusals: [refusal(400, BAD_REQUEST, 'a flag the policy does not know, one that is platform-bound, or a kind the shop country does not offer (REG_KIND_NOT_OFFERED)'), refusal(503, NOT_MIGRATED, 'the policy flags column is not migrated yet (b130)')],
    out: object(['flags'])
  },
  'GET /header': { summary: "The shell's header sheet in one read: the business, its licences and whether it is trade ready", out: object(['business', 'licences', 'trade_ready']) },
  'GET /sides': { summary: 'What this business leans on and what leans on it, in one answer', out: object(['lean', 'use', 'impact']) },
  'GET /me': { summary: 'The signed-in person and their shop: profile, capabilities, governance (?include=readiness,channels,vault bundles those reads)', inline: [404], out: object(['entity', 'capabilities', 'capabilities_debug', 'governance']) },
  'PATCH /me/prefs/:kind': { summary: "Store one of the person's own preference sets (kind: locale or ui); " + PREFS_NOTE, invalid: 400, body: [], out: object([]) },
  'PATCH /me/exposure': { summary: "The shop's default Shown to customers switches", invalid: 400, inline: [400], body: exposure.KEYS, out: object(['message', 'exposure']) },
  'GET /me/can-see-costs': { summary: 'May the caller see cost and margin in Offer Lab', out: object(['can_see_costs', 'is_owner', 'may_set_rate']) },
  'PATCH /me/locale': { summary: "Store the person's localisation choice; " + PREFS_NOTE, invalid: 400, body: [], out: object([]) },
  'PATCH /profile': {
    summary: "Change the shop's own details: name, tax number, address, currency, User ID (once), visibility",
    invalid: 400,
    inline: [403, 409],
    body: PROFILE_BODY,
    refusals: [refusal(422, 'CURRENCY_NOT_ALLOWED', 'the currency is outside what the constitution permits')],
    out: object(['message'])
  },
  'PATCH /:id/erase': { summary: 'Mark an identity erased (the platform only); a sealed one is refused', invalid: 400, inline: [403], body: [], out: object(['message', 'id']) },
  'GET /usage': { summary: 'What this shop has been billed for (?days=, 1 to 365)', out: object(['ok', 'window_days', 'counts', 'total_cost_usd', 'rate_card', 'daily', 'by_meter', 'recent']) },
  'GET /routing/preview': { summary: 'Where a ticket of a kind would go (?kind=&audience=&to_bridge_id=); always 200, ok: false says why not', out: object([]) },
  'GET /routing': { summary: 'Where each kind of work goes: the folders, the people and the teams to choose from', out: object(['kinds', 'folders', 'people', 'teams']) },
  'PUT /routing': { summary: 'Set where one kind of work goes', invalid: 400, inline: [400, 404, 409], body: ['kind', 'folder_id', 'assignee_actor_id', 'route_to_entity_id'], out: object(['ok', 'kind']) },
  'GET /populations': { summary: "The platform's populations and the businesses that could answer each one's support (the platform root only)", gates: ROOT_GATE, inline: [403], out: object(['populations']) },
  'PUT /populations/:code/desk': { summary: "Name the business that answers a population's support, or clear it (the platform root only)", gates: ROOT_GATE, invalid: 400, inline: [403, 404, 409], body: ['desk_entity_id'], out: object(['ok', 'code', 'desk_entity_id']) },
  'POST /populations': { summary: 'Add a population (the platform root only)', gates: ROOT_GATE, invalid: 400, inline: [400, 403, 409], ok: 201, body: ['code', 'label', 'note'], out: object(['ok', 'code', 'label']) },
  'GET /mis': { summary: 'The platform report across every business (the platform root only; ?population=)', inline: [403, 404], out: object([]) },
  'GET /entitlements': { summary: "The shop's plan, features and quotas, reported only (no route gates on them today)", out: object(['plan', 'name', 'sellable', 'limited', 'features', 'quotas', 'vertical', 'entity_kind', 'envelope', 'enforced', 'note']) }
};

const entities = contractOf({ mount: '/api/entities', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-entities-refusals' });
const OPERATIONS = entities.OPERATIONS;

/* ── the schema's own refusal, in the shape these routes' chains always refused in ── */
/** the body that is not an object: the old chain's 400 "Validation failed" body, one entry for the body itself */
const schemaOptions = refusalFor([]);

module.exports = { words, said, failed, failedBare, policyFault, CODES, schemaOptions, OPERATIONS, ROUTES, entities, allowedStatuses: entities.allowedStatuses };
