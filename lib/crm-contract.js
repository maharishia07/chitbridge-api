/*
 * OWNS      the contract of routes/crm.js and routes/marketing.js: each route's OpenAPI operation (S9), the CRM's one mapping from a thrown refusal to the answer (refusalOf)
 *           and the Marketing read's fault (faultOf), and the sentences the sign-in fence answers in.
 * CALLED BY routes/crm.js · routes/marketing.js (schemaValidate on each route, router.openapi, problem(res.req, res, refusalOf(e, req))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-marketing.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           thrown refusal (lib/crm-followups bad(), a typed not-migrated, a privacy refusal) → refusalOf(e) → { status, code, detail, legacy } → problem() → the old { code, error, message, why } beside the Problem fields
 * CARD      11-crm-and-marketing/crm-routes
 * Kept apart from the route files so their handlers keep their places (and their history) while the contract grows here. This file shapes NO answer: the lists and figures are lib/crm's and lib/marketing-results'.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own coded sentence
 *    (BAD_ID, BAD_NAME, BAD_PHONE ...), and those words are frozen (docs/contracts/api-legacy.json). Required fields and unknown-key refusal are API-3 (strict_input) with the owner's say.
 * ⚠️ A query value the handler reads leniently (a page falls back to the first) is declared as plain text: a schema that refused it would turn a fallback into a refusal no caller has ever had.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { isTableGone } = require('./crm-followups');
const { contractOf, object } = require('./contract-kit');

/* ── the sentences the fence and the not-migrated refusals answer in (frozen: they are the words the screens map to their own lines) ── */
const SAID = {
  signIn: 'Sign in to use CRM.',
  signInMarketing: 'Sign in to use Marketing.',
  crmNotMigrated: 'CRM needs migration b276 — not run yet.',
  notYourParty: 'Not your party.',
  noFollowup: 'No such follow-up.',
  notMigrated: 'Not migrated yet',
  failed: 'Failed'
};

/** a part of the CRM whose database update has not run: 503 with the sentence its screen maps to its own line, or null when e is not one of those */
function notMigratedOf(e) {
  if (!e) return null;
  if (e.code === 'CRM_NOT_MIGRATED' || isTableGone(e))
    return { status: 503, code: 'CRM_NOT_MIGRATED', detail: SAID.crmNotMigrated, legacy: { error: SAID.notMigrated, message: SAID.crmNotMigrated } };
  if (e.code === 'PRIVACY_NOT_MIGRATED') return { status: 503, code: e.code, detail: e.message, legacy: { error: SAID.notMigrated, message: e.message } };
  if (e.code === 'LEADS_NOT_MIGRATED') return { status: 503, code: 'LEADS_NOT_MIGRATED', detail: e.message, legacy: { error: e.message, message: e.message } };
  return null;
}

/** a refusal the CRM's libraries throw (lib/crm-followups bad(): .status 4xx, .code, .message, and .why for a privacy refusal) → { status, code, detail, legacy } for problem(); anything else is a 500 that says nothing of its cause (S8) */
function refusalOf(e, req) {
  const notMigrated = notMigratedOf(e);
  if (notMigrated) return notMigrated;
  if (e && e.status && e.status < 500)
    return {
      status: e.status,
      code: e.code || 'REFUSED',
      detail: e.message,
      legacy: Object.assign({ error: e.message, message: e.message }, e.why ? { why: e.why } : {})
    };
  return internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE });
}

/** the Marketing read answers with the status its error names (it has always done), 500 when it names none; the body says nothing of the cause */
function faultOf(e, req) {
  return Object.assign(internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE }), { status: (e && e.status) || 500 });
}

/* ── the contract: each route's OpenAPI operation, built from one row of ROUTES ── */
const GATE_STATUS = { noKey: 403 };
const REFUSALS = [
  {
    status: 400,
    code: 'BAD_ID | BAD_NAME | BAD_PHONE | BAD_GROUP | BAD_KEY | BAD_OUTCOME | NO_ROWS | TOO_MANY ...',
    when: 'a question the owner can answer: a missing or odd id, name, phone or choice'
  },
  { status: 403, code: 'OWNER_ONLY | VIEW_ONLY | a consent refusal', when: 'this login may not, or the contact was not agreed' },
  { status: 404, code: 'NOT_FOUND', when: 'no such party, follow-up or group in this shop' },
  { status: 409, code: 'EXISTS | IS_CUSTOMER | HAS_DUES', when: 'the list refuses the write as it stands' },
  { status: 503, code: 'CRM_NOT_MIGRATED | PRIVACY_NOT_MIGRATED | LEADS_NOT_MIGRATED', when: 'the database update for this part has not run yet' }
];
const LIST_OUT = ['total', 'page', 'limit'];
const ROUTES = {
  'GET /parties': {
    summary: 'The one party list: one row per party, customers, suppliers and leads',
    gates: ['noKey'],
    query: ['view', 'with', 'page', 'limit'],
    out: object(LIST_OUT.concat(['may']))
  },
  'GET /parties/:id': {
    summary: 'One party: the list row, the relationship line, points and open follow-ups',
    gates: ['noKey'],
    out: object(['may', 'followups', 'migrated'])
  },
  'GET /parties/:id/timeline': {
    summary: 'What happened with a party, newest first: chits, messages, ledger, calls, follow-ups, changes',
    gates: ['noKey'],
    query: ['before', 'limit'],
    out: object(['entries', 'next_before', 'migrated'])
  },
  'POST /parties/:id/interactions': {
    summary: 'Log a call, visit, message or note against a party',
    gates: ['noKey'],
    body: ['kind', 'direction', 'channel', 'purpose', 'body', 'at'],
    ok: 201,
    out: object(['interaction'])
  },
  'GET /followups': {
    summary: 'The follow-ups, mine or all, open or done',
    gates: ['noKey'],
    query: ['scope', 'done', 'page', 'limit'],
    out: object(LIST_OUT.concat(['may']))
  },
  'POST /followups': {
    summary: 'Add a follow-up for a party',
    gates: ['noKey'],
    body: ['party_id', 'what', 'due_at', 'after', 'assignee_user_id'],
    ok: 201,
    out: object(['followup'])
  },
  'PATCH /followups/:id': {
    summary: 'Tick a follow-up off, move its day, give it to someone or reword it',
    gates: ['noKey'],
    body: ['done', 'due_at', 'after', 'assignee_user_id', 'what'],
    out: object(['followup'])
  },
  'DELETE /followups/:id': { summary: 'Remove a follow-up', gates: ['noKey'], out: object(['ok']) },
  'DELETE /parties/:id': {
    summary: 'Remove a party from my list (owner only, no open dues; the history stays)',
    gates: ['noKey'],
    out: object(['ok', 'party_id'])
  },
  'POST /leads': { summary: 'Add one lead with its first stage', gates: ['noKey'], body: ['name', 'phone', 'stage'], ok: 201, out: object() },
  'GET /calls': { summary: "Today's call queue", gates: ['noKey'], query: ['scope', 'page', 'limit'], out: object() },
  'POST /parties/:id/outcome': {
    summary: 'One tap after a call: the call logged, the next follow-up and the stage move together',
    gates: ['noKey'],
    body: ['outcome', 'after', 'due_at'],
    ok: 201,
    out: object()
  },
  'POST /leads/import': {
    summary: 'Import up to 500 leads a browser read from a CSV (dry previews and writes nothing: 200)',
    gates: ['noKey'],
    body: ['rows', 'dry'],
    ok: 201,
    out: object()
  },
  'POST /parties/:id/stage': {
    summary: 'Move a lead to a stage (a new row; the old rows are the history)',
    gates: ['noKey'],
    body: ['stage'],
    out: object(['ok', 'party_id', 'lead'])
  },
  'POST /walk-ins/add': {
    summary: 'A phone that holds points becomes a local customer; the points move to them',
    gates: ['noKey'],
    body: ['phone', 'name'],
    ok: 201,
    out: object()
  },
  'GET /parties/:id/contact-prefs': {
    summary: 'Every consent row of a party, newest first, with may and why per channel and purpose',
    gates: ['noKey'],
    out: object(['party_id', 'law'])
  },
  'POST /parties/:id/contact-prefs': {
    summary: 'Record one consent answer: yes, no or withdrawn (append only)',
    gates: ['noKey'],
    body: ['channel', 'purpose', 'allowed', 'source', 'source_ref'],
    ok: 201,
    out: object(['pref'])
  },
  'GET /privacy-requests': {
    summary: 'The register of privacy requests and grievances',
    gates: ['noKey'],
    query: ['open', 'page', 'limit'],
    out: object(['may_answer', 'why'])
  },
  'POST /privacy-requests': {
    summary: 'Log a privacy request: who, what kind, when it came in',
    gates: ['noKey'],
    body: ['party_id', 'kind', 'who', 'received_at'],
    ok: 201,
    out: object(['request'])
  },
  'POST /privacy-requests/:id/answer': {
    summary: 'The owner answers a privacy request, once',
    gates: ['noKey'],
    body: ['outcome', 'answer'],
    out: object(['request'])
  },
  'GET /segments': { summary: 'The segments and named groups, each with its count and who may be sent offers', gates: ['noKey'], out: object() },
  'POST /groups': {
    summary: 'Write a named group on customers (add and remove, one transaction)',
    gates: ['noKey'],
    body: ['name', 'add', 'remove'],
    ok: 201,
    out: object()
  },
  'DELETE /groups/:name': { summary: 'The owner takes a group off every customer', gates: ['noKey'], out: object() },
  'POST /segments/:key/send': {
    summary: 'Message a segment or group through the one consent gate (dry gives the count and who is refused)',
    gates: ['noKey'],
    body: ['channel', 'purpose', 'text', 'dry'],
    out: object()
  }
};
const MARKETING_ROUTES = {
  'GET /came-back': {
    summary: "Who was sent an offer and then bought within the shop's days-to-come-back, with the bills that count",
    gates: ['noKey'],
    query: ['page', 'limit'],
    out: object(['customers', 'sent_n', 'came_back_n', 'money', 'total', 'page', 'limit'])
  }
};
const EXTENSION = { gateStatus: GATE_STATUS, refusals: REFUSALS, refusalsWhen: 'noKey', extension: 'x-refusals' };
const crmContract = contractOf(Object.assign({ mount: '/api/crm', routes: ROUTES }, EXTENSION));
const marketingContract = contractOf({ mount: '/api/marketing', routes: MARKETING_ROUTES, gateStatus: GATE_STATUS });

module.exports = { SAID, refusalOf, faultOf, crmContract, marketingContract, ROUTES };
