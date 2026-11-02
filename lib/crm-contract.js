/*
 * OWNS      the contract of the CRM routes (24): routes/crm.js (/api/crm) — each route's OpenAPI operation (S9) and the one way its refusals and faults are worded
 *           (said, crmFault, keyFence, notYourParty, noSuchFollowup).
 * CALLED BY routes/crm.js (schemaValidate on each route, router.openapi, problem(req, res, crmFault(e, req) | keyFence() | notYourParty() | noSuchFollowup()))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-crm.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → crmFault(e, req) → the refusal the library meant (400 · 403 · 404 · 409 · 503, its own code and words) or a 500 that says nothing of its cause
 *           a refusal → problem(req, res, spec) → the old { code, error, message, why? } beside the Problem fields
 * CARD      11-crm-and-marketing/crm-routes
 * This file shapes NO answer: the parties, follow-ups, calls, leads, consent rows, requests and groups are lib/crm*.js, lib/privacy.js and lib/memberships.js, as before.
 *
 * ⚠️ LAW AND CONSENT live in these routes. Nothing here decides who may be contacted: privacy.gate answers 403 { code, why } from the library, and crmFault only carries
 *    that refusal to the caller with the words it always had. The privacy request due dates, the answer-once rule, the send gate and the import rules are the libraries'.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed (a handler reads every field through String(...) and answers a missing or odd
 *    value in its own sentence, frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep). A schema refuses a body that is not an object, a query value
 *    given twice, and (S33, the 13 writes) a body key no one reads: answered 400 in the CRM's own three keys, the unknown key named. A malformed id in a path stays the handler's own 400 BAD_ID (the path argument is plain text).
 * ⚠️ Libraries throw their refusals with a status and a code (bad(msg, status, code)); the status is read at run time, so 409 and 503 are listed in `x-crm-refusals`, not declared.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }; the words a person reads are `message`, else `error` */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });

/* ── the words of a refusal ─────────────────────────────────────────────────────────────────────────────── */
const FAILED = { error: 'Failed', message: SAFE_SENTENCE };
const SIGN_IN_WORDS = 'Sign in to use CRM.';
const NOT_MIGRATED = { error: 'Not migrated yet', message: 'CRM needs migration b276 — not run yet.' };
/** a key (a counter or a connector) reaches no CRM route: 403 SIGN_IN */
const keyFence = () => said('SIGN_IN', { code: 'SIGN_IN', error: SIGN_IN_WORDS, message: SIGN_IN_WORDS });
/** the party is not on this shop's list (or is another shop's: the same answer) */
const notYourParty = () => said('NOT_FOUND', { code: 'NOT_FOUND', error: 'Not found', message: 'Not your party.' });
/** no such follow-up in this shop */
const noSuchFollowup = () => said('NOT_FOUND', { code: 'NOT_FOUND', error: 'Not found', message: 'No such follow-up.' });

/** b276 not run (the code, or a missing table / column the follow-ups read): the short 503 every screen maps to its own line */
function migrationRefusal(e) {
  if (e && (e.code === 'CRM_NOT_MIGRATED' || require('./crm-followups').isTableGone(e))) return { status: 503, ...said('CRM_NOT_MIGRATED', Object.assign({ code: 'CRM_NOT_MIGRATED' }, NOT_MIGRATED)) };
  if (e && e.code === 'PRIVACY_NOT_MIGRATED') return { status: 503, ...said(e.code, { code: e.code, error: NOT_MIGRATED.error, message: e.message }) };
  if (e && e.code === 'LEADS_NOT_MIGRATED') return { status: 503, ...said('LEADS_NOT_MIGRATED', { code: 'LEADS_NOT_MIGRATED', error: e.message, message: e.message }) };
  return null;
}
/**
 * crmFault(e, req) — the spec of whatever a CRM route's catch got. A migration not run is a 503 in the short words; a library's refusal (a status under 500, with its code or
 * REFUSED) keeps its status, code, sentence and `why`; anything else is a 500 that says nothing of its cause (the real error is logged with the request id).
 */
function crmFault(e, req) {
  const migration = migrationRefusal(e);
  if (migration) return migration;
  if (e && e.status && e.status < 500) {
    const code = e.code || 'REFUSED';
    return { status: e.status, ...said(code, Object.assign({ code, error: e.message, message: e.message }, e.why ? { why: e.why } : {})) };
  }
  return internalSpec(req, e, FAILED);
}

/** a body the schema refuses is answered 400 in the CRM's three keys: the first failure's sentence */
const schemaOptions = { status: 400, code: 'CRM_BAD_REQUEST', legacy: (failures) => ({ code: 'CRM_BAD_REQUEST', error: failures[0].detail, message: failures[0].detail }) };

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = [
  'CRM_NOT_MIGRATED', 'PRIVACY_NOT_MIGRATED', 'LEADS_NOT_MIGRATED', 'GROUPS_NOT_MIGRATED', 'SIGN_IN', 'REFUSED', 'CRM_BAD_REQUEST', 'NOT_FOUND',
  'BAD_ID', 'BAD_BEFORE', 'BAD_CHANNEL', 'BAD_PURPOSE', 'BAD_AFTER', 'BAD_ASSIGNEE', 'NOT_ASSIGNEE', 'BAD_DUE', 'NEED_DAY', 'BAD_OUTCOME', 'BAD_GROUP', 'BAD_KIND', 'BAD_KEY',
  'BAD_NAME', 'BAD_PHONE', 'NO_ROWS', 'NO_TEXT', 'NOTHING_TO_DO', 'PURPOSE_FIXED', 'CHANNEL_NOT_SENDABLE', 'TOO_LONG', 'TOO_MANY', 'TOO_MANY_GROUPS', 'OWNER_ONLY', 'VIEW_ONLY',
  'EXISTS', 'MINT_REFUSED', 'HAS_DUES', 'IS_CUSTOMER', 'ANSWERED', 'NO_CONSENT', 'CONSENT_WITHDRAWN', 'SAID_NO', 'OPTED_OUT', 'INTERNAL'
];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** S33 strict input: a write's body lists every key the route, its library or a web caller (cap-crm*.js, cap-finance-cheques.js) sends, and refuses any other by name (UNKNOWN_FIELD, the old 400) */
const CLOSED = { additionalProperties: false };
const PAGE_QUERY = ['page', 'limit'];
const GATE_STATUS = { session: 403 };
const SESSION = ['session', 'refuses'];
const REFUSALS = [
  { status: 503, code: 'CRM_NOT_MIGRATED', when: 'the follow-up tables (b276) are not run yet' },
  { status: 503, code: 'PRIVACY_NOT_MIGRATED', when: 'the consent or request tables (b306, b307) are not run yet' },
  { status: 503, code: 'LEADS_NOT_MIGRATED', when: 'the lead stages table (b297) is not run yet' },
  { status: 409, code: 'GROUPS_NOT_MIGRATED', when: 'the named-group column (b205) is not run yet' },
  { status: 409, code: 'HAS_DUES', when: 'the party has open dues, so it cannot be removed' },
  { status: 409, code: 'IS_CUSTOMER', when: 'the party has traded, so it is a customer and has no lead stage to move' },
  { status: 409, code: 'EXISTS', when: 'the name or phone is already on the list' },
  { status: 409, code: 'ANSWERED', when: 'the privacy request is not found, or was already answered (an answer is given once)' },
  { status: 403, code: 'OWNER_ONLY', when: 'the action is the owner’s alone' },
  { status: 403, code: 'VIEW_ONLY', when: 'the login can only view' },
  { status: 403, code: 'NOT_ASSIGNEE', when: 'only the owner or the assignee can hand a follow-up on' },
  { status: 403, code: 'NO_CONSENT', when: 'the privacy gate refuses an out call or message (also CONSENT_WITHDRAWN, SAID_NO, OPTED_OUT), with its sentence as `why`' }
];

const ROUTES = {
  'GET /parties': { summary: 'The whole party list, one row per party, with what this login may do', gates: SESSION, invalid: 400, query: ['view', 'with', ...PAGE_QUERY], out: object(['parties', 'total', 'page', 'limit', 'may'], { parties: array() }) },
  'GET /parties/:id': { summary: 'One party: the list row, the relationship, points, open follow-ups and what this login may do', gates: SESSION, invalid: 400, out: object(['party_id', 'may']) },
  'GET /parties/:id/timeline': { summary: 'Everything that happened with a party, newest first, in pages', gates: SESSION, invalid: 400, query: ['limit', 'before'], out: object(['party_id', 'entries', 'next_before', 'migrated', 'total', 'page', 'limit'], { entries: array() }) },
  'GET /parties/:id/contact-prefs': { summary: 'Every consent row of a party and who may be contacted on which channel, with the law’s words', gates: SESSION, invalid: 400, out: object(['party_id', 'history', 'may', 'law'], { history: array() }) },
  'POST /parties/:id/contact-prefs': { summary: 'Note one consent change: a new row, never an update (append-only)', gates: SESSION, invalid: 400, ok: 201, body: ['channel', 'purpose', 'allowed', 'basis', 'source', 'source_ref'], rules: CLOSED, out: object(['pref']) },
  'POST /parties/:id/interactions': { summary: 'Log a call, visit, message or note; an out call or message asks the consent gate first', gates: SESSION, invalid: 400, ok: 201, body: ['kind', 'direction', 'body', 'at', 'channel', 'purpose'], rules: CLOSED, out: object(['interaction']) },
  'GET /followups': { summary: 'The follow-ups, mine or all, open or done, in pages, with how many are late and due today', gates: SESSION, invalid: 400, query: ['scope', 'done', ...PAGE_QUERY], out: object(['followups', 'total', 'page', 'limit', 'late', 'today', 'shop_day', 'may'], { followups: array() }) },
  'POST /followups': { summary: 'Make a follow-up for a party', gates: SESSION, invalid: 400, refusals: [{ status: 404, code: 'NOT_FOUND', when: 'the party is not on this shop’s list' }], ok: 201, body: ['party_id', 'what', 'due_at', 'after', 'assignee_user_id', 'source'], rules: CLOSED, out: object(['followup']) },
  'PATCH /followups/:id': { summary: 'Mark a follow-up done, move its day, hand it on or reword it', gates: SESSION, invalid: 400, body: ['done', 'due_at', 'after', 'assignee_user_id', 'what'], rules: CLOSED, out: object(['followup']) },
  'DELETE /followups/:id': { summary: 'Delete a follow-up', gates: SESSION, invalid: 400, out: object(['ok']) },
  'DELETE /parties/:id': { summary: 'Remove a party from my list (owner only, no open dues); hides the row and deletes no history', gates: SESSION, invalid: 400, out: object(['ok', 'party_id']) },
  'POST /leads': { summary: 'Add one lead: a local party with its first stage', gates: SESSION, invalid: 400, ok: 201, body: ['name', 'phone', 'stage'], rules: CLOSED, out: object(['party']) },
  'GET /calls': { summary: 'Today’s call queue and the outcome buttons', gates: SESSION, invalid: 400, query: ['scope', ...PAGE_QUERY], out: object(['calls', 'total', 'page', 'limit', 'late', 'today', 'outcomes', 'may', 'shop_day'], { calls: array() }) },
  'POST /parties/:id/outcome': { summary: 'One tap after a call: the call logged, the next follow-up and the stage move in one go', gates: SESSION, invalid: 400, ok: 201, body: ['outcome', 'followup_id', 'after', 'due_at'], rules: CLOSED, out: object(['interaction', 'followup', 'stage', 'suggest']) },
  'POST /leads/import': { summary: 'Import up to 500 leads a browser read from a CSV: added, merged or skipped (dry only previews; the preview answers 200)', gates: SESSION, invalid: 400, ok: 201, body: ['rows', 'dry'], rules: CLOSED, out: object(['dry', 'added', 'merged', 'skipped', 'rows'], { dry: {}, added: {}, merged: {}, skipped: {}, rows: array() }, true) },
  'POST /parties/:id/stage': { summary: 'Move a lead to another stage: a new row, the old rows are the history', gates: SESSION, invalid: 400, body: ['stage'], rules: CLOSED, out: object(['ok', 'party_id', 'lead']) },
  'POST /walk-ins/add': { summary: 'A phone that holds points becomes a local customer and the points move to them', gates: SESSION, invalid: 400, ok: 201, body: ['phone', 'name'], rules: CLOSED, out: object(['party', 'points_claimed']) },
  'GET /privacy-requests': { summary: 'The register of privacy requests and grievances, with who may answer', gates: SESSION, invalid: 400, query: ['open', ...PAGE_QUERY], out: object(['requests', 'total', 'page', 'limit', 'open', 'late', 'may_answer', 'why'], { requests: array() }) },
  'POST /privacy-requests': { summary: 'Log a privacy request: the due date is the one the law sets', gates: SESSION, invalid: 400, refusals: [{ status: 404, code: 'NOT_FOUND', when: 'the party is not on this shop’s list' }], ok: 201, body: ['kind', 'who', 'party_id', 'country', 'received_at'], rules: CLOSED, out: object(['request']) },
  'POST /privacy-requests/:id/answer': { summary: 'The owner answers a privacy request, once', gates: SESSION, invalid: 400, refusals: [{ status: 404, code: 'NOT_FOUND', when: 'the request is not one this shop holds (unknown, or another shop’s); ANSWERED is only for one already answered' }], body: ['outcome', 'answer'], rules: CLOSED, out: object(['request']) },
  'GET /segments': { summary: 'The segments and named groups with their counts, offers and who may be sent offers', gates: SESSION, out: object(['segments', 'groups', 'groups_migrated', 'consent_migrated', 'channel', 'purpose', 'customers', 'may'], { segments: array(), groups: array() }) },
  'POST /groups': { summary: 'Make or change a named group: who to add and who to take out, in one go', gates: SESSION, invalid: 400, ok: 201, body: ['name', 'add', 'remove'], rules: CLOSED, out: object(['name', 'added', 'removed', 'count']) },
  'DELETE /groups/:name': { summary: 'Take a group off every customer (owner only)', gates: SESSION, invalid: 400, out: object(['name', 'removed']) },
  'POST /segments/:key/send': { summary: 'Message a segment or a group through the one consent gate; dry gives the count and who is refused, by code', gates: SESSION, invalid: 400, refusals: [{ status: 404, code: 'NOT_FOUND', when: 'no customer of this shop carries the group (unknown, or another shop’s)' }], body: ['text', 'channel', 'purpose', 'dry'], rules: CLOSED, out: object(['key', 'send_ref', 'dry', 'channel', 'purpose', 'members', 'may', 'refused', 'refused_by', 'sent', 'sent_n', 'failed_n', 'refused_n'], { refused: array(), refused_by: array(), sent: array() }) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/crm', routes: ROUTES, gateStatus: GATE_STATUS, refusals: REFUSALS, refusalsWhen: 'refuses', extension: 'x-crm-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { said, crmFault, keyFence, notYourParty, noSuchFollowup, schemaOptions, CODES, OPERATIONS, allowedStatuses, contract };
